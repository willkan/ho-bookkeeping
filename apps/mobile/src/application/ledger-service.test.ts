import { CONTRACT_VERSION, type CandidateRecord } from '@bookkeeping/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProviderConfigForSave } from '../infrastructure/ai/provider-config';
import { MemoryProviderConfigStore } from '../infrastructure/ai/provider-config-store';
import {
  FakeAiParseTransport,
  OpenAiCompatibleParseTransport,
  UnconfiguredAiParseTransport,
} from '../infrastructure/ai/transport';
import { openBetterSqliteDatabase } from '../infrastructure/db/better-sqlite-adapter';
import { migrate, seedDefaults } from '../infrastructure/db/migrations';
import { LedgerRepository } from '../infrastructure/db/repositories';
import type { SqliteDatabase } from '../infrastructure/db/sqlite-database';
import { SequenceIdGenerator } from '../infrastructure/ids/sequence-id-generator';
import { LedgerService } from './ledger-service';

function expense(
  merchant: string,
  yuan: number,
  overrides: Partial<CandidateRecord> = {},
): CandidateRecord {
  const minor = yuan * 100;
  return {
    direction: 'expense',
    merchant,
    note: null,
    occurred_at: '2026-07-16T10:18:00.000Z',
    timezone: 'Asia/Shanghai',
    local_date: '2026-07-16',
    currency: 'CNY',
    list_price_minor: minor,
    actual_cost_minor: minor,
    discount_minor: 0,
    tags: [],
    ...overrides,
  };
}

function setup(handler: ConstructorParameters<typeof FakeAiParseTransport>[0]): {
  service: LedgerService;
  db: SqliteDatabase;
  repo: LedgerRepository;
} {
  const db = openBetterSqliteDatabase(':memory:');
  migrate(db);
  seedDefaults(db);
  const ids = new SequenceIdGenerator();
  const repo = new LedgerRepository(db, ids);
  const service = new LedgerService(repo, new FakeAiParseTransport(handler), ids);
  return { service, db, repo };
}

function recordsForDate(service: LedgerService, localDate: string) {
  return service.listLedger().records.filter((record) => record.localDate === localDate);
}

