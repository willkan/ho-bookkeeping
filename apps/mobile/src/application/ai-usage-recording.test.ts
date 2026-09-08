import { CONTRACT_VERSION, type ParseRequest } from '@bookkeeping/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { AiUsageEvent } from '../domain/ai-usage';
import { buildProviderConfigForSave } from '../infrastructure/ai/provider-config';
import { MemoryProviderConfigStore } from '../infrastructure/ai/provider-config-store';
import { OpenAiCompatibleParseTransport } from '../infrastructure/ai/transport';

function request(requestId: string, rawText = '一瓶水3元'): ParseRequest {
  return {
    contract_version: CONTRACT_VERSION,
    request_id: requestId,
    raw_text: rawText,
    submitted_at: '2026-08-30T00:00:00.000Z',
    timezone: 'Asia/Shanghai',
    local_date: '2026-08-30',
    mode_snapshot: {
      mode_id: null,
      mode_name: null,
      default_tags: [],
      include_in_mode_stats: false,
    },
    tag_candidates: [],
  };
}

async function configuredStore(): Promise<MemoryProviderConfigStore> {
  const store = new MemoryProviderConfigStore();
  await store.save(
    buildProviderConfigForSave({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'model-1',
      existing: null,
      keepExistingKey: false,
    }),
  );
  return store;
}

describe('AI parse execution usage recording contract', () => {
  it('records successful execution metadata from the same atomic transport result', async () => {
    const events: AiUsageEvent[] = [];
    const transport = new OpenAiCompatibleParseTransport(
      await configuredStore(),
      () => ({
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: '{"records":[]}' } }],
              usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
            }),
          },
        },
      }),
      (event) => events.push(event),
    );
    expect((await transport.parse(request('req_ok'))).status).toBe('ok');
    expect(events).toEqual([
      expect.objectContaining({
        requestId: 'req_ok',
        status: 'succeeded',
        promptTokens: 10,
        totalTokens: 12,
      }),
    ]);
  });

  it('records classified transport failures with unavailable tokens as null', async () => {
    const events: AiUsageEvent[] = [];
    const result = await new OpenAiCompatibleParseTransport(
      new MemoryProviderConfigStore(),
      undefined,
      (event) => events.push(event),
    ).parse(request('req_missing'));
    expect(result).toMatchObject({ status: 'error', error_category: 'invalid_request' });
    expect(events).toEqual([
      expect.objectContaining({
        requestId: 'req_missing',
        status: 'failed',
        errorCategory: 'invalid_request',
        totalTokens: null,
      }),
    ]);
  });

  it('does not change a parse response when usage persistence fails', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const result = await new OpenAiCompatibleParseTransport(
      new MemoryProviderConfigStore(),
      undefined,
      () => {
        throw new Error('disk full');
      },
    ).parse(request('req_sink_failed'));
    expect(result).toMatchObject({ status: 'error', error_category: 'invalid_request' });
    expect(info).toHaveBeenCalledWith(
      '[ai-usage] persist_failed',
      expect.objectContaining({
        request_id: 'req_sink_failed',
        error_name: 'Error',
      }),
    );
    info.mockRestore();
  });

  it('cannot attach execution metadata from a previous or concurrent request', async () => {
    const events: AiUsageEvent[] = [];
    const create = vi.fn(async (input: unknown) => {
      const args = input as { messages: { content: string }[] };
      const slow = args.messages[1]?.content.includes('慢请求');
      if (slow) await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        choices: [{ message: { content: '{"records":[]}' } }],
        usage: {
          prompt_tokens: slow ? 11 : 22,
          completion_tokens: 1,
          total_tokens: slow ? 12 : 23,
        },
      };
    });
    const transport = new OpenAiCompatibleParseTransport(
      await configuredStore(),
      () => ({ chat: { completions: { create } } }),
      (event) => events.push(event),
    );
    await Promise.all([
      transport.parse(request('req_slow', '慢请求')),
      transport.parse(request('req_fast', '快请求')),
    ]);
    expect(events.map(({ requestId, promptTokens }) => [requestId, promptTokens]).sort()).toEqual([
      ['req_fast', 22],
      ['req_slow', 11],
    ]);
  });
});
