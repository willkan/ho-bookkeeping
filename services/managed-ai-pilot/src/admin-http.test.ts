import { CONTRACT_VERSION } from '@bookkeeping/contracts';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { Script } from 'node:vm';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { createPilotHttpServer } from './http';
import { PilotStore } from './store';
import { testConfig } from './test-support';
import type { ParseUpstream } from './upstream';

const unusedUpstream: ParseUpstream = {
  async parse() {
    throw new Error('not used by admin tests');
  },
};

function inviteBody(
  recipientLabel: string,
  overrides: Partial<{
    entitlement_days: number;
    total_limit: number;
    daily_limit: number;
  }> = {},
) {
  return {
    recipient_label: recipientLabel,
    entitlement_days: 30,
    total_limit: 200,
    daily_limit: 20,
    ...overrides,
  };
}

describe('managed pilot admin HTTP contract', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function setup() {
    const config = testConfig();
    const db = openDatabase(':memory:');
    const store = new PilotStore(db, config);
    const logStream = new PassThrough();
    let logs = '';
    logStream.on('data', (chunk) => (logs += chunk.toString()));
    const server = createPilotHttpServer(config, store, unusedUpstream, pino({}, logStream));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server address');
    cleanups.push(async () => {
      server.close();
      await once(server, 'close');
      db.close();
    });
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const authorization = `Basic ${Buffer.from(
      `${config.adminUsername}:${config.adminPassword}`,
    ).toString('base64')}`;
    const get = (path: string, authenticated = true) =>
      fetch(`${baseUrl}${path}`, {
        headers: authenticated ? { authorization } : {},
      });
    const post = (path: string, body: unknown, origin = config.publicOrigin) =>
      fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { authorization, origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    return { config, db, store, get, post, logs: () => logs };
  }

  it('rejects every admin page and API request without valid administrator credentials', async () => {
    const { get } = await setup();
    const page = await get('/admin', false);
    expect(page.status).toBe(401);
    expect(page.headers.get('www-authenticate')).toContain('Basic');
    expect((await get('/admin/api/overview', false)).status).toBe(401);
  });

  it('serves the authenticated operator interface with a restrictive content policy', async () => {
    const { get } = await setup();
    const page = await get('/admin');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await page.text();
    expect(html).toContain('邀请码颁发与托管 AI 用量对账');
    expect(html).toContain('promptCacheHitTokens');
    const inlineScript = html.match(/<script nonce="[^"]+">([\s\S]+)<\/script>/)?.[1];
    if (!inlineScript) throw new Error('missing inline admin script');
    expect(() => new Script(inlineScript)).not.toThrow();
  });

  it('issues one invite with a required recipient label and reveals plaintext exactly once', async () => {
    const { db, get, post } = await setup();
    const response = await post('/admin/api/invites', inviteBody('首批用户甲'));
    expect(response.status).toBe(201);
    const issued = (await response.json()) as { inviteCode: string; inviteId: string };
    expect(issued.inviteCode).toMatch(/^bkp_/);
    const overview = await (await get('/admin/api/overview')).text();
    expect(overview).toContain('首批用户甲');
    expect(overview).toContain(issued.inviteId);
    expect(overview).not.toContain(issued.inviteCode);
    expect(JSON.stringify(db.prepare('SELECT * FROM invites').all())).not.toContain(
      issued.inviteCode,
    );
  });

  it('requires and persists per-invite entitlement days, total and daily limits', async () => {
    const { get, post, store } = await setup();
    const response = await post(
      '/admin/api/invites',
      inviteBody('定制额度用户', { entitlement_days: 45, total_limit: 500, daily_limit: 35 }),
    );
    expect(response.status).toBe(201);
    const issued = (await response.json()) as { inviteCode: string };
    const overview = (await (await get('/admin/api/overview')).json()) as {
      invites: Array<Record<string, unknown>>;
    };
    expect(overview.invites[0]).toMatchObject({
      entitlementDays: 45,
      totalLimit: 500,
      dailyLimit: 35,
    });
    expect(store.activate(issued.inviteCode, 'installation_custom_limits')).toMatchObject({
      totalLimit: 500,
      dailyLimit: 35,
    });
  });

  it('rejects invalid or internally inconsistent per-invite limits', async () => {
    const { post } = await setup();
    expect((await post('/admin/api/invites', { recipient_label: '缺少额度' })).status).toBe(400);
    expect(
      (
        await post(
          '/admin/api/invites',
          inviteBody('日额度过大', { total_limit: 10, daily_limit: 11 }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await post('/admin/api/invites', inviteBody('零额度', { total_limit: 0, daily_limit: 0 })))
        .status,
    ).toBe(400);
  });

  it('lists issued invites with activation state and token aggregates but never plaintext codes', async () => {
    const { get, post, store } = await setup();
    const issued = (await (await post('/admin/api/invites', inviteBody('首批用户乙'))).json()) as {
      inviteCode: string;
      inviteId: string;
    };
    const activation = store.activate(issued.inviteCode, 'installation_admin_test_1');
    store.reserve(activation.subjectId, 'req_admin_1', 'digest_1', CONTRACT_VERSION);
    store.succeed(activation.subjectId, 'req_admin_1', {
      latencyMs: 123,
      promptTokens: 100,
      completionTokens: 30,
      totalTokens: 130,
      promptCacheHitTokens: 64,
      promptCacheMissTokens: 36,
    });
    const body = (await (await get('/admin/api/overview')).json()) as {
      invites: Array<Record<string, unknown>>;
    };
    expect(body.invites[0]).toMatchObject({
      inviteId: issued.inviteId,
      recipientLabel: '首批用户乙',
      successfulRequests: 1,
      promptTokens: 100,
      promptCacheHitTokens: 64,
      promptCacheMissTokens: 36,
      completionTokens: 30,
      totalTokens: 130,
    });
    expect(JSON.stringify(body)).not.toContain(issued.inviteCode);
  });

  it('lists request-level token and cache-token metadata for reconciliation', async () => {
    const { get, post, store } = await setup();
    const issued = (await (await post('/admin/api/invites', inviteBody('首批用户丙'))).json()) as {
      inviteCode: string;
      inviteId: string;
    };
    const activation = store.activate(issued.inviteCode, 'installation_admin_test_2');
    store.reserve(activation.subjectId, 'req_admin_2', 'digest_2', CONTRACT_VERSION);
    store.succeed(activation.subjectId, 'req_admin_2', {
      latencyMs: 456,
      promptTokens: 200,
      completionTokens: 50,
      totalTokens: 250,
      promptCacheHitTokens: 128,
      promptCacheMissTokens: 72,
    });
    const body = (await (await get('/admin/api/overview')).json()) as {
      requests: Array<Record<string, unknown>>;
    };
    expect(body.requests[0]).toMatchObject({
      inviteId: issued.inviteId,
      requestId: 'req_admin_2',
      promptCacheHitTokens: 128,
      promptCacheMissTokens: 72,
      latencyMs: 456,
    });
  });

  it('projects the latest willingness choice beside its invite without exposing a new identity', async () => {
    const { get, post, store } = await setup();
    const issued = (await (
      await post('/admin/api/invites', inviteBody('首批用户反馈'))
    ).json()) as { inviteCode: string };
    const activation = store.activate(issued.inviteCode, 'installation_admin_feedback');
    store.upsertFeedback(activation.subjectId, 'willing');
    const body = (await (await get('/admin/api/overview')).json()) as {
      invites: Array<Record<string, unknown>>;
    };
    expect(body.invites[0]).toMatchObject({
      subjectId: activation.subjectId,
      willingness: 'willing',
    });
  });

  it('revokes an invite by opaque invite id without physically deleting its usage history', async () => {
    const { db, post, store } = await setup();
    const issued = (await (await post('/admin/api/invites', inviteBody('首批用户丁'))).json()) as {
      inviteCode: string;
      inviteId: string;
    };
    const activation = store.activate(issued.inviteCode, 'installation_admin_test_3');
    store.reserve(activation.subjectId, 'req_admin_3', 'digest_3', CONTRACT_VERSION);
    store.fail(activation.subjectId, 'req_admin_3', 'provider_error', 10);
    expect((await post(`/admin/api/invites/${issued.inviteId}/revoke`, {})).status).toBe(200);
    expect(() => store.authenticate(activation.accessToken)).toThrow();
    expect(
      (db.prepare('SELECT COUNT(*) count FROM usage_requests').get() as { count: number }).count,
    ).toBe(1);
  });

  it('rejects cross-origin mutations and invalid recipient labels', async () => {
    const { post } = await setup();
    expect(
      (await post('/admin/api/invites', inviteBody('用户'), 'https://evil.example')).status,
    ).toBe(403);
    expect((await post('/admin/api/invites', inviteBody('   '))).status).toBe(400);
  });

  it('never logs administrator credentials or recipient labels', async () => {
    const { config, logs, post } = await setup();
    expect((await post('/admin/api/invites', inviteBody('不可进入日志的姓名'))).status).toBe(201);
    expect(logs()).not.toContain(config.adminPassword);
    expect(logs()).not.toContain('不可进入日志的姓名');
    expect(logs()).toContain('issue_invite');
  });
});
