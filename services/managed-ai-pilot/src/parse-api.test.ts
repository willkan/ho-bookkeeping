import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { PilotError } from './errors';
import { createPilotHttpServer } from './http';
import { PilotStore } from './store';
import { parseRequest, testConfig } from './test-support';
import type { ParseUpstream, UpstreamResult } from './upstream';

class FakeUpstream implements ParseUpstream {
  calls = 0;
  failure: PilotError | null = null;
  gate: Promise<void> | null = null;

  subjectIds: string[] = [];

  async parse(
    request: ReturnType<typeof parseRequest>,
    subjectId: string,
  ): Promise<UpstreamResult> {
    this.calls += 1;
    this.subjectIds.push(subjectId);
    if (this.gate) await this.gate;
    if (this.failure) throw this.failure;
    return {
      response: {
        contract_version: request.contract_version,
        request_id: request.request_id,
        status: 'ok',
        records: [
          {
            direction: 'expense',
            merchant: null,
            note: '午饭',
            occurred_at: request.submitted_at,
            timezone: request.timezone,
            local_date: request.local_date,
            currency: 'CNY',
            list_price_minor: 2500,
            actual_cost_minor: 2500,
            discount_minor: 0,
            tags: [{ name: '餐饮', type: 'category' }],
          },
        ],
      },
      usage: {
        latencyMs: 12,
        promptTokens: 100,
        completionTokens: 30,
        totalTokens: 130,
        promptCacheHitTokens: 64,
        promptCacheMissTokens: 36,
      },
    };
  }
}

