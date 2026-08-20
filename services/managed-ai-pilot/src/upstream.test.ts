import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { parseRequest, testConfig } from './test-support';
import { OpenAiParseUpstream } from './upstream';

describe('DeepSeek Chat Completions adapter', () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('sends anonymous user_id and captures provider cache token usage', async () => {
    let requestBody: unknown;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const parse = parseRequest();
      const body = JSON.stringify({
        id: 'completion_test',
        object: 'chat.completion',
        created: 1,
        model: 'deepseek-v4-flash',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify({
                records: [
                  {
                    direction: 'expense',
                    merchant: null,
                    note: '测试',
                    occurred_at: parse.submitted_at,
                    timezone: parse.timezone,
                    local_date: parse.local_date,
                    currency: 'CNY',
                    list_price_minor: 100,
                    actual_cost_minor: 100,
                    discount_minor: 0,
                    tags: [],
                  },
                ],
              }),
            },
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          prompt_cache_hit_tokens: 64,
          prompt_cache_miss_tokens: 36,
        },
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(body);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server address');
    cleanups.push(async () => {
      server.close();
      await once(server, 'close');
    });

    const subjectId = 'sub_12345678-1234-1234-1234-123456789abc';
    const upstream = new OpenAiParseUpstream(
      testConfig({
        upstreamBaseUrl: `http://127.0.0.1:${address.port}`,
        upstreamHost: `127.0.0.1:${address.port}`,
        upstreamModel: 'deepseek-v4-flash',
      }),
    );
    const result = await upstream.parse(parseRequest(), subjectId);

    expect(requestBody).toMatchObject({ model: 'deepseek-v4-flash', user_id: subjectId });
    expect(result.usage).toMatchObject({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      promptCacheHitTokens: 64,
      promptCacheMissTokens: 36,
    });
  });
});
