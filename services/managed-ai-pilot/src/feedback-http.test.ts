import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { createPilotHttpServer } from './http';
import { PilotStore } from './store';
import { testConfig } from './test-support';
import type { ParseUpstream } from './upstream';

const unusedUpstream: ParseUpstream = {
  async parse() {
    throw new Error('feedback must not call the parse provider');
  },
};

describe('managed pilot feedback HTTP contract', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function setup() {
    const config = testConfig();
    const db = openDatabase(':memory:');
    const store = new PilotStore(db, config);
    const invite = store.issueInvite('反馈测试用户');
    const activation = store.activate(invite.inviteCode, 'installation_feedback_123');
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
    const request = (method: 'GET' | 'PUT', body?: unknown, token = activation.accessToken) =>
      fetch(`http://127.0.0.1:${address.port}/feedback`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    return { activation, db, logs: () => logs, request };
  }

  it('requires a current pilot bearer credential for reads and writes', async () => {
    const { request } = await setup();
    const invalid = 'invalid-token-value-123456789012345';
    expect((await request('GET', undefined, invalid)).status).toBe(401);
    expect((await request('PUT', { willingness: 'willing' }, invalid)).status).toBe(401);
  });

  it('returns null before the anonymous subject submits feedback', async () => {
    const { request } = await setup();
    expect(await (await request('GET')).json()).toMatchObject({
      willingness: null,
      updated_at: null,
    });
  });

  it('accepts only the three willingness choices', async () => {
    const { request } = await setup();
    for (const willingness of ['willing', 'unsure', 'not_willing']) {
      expect((await request('PUT', { willingness })).status).toBe(200);
    }
    expect((await request('PUT', { willingness: 'maybe_later' })).status).toBe(400);
    expect((await request('PUT', { willingness: 'willing', comment: '账目内容' })).status).toBe(
      400,
    );
  });

  it('keeps only the latest choice for one anonymous subject', async () => {
    const { activation, db, request } = await setup();
    await request('PUT', { willingness: 'unsure' });
    await request('PUT', { willingness: 'willing' });
    expect(await (await request('GET')).json()).toMatchObject({ willingness: 'willing' });
    const row = db
      .prepare('SELECT COUNT(*) count FROM pilot_feedback WHERE subject_id = ?')
      .get(activation.subjectId) as { count: number };
    expect(row.count).toBe(1);
  });

  it('does not consume parse quota or create a provider usage request', async () => {
    const { activation, db, request } = await setup();
    await request('PUT', { willingness: 'willing' });
    const entitlement = db
      .prepare('SELECT consumed_total FROM entitlements WHERE subject_id = ?')
      .get(activation.subjectId) as { consumed_total: number };
    expect(entitlement.consumed_total).toBe(0);
    const usage = db.prepare('SELECT COUNT(*) count FROM usage_requests').get() as {
      count: number;
    };
    expect(usage.count).toBe(0);
  });

  it('does not log credentials or collect ledger and free-text fields', async () => {
    const { activation, db, logs, request } = await setup();
    await request('PUT', { willingness: 'willing' });
    expect(logs()).not.toContain(activation.accessToken);
    expect(logs()).not.toContain('willing');
    expect(
      db.prepare("SELECT 1 ok FROM pragma_table_info('pilot_feedback') WHERE name='comment'").get(),
    ).toBeUndefined();
  });
});