describe('ledger state machine / tracer bullet', () => {
  it('lists unresolved inputs first across all submission dates and newest first', async () => {
    const { service } = setup(() => {
      throw new Error('not processed');
    });
    const older = await service.submitRawInput({
      rawText: '前天买菜30元',
      submittedAt: '2026-07-15T10:00:00.000Z',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-15',
    });
    const newer = await service.submitRawInput({
      rawText: '昨天打车26元',
      submittedAt: '2026-07-16T10:00:00.000Z',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });

    const pending = service.listLedger().pending;

    expect(pending.map((item) => item.raw.id)).toEqual([newer.rawInput.id, older.rawInput.id]);
  });
  it('lists effective records after unresolved inputs by occurred date descending', async () => {
    const { service } = setup((request) => ({
      contract_version: CONTRACT_VERSION,
      request_id: request.request_id,
      status: 'ok',
      records: [
        request.raw_text.includes('昨天')
          ? expense('昨天的店', 20, {
              occurred_at: '2026-07-15T10:00:00.000Z',
              local_date: '2026-07-15',
            })
          : expense('前天的店', 10, {
              occurred_at: '2026-07-14T10:00:00.000Z',
              local_date: '2026-07-14',
            }),
      ],
    }));
    const older = await service.submitRawInput({
      rawText: '前天消费10元',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    const newer = await service.submitRawInput({
      rawText: '昨天消费20元',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    await service.processJob(older.job.id);
    await service.processJob(newer.job.id);
    await service.submitRawInput({
      rawText: '今天还在解析',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });

    const ledger = service.listLedger();

    expect(ledger.pending).toHaveLength(1);
    expect(ledger.records.map((record) => record.merchant)).toEqual(['昨天的店', '前天的店']);
  });
  it('projects an all-withdrawn input outside the pending count', async () => {
    const { service } = setup((request) => ({
      contract_version: CONTRACT_VERSION,
      request_id: request.request_id,
      status: 'ok',
      records: [expense('已撤销的店', 25)],
    }));
    await service.submitRawInput({
      rawText: '午饭花了25元',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    await service.processEligibleJobs();
    const record = service.listLedger().records[0]!;

    service.softDeleteConsumption(record.id);
    const ledger = service.listLedger();

    expect(ledger.pending).toHaveLength(0);
    expect(ledger.records).toHaveLength(0);
    expect(ledger.withdrawn.map((raw) => raw.rawText)).toEqual(['午饭花了25元']);
  });

  it('classifies an AI-created category tag in the consumption breakdown immediately', async () => {
    const { service } = setup((request) => ({
      contract_version: CONTRACT_VERSION,
      request_id: request.request_id,
      status: 'ok',
      records: [
        expense('家乡菜', 100, {
          tags: [{ name: '餐饮', type: 'category' }],
        }),
      ],
    }));
    service.createTag('category', '交通');
    const { rawInput } = await service.submitRawInput({
      rawText: '在家乡菜吃午饭花了100元',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    await service.processEligibleJobs();
    expect(service.getRawInput(rawInput.id)?.lifecycleStatus).toBe('posted');

    const group = service.listExclusiveGroups().find(({ name }) => name === '消费类目');
    expect(group).toBeDefined();
    const result = service.breakdown(
      {
        range: {
          kind: 'time',
          startLocalDate: '2026-07-16',
          endLocalDate: '2026-07-16',
        },
        tagIds: [],
        tagMatch: 'and',
      },
      group!.id,
    );
    expect(result.buckets).toEqual([
      expect.objectContaining({ label: '餐饮', amountMinor: 10000, isUnclassified: false }),
    ]);
  });

  it('submitting a raw input returns after the local transaction without invoking AI', async () => {
    let calls = 0;
    const { service } = setup(() => {
      calls += 1;
      throw new Error('AI must not run during submit');
    });
    const result = await service.submitRawInput({
      rawText: '午饭花了25元',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    expect(result.rawInput.lifecycleStatus).toBe('pending_parse');
    expect(calls).toBe(0);
  });

  it('preserves source order for peer records sharing the same occurred_at', async () => {
    const { service } = setup((request) => ({
      contract_version: CONTRACT_VERSION,
      request_id: request.request_id,
      status: 'ok',
      records: lastRecords,
    }));
    await service.submitRawInput({
      rawText: '买xx花了100，买yy花了200，买zz花了20',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    await service.processEligibleJobs();
    expect(recordsForDate(service, '2026-07-16').map((record) => record.merchant)).toEqual([
      'XX',
      'YY',
      'ZZ',
    ]);
  });

  it('projects an all-withdrawn posted input as withdrawn instead of parse_failed', async () => {
    const { service } = setup((request) => ({
      contract_version: CONTRACT_VERSION,
      request_id: request.request_id,
      status: 'ok',
      records: [expense('午饭', 25)],
    }));
    await service.submitRawInput({
      rawText: '午饭花了25元',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    await service.processEligibleJobs();
    service.softDeleteConsumption(recordsForDate(service, '2026-07-16')[0]!.id);
    expect(service.listLedger().withdrawn[0]?.lifecycleStatus).toBe('posted');
  });

  it('lets a user correct an existing tag name and semantic type', () => {
    const { service } = setup(() => {
      throw new Error('not used');
    });
    const tag = service.createTag('category', '江西旅游');
    service.updateTagIdentity(tag.id, 'trip', '江西旅游');
    expect(service.listTags().find((item) => item.id === tag.id)?.type).toBe('trip');
    const category = service.listExclusiveGroups().find((group) => group.name === '消费类目');
    expect(category?.tagIds).not.toContain(tag.id);
  });

  let lastRecords: CandidateRecord[] = [];

  beforeEach(() => {
    lastRecords = [expense('XX', 100), expense('YY', 200), expense('ZZ', 20)];
  });

  // Positive: raw input + unique parse job saved atomically
  it('atomically saves raw input and unique pending parse job', async () => {
    const { service, repo } = setup(() => ({
      contract_version: CONTRACT_VERSION,
      request_id: 'will-be-replaced',
      status: 'ok',
      records: lastRecords,
    }));

    const { rawInput, job } = await service.submitRawInput({
      rawText: '买xx花了100，买yy花了200，买zz花了20',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });

    expect(rawInput.lifecycleStatus).toBe('pending_parse');
    expect(job.rawInputId).toBe(rawInput.id);
    expect(job.status).toBe('pending');
    expect(repo.getParseJobByRawInputId(rawInput.id)?.id).toBe(job.id);
  });

  // Positive: three peer records posted independently
  it('posts three independent consumption records from one input', async () => {
    const { service } = setup((req) => ({
      contract_version: CONTRACT_VERSION,
      request_id: req.request_id,
      status: 'ok',
      records: lastRecords,
    }));

    const { rawInput } = await service.submitRawInput({
      rawText: '买xx花了100，买yy花了200，买zz花了20',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    await service.processEligibleJobs();

    expect(service.getRawInput(rawInput.id)?.lifecycleStatus).toBe('posted');
    const records = recordsForDate(service, '2026-07-16').filter(
      (r) => r.rawInputId === rawInput.id,
    );
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.actualCostMinor).sort((a, b) => a - b)).toEqual([
      2000, 10000, 20000,
    ]);
  });

  // Positive: restart resumes pending job
  it('resumes eligible jobs after simulated restart', async () => {
    let calls = 0;
    const { service, db } = setup((req) => {
      calls += 1;
      return {
        contract_version: CONTRACT_VERSION,
        request_id: req.request_id,
        status: 'ok',
        records: lastRecords,
      };
    });

    await service.submitRawInput({
      rawText: '买xx花了100',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });

    // Simulate app restart: new service instance, same SQLite.
    const ids2 = new SequenceIdGenerator();
    const repo2 = new LedgerRepository(db, ids2);
    const service2 = new LedgerService(
      repo2,
      new FakeAiParseTransport((req) => ({
        contract_version: CONTRACT_VERSION,
        request_id: req.request_id,
        status: 'ok',
        records: [expense('XX', 100)],
      })),
      ids2,
    );
    await service2.processEligibleJobs();
    expect(recordsForDate(service2, '2026-07-16')).toHaveLength(1);
    expect(calls).toBe(0); // first service never ran
  });

  // Negative: one invalid candidate blocks partial posting
  it('does not partially post when one candidate is invalid', async () => {
    const { service } = setup((req) => ({
      contract_version: CONTRACT_VERSION,
      request_id: req.request_id,
      status: 'ok',
      records: [
        expense('XX', 100),
        expense('YY', 200, {
          actual_cost_minor: 19999,
        }),
        expense('ZZ', 20),
      ],
    }));

    const { rawInput } = await service.submitRawInput({
      rawText: 'multi',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    await service.processEligibleJobs();

    const raw = service.getRawInput(rawInput.id);
    expect(raw?.lifecycleStatus).toBe('parse_failed');
    expect(recordsForDate(service, '2026-07-16')).toHaveLength(0);
  });

  it('rejects a candidate whose occurred instant disagrees with its local date', async () => {
    const { service } = setup((request) => ({
      contract_version: CONTRACT_VERSION,
      request_id: request.request_id,
      status: 'ok',
      records: [
        expense('跨日错误', 10, {
          occurred_at: '2026-07-16T16:30:00.000Z',
          timezone: 'Asia/Shanghai',
          local_date: '2026-07-16',
        }),
      ],
    }));
    const { rawInput } = await service.submitRawInput({
      rawText: '昨天消费10元',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });

    await service.processEligibleJobs();

    expect(service.getRawInput(rawInput.id)?.lifecycleStatus).toBe('parse_failed');
    expect(service.listLedger().records).toHaveLength(0);
  });

  // Negative: late response with wrong request_id cannot attach
  it('rejects response whose request_id does not match the job', async () => {
    const { service } = setup(() => ({
      contract_version: CONTRACT_VERSION,
      request_id: 'someone-else',
      status: 'ok',
      records: [expense('XX', 100)],
    }));

    const { rawInput } = await service.submitRawInput({
      rawText: '买xx花了100',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    await service.processEligibleJobs();
    expect(service.getRawInput(rawInput.id)?.lifecycleStatus).toBe('parse_failed');
    expect(recordsForDate(service, '2026-07-16')).toHaveLength(0);
  });

  // Positive: confirm-before-post does not auto-post
  it('enters pending_confirm when confirm mode is enabled', async () => {
    const { service } = setup((req) => ({
      contract_version: CONTRACT_VERSION,
      request_id: req.request_id,
      status: 'ok',
      records: [expense('XX', 100)],
    }));
    service.setConfirmMode('confirm_before_post');
    const { rawInput } = await service.submitRawInput({
      rawText: '买xx花了100',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    await service.processEligibleJobs();
    expect(service.getRawInput(rawInput.id)?.lifecycleStatus).toBe('pending_confirm');
    expect(recordsForDate(service, '2026-07-16')).toHaveLength(0);
    await service.confirmPending(rawInput.id);
    expect(recordsForDate(service, '2026-07-16')).toHaveLength(1);
  });

  // Positive: manual edit does not rewrite original text or siblings
  it('manual edit updates one record without changing siblings or original text', async () => {
    const { service } = setup((req) => ({
      contract_version: CONTRACT_VERSION,
      request_id: req.request_id,
      status: 'ok',
      records: lastRecords,
    }));
    const { rawInput } = await service.submitRawInput({
      rawText: '买xx花了100，买yy花了200，买zz花了20',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    await service.processEligibleJobs();
    const records = recordsForDate(service, '2026-07-16').filter(
      (r) => r.rawInputId === rawInput.id,
    );
    const xx = records.find((r) => r.merchant === 'XX')!;
    service.editConsumption({
      id: xx.id,
      direction: 'expense',
      merchant: 'XX-edited',
      note: null,
      occurredAt: xx.occurredAt,
      timezone: xx.timezone,
      localDate: xx.localDate,
      listPriceMinor: 10000,
      actualCostMinor: 10000,
      discountMinor: 0,
      tagIds: [],
      modeId: xx.modeId,
      includeInModeStats: xx.includeInModeStats,
    });
    expect(service.getRawInput(rawInput.id)?.rawText).toContain('买xx花了100');
    expect(service.getConsumption(xx.id)?.merchant).toBe('XX-edited');
    expect(service.getConsumption(records.find((r) => r.merchant === 'YY')!.id)?.merchant).toBe(
      'YY',
    );
  });

  // Positive: soft delete excluded from ledger stats projection path
  it('soft-deleted records are absent from effective ledger list', async () => {
    const { service } = setup((req) => ({
      contract_version: CONTRACT_VERSION,
      request_id: req.request_id,
      status: 'ok',
      records: [expense('XX', 100)],
    }));
    await service.submitRawInput({
      rawText: '买xx花了100',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    await service.processEligibleJobs();
    const id = recordsForDate(service, '2026-07-16')[0]!.id;
    service.softDeleteConsumption(id);
    expect(recordsForDate(service, '2026-07-16')).toHaveLength(0);
    service.undoSoftDelete(id);
    expect(recordsForDate(service, '2026-07-16')).toHaveLength(1);
  });

  it('posts coupon use as paid amount plus discount without coupon identity', async () => {
    const { service } = setup((req) => ({
      contract_version: CONTRACT_VERSION,
      request_id: req.request_id,
      status: 'ok',
      records: [
        expense('菜', 300, {
          occurred_at: '2026-07-12T10:18:00.000Z',
          local_date: '2026-07-12',
          list_price_minor: 32000,
          actual_cost_minor: 30000,
          discount_minor: 2000,
        }),
      ],
    }));
    await service.submitRawInput({
      rawText: '买菜实付300，优惠券抵扣20',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-12',
    });
    await service.processEligibleJobs();
    const grocery = recordsForDate(service, '2026-07-12')[0]!;
    expect(grocery.actualCostMinor).toBe(30000);
    expect(grocery.listPriceMinor).toBe(32000);
    expect(grocery.discountMinor).toBe(2000);
  });

  // Negative: missing BYOK config fails job without losing the job row
  it('missing provider config fails parse job explicitly and keeps the job', async () => {
    const db = openBetterSqliteDatabase(':memory:');
    migrate(db);
    seedDefaults(db);
    const ids = new SequenceIdGenerator();
    const repo = new LedgerRepository(db, ids);
    const service = new LedgerService(repo, new UnconfiguredAiParseTransport(), ids);
    const { rawInput, job } = await service.submitRawInput({
      rawText: '午饭100',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    await service.processEligibleJobs();
    expect(service.getRawInput(rawInput.id)?.lifecycleStatus).toBe('parse_failed');
    const failed = repo.getParseJob(job.id);
    expect(failed).toBeTruthy();
    expect(failed?.status).toMatch(/failed/);
    expect(failed?.lastErrorCategory).toBe('invalid_request');
    // Job row retained for retry after user configures provider
    expect(repo.getParseJobByRawInputId(rawInput.id)?.id).toBe(job.id);
  });

  // Positive: multi-record atomic local validation with BYOK transport + execution meta
  it('posts multi-record list via OpenAiCompatible transport and records non-secret meta', async () => {
    const store = new MemoryProviderConfigStore();
    await store.save(
      buildProviderConfigForSave({
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-fake-meta-test',
        model: 'deepseek-chat',
        existing: null,
        keepExistingKey: false,
      }),
    );
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              records: [expense('XX', 100), expense('YY', 200), expense('ZZ', 20)],
            }),
          },
        },
      ],
    });
    const db = openBetterSqliteDatabase(':memory:');
    migrate(db);
    seedDefaults(db);
    const ids = new SequenceIdGenerator();
    const repo = new LedgerRepository(db, ids);
    const transport = new OpenAiCompatibleParseTransport(store, () => ({
      chat: { completions: { create } },
    }));
    const service = new LedgerService(repo, transport, ids);
    const { rawInput, job } = await service.submitRawInput({
      rawText: '买xx花了100，买yy花了200，买zz花了20',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    await service.processEligibleJobs();
    expect(recordsForDate(service, '2026-07-16')).toHaveLength(3);
    const done = repo.getParseJob(job.id);
    expect(done?.status).toBe('succeeded');
    expect(done?.providerHost).toBe('api.deepseek.com');
    expect(done?.modelVersion).toBe('deepseek-chat');
    expect(done?.configRevision).toBe(1);
    expect(service.getRawInput(rawInput.id)?.lifecycleStatus).toBe('posted');
  });

  // Positive: config change applies to pending jobs; already posted records unchanged
  it('pending job uses newly saved config after change without rewriting posted records', async () => {
    const store = new MemoryProviderConfigStore();
    await store.save(
      buildProviderConfigForSave({
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-fake-old',
        model: 'deepseek-chat',
        existing: null,
        keepExistingKey: false,
      }),
    );
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({ records: [expense('AA', 50)] }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({ records: [expense('BB', 80)] }),
            },
          },
        ],
      });
    const db = openBetterSqliteDatabase(':memory:');
    migrate(db);
    seedDefaults(db);
    const ids = new SequenceIdGenerator();
    const repo = new LedgerRepository(db, ids);
    const transport = new OpenAiCompatibleParseTransport(store, () => ({
      chat: { completions: { create } },
    }));
    const service = new LedgerService(repo, transport, ids);

    const first = await service.submitRawInput({
      rawText: 'aa 50',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    await service.processEligibleJobs();
    expect(recordsForDate(service, '2026-07-16').map((r) => r.merchant)).toEqual(['AA']);

    // Submit second while holding config change before processing
    const second = await service.submitRawInput({
      rawText: 'bb 80',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    await store.saveFromForm({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-fake-new',
      model: 'deepseek-reasoner',
      keepExistingKey: false,
    });
    await service.processEligibleJobs();
    const merchants = recordsForDate(service, '2026-07-16')
      .map((r) => r.merchant)
      .sort();
    expect(merchants).toEqual(['AA', 'BB']);
    const job2 = repo.getParseJob(second.job.id);
    expect(job2?.modelVersion).toBe('deepseek-reasoner');
    expect(job2?.configRevision).toBe(2);
    // First posted job keeps original meta
    const job1 = repo.getParseJob(first.job.id);
    expect(job1?.modelVersion).toBe('deepseek-chat');
    expect(job1?.configRevision).toBe(1);
  });

  // Positive: orphaned running jobs are reclaimed on resume
  it('reclaims stale running jobs after simulated crash', async () => {
    const { service, repo, db } = setup((req) => ({
      contract_version: CONTRACT_VERSION,
      request_id: req.request_id,
      status: 'ok',
      records: [expense('XX', 100)],
    }));
    const { job } = await service.submitRawInput({
      rawText: '买xx花了100',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    // Simulate claim then process death while still running.
    const stale = '2026-07-16T10:00:00.000Z';
    db.run(`UPDATE parse_jobs SET status = 'running', attempts = 1, updated_at = ? WHERE id = ?`, [
      stale,
      job.id,
    ]);
    expect(repo.getParseJob(job.id)?.status).toBe('running');
    await service.processEligibleJobs('2026-07-16T10:05:00.000Z');
    expect(recordsForDate(service, '2026-07-16')).toHaveLength(1);
  });

  // Positive: mode default tags snapshot on submit
  it('inherits mode default tags snapshot onto posted records', async () => {
    const { service } = setup((req) => ({
      contract_version: CONTRACT_VERSION,
      request_id: req.request_id,
      status: 'ok',
      records: [expense('午饭', 100)],
    }));
    const trip = service.createTag('trip', '江西旅游');
    const place = service.createTag('place', '景德镇');
    const mode = service.saveMode({
      name: '江西旅游',
      defaultTagIds: [trip.id, place.id],
    });
    service.activateMode(mode.id);
    const { rawInput } = await service.submitRawInput({
      rawText: '午饭100',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
    });
    await service.processEligibleJobs();
    const record = recordsForDate(service, '2026-07-16').find((r) => r.rawInputId === rawInput.id)!;
    expect(record.tags.map((t) => t.tagId).sort()).toEqual([place.id, trip.id].sort());
    expect(record.includeInModeStats).toBe(true);
  });

  // Positive: an unused tag is soft-deleted and disappears from normal management queries
  it('soft deletes an unused tag', () => {
    const { service, repo } = setup(() => {
      throw new Error('AI is not used');
    });
    const tag = service.createTag('other', '临时标签');
    service.deleteTag(tag.id);
    expect(service.listTags().some((item) => item.id === tag.id)).toBe(false);
    expect(repo.getTag(tag.id)?.deletedAt).not.toBeNull();
  });

  // Negative: deleting a tag referenced by a mode must not break that mode
  it('blocks deleting a tag still referenced by a mode', () => {
    const { service } = setup(() => {
      throw new Error('AI is not used');
    });
    const tag = service.createTag('trip', '江西旅游');
    service.saveMode({ name: '旅行', defaultTagIds: [tag.id] });
    expect(() => service.deleteTag(tag.id)).toThrow(/先合并标签或移除模式引用/);
    expect(service.listTags().some((item) => item.id === tag.id)).toBe(true);
  });
});
