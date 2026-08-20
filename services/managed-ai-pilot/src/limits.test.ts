import { afterEach, describe, expect, it } from 'vitest';
import { CONTRACT_VERSION } from '@bookkeeping/contracts';
import { openDatabase, type PilotDatabase } from './database';
import { PilotError } from './errors';
import { PilotStore } from './store';
import { testConfig } from './test-support';

describe('managed pilot durable limits', () => {
  let db: PilotDatabase | null = null;
  afterEach(() => {
    db?.close();
    db = null;
  });

  function setup(overrides: Parameters<typeof testConfig>[0]) {
    const config = testConfig(overrides);
    db = openDatabase(':memory:');
    const store = new PilotStore(db, config);
    const firstInvite = store.issueInvite('测试用户甲');
    const secondInvite = store.issueInvite('测试用户乙');
    const first = store.activate(firstInvite.inviteCode, 'installation_first_1234');
    const second = store.activate(secondInvite.inviteCode, 'installation_second_123');
    return { store, first, second };
  }

  it('enforces the per-subject minute rate in SQLite', () => {
    const { store, first } = setup({ userRatePerMinute: 1, userConcurrency: 10 });
    store.reserve(first.subjectId, 'req_1', 'digest_1', CONTRACT_VERSION);
    expect(() =>
      store.reserve(first.subjectId, 'req_2', 'digest_2', CONTRACT_VERSION),
    ).toThrowError(PilotError);
  });

  it('enforces the global minute rate across subjects', () => {
    const { store, first, second } = setup({ globalRatePerMinute: 1, userConcurrency: 10 });
    store.reserve(first.subjectId, 'req_1', 'digest_1', CONTRACT_VERSION);
    expect(() =>
      store.reserve(second.subjectId, 'req_2', 'digest_2', CONTRACT_VERSION),
    ).toThrowError(PilotError);
  });

  it('enforces the global concurrent reservation limit', () => {
    const { store, first, second } = setup({ globalConcurrency: 1, userConcurrency: 10 });
    store.reserve(first.subjectId, 'req_1', 'digest_1', CONTRACT_VERSION);
    expect(() =>
      store.reserve(second.subjectId, 'req_2', 'digest_2', CONTRACT_VERSION),
    ).toThrowError(PilotError);
  });

  it('enforces the daily successful-parse limit', () => {
    const { store, first } = setup({ entitlementDaily: 1, userConcurrency: 10 });
    store.reserve(first.subjectId, 'req_1', 'digest_1', CONTRACT_VERSION);
    store.succeed(first.subjectId, 'req_1', {
      latencyMs: 10,
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      promptCacheHitTokens: 0,
      promptCacheMissTokens: 1,
    });
    expect(() =>
      store.reserve(first.subjectId, 'req_2', 'digest_2', CONTRACT_VERSION),
    ).toThrowError(PilotError);
  });
});