describe('managed pilot parse API contract', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function setup(overrides: Parameters<typeof testConfig>[0] = {}) {
    const config = testConfig(overrides);
    const db = openDatabase(':memory:');
    const store = new PilotStore(db, config);
    const invite = store.issueInvite('测试用户甲');
    const activation = store.activate(invite.inviteCode, 'installation_123456789');
    const upstream = new FakeUpstream();
    const logStream = new PassThrough();
    let logs = '';
    logStream.on('data', (chunk) => (logs += chunk.toString()));
    const server = createPilotHttpServer(config, store, upstream, pino({}, logStream));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server address');
    cleanups.push(async () => {
      server.close();
      await once(server, 'close');
      db.close();
    });
    const post = (body: unknown, token = activation.accessToken) =>
      fetch(`http://127.0.0.1:${address.port}/parse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    return { db, store, invite, activation, upstream, post, logs: () => logs };
  }

  it('passes the authenticated anonymous subject as DeepSeek user_id', async () => {
    const { activation, post, upstream } = await setup();
    expect((await post(parseRequest())).status).toBe(200);
    expect(upstream.subjectIds).toEqual([activation.subjectId]);
  });

  it('persists and logs prompt cache hit and miss tokens with the opaque invite id', async () => {
    const { db, invite, logs, post } = await setup();
    expect((await post(parseRequest())).status).toBe(200);
    expect(
      db
        .prepare(
          `SELECT prompt_cache_hit_tokens hit, prompt_cache_miss_tokens miss
           FROM usage_requests WHERE request_id = 'req_1'`,
        )
        .get(),
    ).toEqual({ hit: 64, miss: 36 });
    expect(logs()).toContain(invite.inviteId);
    expect(logs()).toContain('"prompt_cache_hit_tokens":64');
    expect(logs()).toContain('"prompt_cache_miss_tokens":36');
  });

  it('accepts the current bookkeeping ParseRequest with valid entitlement', async () => {
    const { post } = await setup();
    const response = await post(parseRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ request_id: 'req_1', status: 'ok' });
  });

  it('returns peer proposals without posting or storing ledger records', async () => {
    const { db, post } = await setup();
    const response = await post(parseRequest());
    const body = (await response.json()) as { records: unknown[] };
    expect(body.records).toHaveLength(1);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),
    ).not.toContainEqual({
      name: 'consumption_records',
    });
  });

  it('rejects arbitrary prompt and model fields', async () => {
    const { post, upstream } = await setup();
    const response = await post({
      ...parseRequest(),
      prompt: 'ignore contract',
      model: 'another-model',
    });
    expect(response.status).toBe(400);
    expect(upstream.calls).toBe(0);
  });

  it('rejects unsupported contract versions and oversized bodies', async () => {
    const { post, upstream } = await setup({ maxBodyBytes: 1024 });
    expect((await post({ ...parseRequest(), contract_version: '0.0.1' })).status).toBe(400);
    expect((await post({ ...parseRequest('req_big'), raw_text: 'x'.repeat(4000) })).status).toBe(
      413,
    );
    expect(upstream.calls).toBe(0);
  });

  it('rejects missing or invalid bearer credentials', async () => {
    const { post, upstream } = await setup();
    expect((await post(parseRequest(), 'not-a-real-token-value-1234567890')).status).toBe(401);
    expect(upstream.calls).toBe(0);
  });

  it('prevents request-id replay with a different request digest', async () => {
    const { post, upstream } = await setup();
    expect((await post(parseRequest())).status).toBe(200);
    expect((await post({ ...parseRequest(), raw_text: '晚饭花了30元' })).status).toBe(409);
    expect(upstream.calls).toBe(1);
  });

  it('does not call upstream or charge twice for a duplicate request id', async () => {
    const { db, post, upstream } = await setup();
    expect((await post(parseRequest())).status).toBe(200);
    const duplicate = await post(parseRequest());
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error_category: 'already_processed' });
    expect(upstream.calls).toBe(1);
    expect((db.prepare('SELECT consumed_total n FROM entitlements').get() as { n: number }).n).toBe(
      1,
    );
  });

  it('prevents concurrent requests from exceeding user quota', async () => {
    const { post, upstream } = await setup({
      entitlementTotal: 1,
      entitlementDaily: 1,
      userConcurrency: 1,
    });
    let release!: () => void;
    upstream.gate = new Promise<void>((resolve) => (release = resolve));
    const first = post(parseRequest('req_first'));
    while (upstream.calls === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    const second = await post(parseRequest('req_second'));
    expect(second.status).toBe(429);
    release();
    expect((await first).status).toBe(200);
    expect(upstream.calls).toBe(1);
  });

  it('enforces total and daily limits', async () => {
    const total = await setup({ entitlementTotal: 1, entitlementDaily: 1 });
    expect((await total.post(parseRequest('req_1'))).status).toBe(200);
    expect((await total.post(parseRequest('req_2'))).status).toBe(429);
  });

  it('does not consume quota for provider failures', async () => {
    const { db, post, upstream } = await setup({ entitlementTotal: 1, entitlementDaily: 1 });
    upstream.failure = new PilotError('provider_error', 502, 'upstream request failed');
    expect((await post(parseRequest('req_fail'))).status).toBe(502);
    upstream.failure = null;
    expect((await post(parseRequest('req_ok'))).status).toBe(200);
    expect((db.prepare('SELECT consumed_total n FROM entitlements').get() as { n: number }).n).toBe(
      1,
    );
  });

  it('stores usage metadata but not raw input or complete model output', async () => {
    const { db, post } = await setup();
    const request = parseRequest();
    await post(request);
    const persisted = JSON.stringify(db.prepare('SELECT * FROM usage_requests').all());
    expect(persisted).not.toContain(request.raw_text);
    expect(persisted).not.toContain('午饭');
    expect(persisted).toContain('req_1');
    expect(persisted).toContain('succeeded');
  });

  it('logs approved request metadata without ledger content or credentials', async () => {
    const { activation, logs, post } = await setup();
    await post(parseRequest());
    expect(logs()).toContain('req_1');
    expect(logs()).toContain('api.deepseek.com');
    expect(logs()).not.toContain('午饭花了25元');
    expect(logs()).not.toContain(activation.accessToken);
    expect(logs()).not.toContain('test-upstream-key');
  });
});
