import { CONTRACT_VERSION } from '@bookkeeping/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PARSE_SYSTEM_PROMPT } from './parse-prompt';
import { buildProviderConfigForSave } from './provider-config';
import { MemoryProviderConfigStore } from './provider-config-store';
import {
  FakeAiParseTransport,
  OpenAiCompatibleParseTransport,
  UnconfiguredAiParseTransport,
} from './transport';

const baseRequest = {
  contract_version: CONTRACT_VERSION,
  request_id: 'req_1',
  raw_text: '午饭100',
  submitted_at: '2026-07-16T12:00:00.000Z',
  timezone: 'Asia/Shanghai',
  local_date: '2026-07-16',
  mode_snapshot: {
    mode_id: null,
    mode_name: null,
    default_tags: [],
    include_in_mode_stats: false,
  },
  tag_candidates: [],
};

const validRecord = {
  direction: 'expense' as const,
  merchant: '食堂',
  note: null,
  occurred_at: '2026-07-16T12:00:00.000Z',
  timezone: 'Asia/Shanghai',
  local_date: '2026-07-16',
  currency: 'CNY' as const,
  list_price_minor: 10000,
  actual_cost_minor: 10000,
  discount_minor: 0,
  tags: [],
};

describe('AI transport BYOK path', () => {
  it('rejects a provider record that changes the request timezone', async () => {
    const store = new MemoryProviderConfigStore();
    await store.save(
      buildProviderConfigForSave({
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-fake',
        model: 'deepseek-chat',
        existing: null,
        keepExistingKey: false,
      }),
    );
    const transport = new OpenAiCompatibleParseTransport(store, () => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    records: [{ ...validRecord, timezone: 'America/New_York' }],
                  }),
                },
              },
            ],
          }),
        },
      },
    }));

    const result = await transport.parse(baseRequest);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_category).toBe('model_output_invalid');
      expect(result.message).toMatch(/timezone/);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Negative: missing config fails explicitly without synthesizing records
  it('returns invalid_request when secure config is missing', async () => {
    const store = new MemoryProviderConfigStore();
    const transport = new OpenAiCompatibleParseTransport(store);
    const result = await transport.parse(baseRequest);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_category).toBe('invalid_request');
      expect(result.message).toMatch(/尚未配置|AI 提供商/);
    }
  });

  // Positive: Unconfigured transport never synthesizes
  it('UnconfiguredAiParseTransport fails without calling a model', async () => {
    const transport = new UnconfiguredAiParseTransport();
    const result = await transport.parse(baseRequest);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_category).toBe('invalid_request');
    }
  });

  // Positive: SDK request uses chat.completions JSON mode with baseURL/model and max_tokens
  it('OpenAiCompatibleParseTransport uses Chat Completions JSON mode with DeepSeek-style config', async () => {
    const store = new MemoryProviderConfigStore();
    await store.save(
      buildProviderConfigForSave({
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-fake-not-real',
        model: 'deepseek-chat',
        existing: null,
        keepExistingKey: false,
      }),
    );

    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ records: [validRecord] }),
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const transport = new OpenAiCompatibleParseTransport(store, () => ({
      chat: { completions: { create } },
    }));

    const result = await transport.parse(baseRequest);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.records).toHaveLength(1);
    }
    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0]?.[0] as {
      model: string;
      response_format: { type: string };
      max_tokens: number;
      messages: { role: string; content: string }[];
    };
    expect(arg).toBeTruthy();
    expect(arg.model).toBe('deepseek-chat');
    expect(arg.response_format).toEqual({ type: 'json_object' });
    expect(arg.max_tokens).toBe(4096);
    expect(arg.messages[0]?.role).toBe('system');
    expect(arg.messages[0]?.content).toBe(PARSE_SYSTEM_PROMPT);
    expect(arg.messages[1]?.role).toBe('user');
    const meta = transport.getLastExecutionMeta();
    expect(meta?.providerHost).toBe('api.deepseek.com');
    expect(meta?.model).toBe('deepseek-chat');
    expect(meta?.configRevision).toBe(1);
  });

  // Negative: invalid JSON from provider fails visibly
  it('fails with model_output_invalid on invalid JSON content', async () => {
    const store = new MemoryProviderConfigStore();
    await store.save(
      buildProviderConfigForSave({
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-fake',
        model: 'deepseek-chat',
        existing: null,
        keepExistingKey: false,
      }),
    );
    const transport = new OpenAiCompatibleParseTransport(store, () => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'not-json{{{' } }],
          }),
        },
      },
    }));
    const result = await transport.parse(baseRequest);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_category).toBe('model_output_invalid');
      expect(result.message).toMatch(/invalid JSON/i);
    }
  });

  // Negative: schema-invalid records array fails without partial accept
  it('fails when provider JSON fails transport schema', async () => {
    const store = new MemoryProviderConfigStore();
    await store.save(
      buildProviderConfigForSave({
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-fake',
        model: 'deepseek-chat',
        existing: null,
        keepExistingKey: false,
      }),
    );
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const secretMerchant = 'SecretMerchantXYZ';
    const secretAmount = 99999;
    const transport = new OpenAiCompatibleParseTransport(store, () => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    records: [
                      {
                        direction: 'expense',
                        merchant: secretMerchant,
                        actual_cost_minor: secretAmount,
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        },
      },
    }));
    const result = await transport.parse(baseRequest);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_category).toBe('model_output_invalid');
      expect(result.message).toMatch(/schema/i);
      // User-facing message may include safe path summary, never business values/secrets
      expect(result.message).not.toContain(secretMerchant);
      expect(result.message).not.toContain(String(secretAmount));
      expect(result.message).not.toContain('sk-fake');
      expect(result.message).not.toMatch(/午饭100/);
    }

    const schemaLog = infoSpy.mock.calls
      .map((c) => c[1] as Record<string, unknown> | undefined)
      .find((payload) => payload && payload.reason === 'schema_failed');
    expect(schemaLog).toBeTruthy();
    expect(schemaLog?.error_category).toBe('model_output_invalid');
    const issues = schemaLog?.schema_issues as { path: string; code: string }[] | undefined;
    expect(Array.isArray(issues)).toBe(true);
    expect(issues!.length).toBeGreaterThan(0);
    for (const issue of issues!) {
      expect(typeof issue.path).toBe('string');
      expect(typeof issue.code).toBe('string');
      // No received values / business content in diagnostics
      expect(issue).not.toHaveProperty('message');
      expect(issue).not.toHaveProperty('received');
      expect(JSON.stringify(issue)).not.toContain(secretMerchant);
      expect(JSON.stringify(issue)).not.toContain(String(secretAmount));
    }
    const logBlob = JSON.stringify(schemaLog);
    expect(logBlob).not.toContain(secretMerchant);
    expect(logBlob).not.toContain(String(secretAmount));
    expect(logBlob).not.toContain('sk-fake');
    expect(logBlob).not.toContain(baseRequest.raw_text);
  });

  // Negative: strict schema still rejects partial records (no silent subset posting at transport)
  it('does not accept partial valid subset when one record is invalid', async () => {
    const store = new MemoryProviderConfigStore();
    await store.save(
      buildProviderConfigForSave({
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-fake',
        model: 'deepseek-chat',
        existing: null,
        keepExistingKey: false,
      }),
    );
    const transport = new OpenAiCompatibleParseTransport(store, () => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    records: [validRecord, { direction: 'expense', merchant: 'bad' }],
                  }),
                },
              },
            ],
          }),
        },
      },
    }));
    const result = await transport.parse(baseRequest);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error_category).toBe('model_output_invalid');
    }
  });

  // Positive: FakeAiParseTransport exists for tests only
  it('FakeAiParseTransport is available for test injection', async () => {
    const fake = new FakeAiParseTransport((req) => ({
      contract_version: CONTRACT_VERSION,
      request_id: req.request_id,
      status: 'ok',
      records: [],
    }));
    const res = await fake.parse(baseRequest);
    expect(res.status).toBe('ok');
  });

  // Negative: source factory documents dangerouslyAllowBrowser isolation
  it('openai-client factory isolates dangerouslyAllowBrowser', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, 'openai-client.ts'), 'utf8');
    expect(src).toMatch(/dangerouslyAllowBrowser:\s*true/);
    expect(src).toMatch(/BYOK/);
  });
});
