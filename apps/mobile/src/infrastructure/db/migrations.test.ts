import { SequenceIdGenerator } from '../ids/sequence-id-generator';
import { describe, expect, it } from 'vitest';
import { computeExclusiveBreakdown } from '../../domain/statistics';
import { openBetterSqliteDatabase } from './better-sqlite-adapter';
import { MIGRATIONS, migrate, seedDefaults } from './migrations';
import { LedgerRepository } from './repositories';
import type { SqliteDatabase } from './sqlite-database';

function migrateThroughVersion(db: SqliteDatabase, targetVersion: number): void {
  db.exec(`CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  for (const migration of MIGRATIONS.filter(({ version }) => version <= targetVersion)) {
    const sql =
      migration.version === 1
        ? migration.sql.replace(/CREATE TABLE schema_migrations \([\s\S]*?\);\s*/m, '')
        : migration.sql;
    db.exec(sql);
    db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
      migration.version,
      '2026-07-16T00:00:00.000Z',
    ]);
  }
}

describe('sqlite migrations and repository integration', () => {
  it('seeds the common phase-one category catalog with travel in consumption categories', () => {
    const db = openBetterSqliteDatabase(':memory:');
    migrate(db);
    const repo = new LedgerRepository(db, new SequenceIdGenerator());
    const tags = repo.listTags();
    const categoryNames = new Set(
      tags.filter(({ type }) => type === 'category').map(({ name }) => name),
    );
    expect(categoryNames).toEqual(
      new Set([
        '餐饮',
        '买菜',
        '购物',
        '旅游',
        '交通',
        '住宿',
        '娱乐',
        '医疗健康',
        '居住缴费',
        '通讯网络',
        '生活服务',
        '教育学习',
        '人情往来',
        '宠物',
        '其他',
      ]),
    );
    const travel = tags.find(({ name, type }) => name === '旅游' && type === 'category');
    expect(travel).toBeDefined();
    const categoryGroup = repo.listExclusiveGroups().find(({ name }) => name === '消费类目');
    expect(categoryGroup?.tagIds).toEqual(
      expect.arrayContaining(tags.filter(({ type }) => type === 'category').map(({ id }) => id)),
    );
    expect(categoryGroup?.tagIds).toContain(travel!.id);
    db.close();
  });

  it('does not duplicate a pre-existing tag with the same type and name', () => {
    const db = openBetterSqliteDatabase(':memory:');
    migrateThroughVersion(db, 4);
    db.run(
      `INSERT INTO tags
       (id, type, name, aliases_json, merged_into_tag_id, created_at, updated_at, deleted_at)
       VALUES ('user-dining', 'category', '餐饮', '["下馆子"]', NULL, '2026-07-16', '2026-07-16', NULL)`,
    );

    migrate(db);

    const dining = db.all<{ id: string; aliases_json: string }>(
      `SELECT id, aliases_json FROM tags
       WHERE type = 'category' AND name = '餐饮' AND deleted_at IS NULL`,
    );
    expect(dining).toEqual([{ id: 'user-dining', aliases_json: '["下馆子"]' }]);
    db.close();
  });

  it('backfills existing active category tags into the built-in consumption category group', () => {
    const db = openBetterSqliteDatabase(':memory:');
    migrateThroughVersion(db, 3);
    db.run(
      `INSERT INTO exclusive_stat_groups (id, name, created_at, updated_at, deleted_at)
       VALUES ('legacy-category-group', '消费类目', '2026-07-16', '2026-07-16', NULL)`,
    );
    db.run(
      `INSERT INTO tags
       (id, type, name, aliases_json, merged_into_tag_id, created_at, updated_at, deleted_at)
       VALUES ('tag-food', 'category', '餐饮', '[]', NULL, '2026-07-16', '2026-07-16', NULL),
              ('tag-trip', 'trip', '江西旅游', '[]', NULL, '2026-07-16', '2026-07-16', NULL)`,
    );

    migrate(db);

    const members = db
      .all<{
        tag_id: string;
      }>(`SELECT tag_id FROM exclusive_stat_group_tags WHERE group_id = 'legacy-category-group'`)
      .map(({ tag_id }) => tag_id);
    expect(members).toContain('tag-food');
    expect(members).not.toContain('tag-trip');
    db.close();
  });

  it('keeps built-in consumption category membership aligned when a tag type changes', () => {
    const db = openBetterSqliteDatabase(':memory:');
    migrate(db);
    const repo = new LedgerRepository(db, new SequenceIdGenerator());
    const tag = repo.ensureTag({
      id: 'tag-food',
      type: 'category',
      name: '餐饮',
      now: '2026-07-16T00:00:00.000Z',
    });
    const group = repo.listExclusiveGroups().find(({ name }) => name === '消费类目');
    expect(group?.tagIds).toContain(tag.id);

    repo.updateTagIdentity(tag.id, 'purpose', '聚餐', '2026-07-16T00:01:00.000Z');
    expect(
      repo.listExclusiveGroups().find(({ name }) => name === '消费类目')?.tagIds,
    ).not.toContain(tag.id);

    repo.updateTagIdentity(tag.id, 'category', '餐饮', '2026-07-16T00:02:00.000Z');
    expect(repo.listExclusiveGroups().find(({ name }) => name === '消费类目')?.tagIds).toContain(
      tag.id,
    );
    db.close();
  });

  it('adds a forward-only source_sequence column with a stable zero default', () => {
    const db = openBetterSqliteDatabase(':memory:');
    migrate(db);
    const columns = db.all<{ name: string; dflt_value: string | null }>(
      'PRAGMA table_info(consumption_records)',
    );
    const sourceSequence = columns.find((column) => column.name === 'source_sequence');
    expect(sourceSequence?.dflt_value).toBe('0');
    db.close();
  });

  it('migrates legacy coupon allocation to checkout paid amount and removes coupon assets', () => {
    const db = openBetterSqliteDatabase(':memory:');
    migrateThroughVersion(db, 5);
    const values = (
      id: string,
      actual: number,
      cash: number,
      discount: number,
      isPurchase: number,
    ) => [
      id,
      'expense',
      '2026-07-16T00:00:00.000Z',
      'Asia/Shanghai',
      '2026-07-16',
      30000,
      actual,
      cash,
      discount,
      '[]',
      isPurchase,
      '2026-07-16T00:00:00.000Z',
      '2026-07-16T00:00:00.000Z',
    ];
    const sql = `INSERT INTO consumption_records (
      id, direction, occurred_at, timezone, local_date, list_price_minor,
      actual_cost_minor, cash_outflow_minor, discount_minor, payment_parts_json,
      is_coupon_purchase, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    db.run(sql, values('legacy-use', 29500, 10000, 500, 0));
    db.run(sql, values('legacy-purchase', 19500, 19500, 0, 1));

    migrate(db);

    expect(
      db.get<{ actual_cost_minor: number; discount_minor: number }>(
        `SELECT actual_cost_minor, discount_minor FROM consumption_records
         WHERE id = 'legacy-use'`,
      ),
    ).toEqual({ actual_cost_minor: 10000, discount_minor: 20000 });
    expect(
      db.get<{ deleted_at: string | null }>(
        `SELECT deleted_at FROM consumption_records WHERE id = 'legacy-purchase'`,
      )?.deleted_at,
    ).not.toBeNull();
    expect(
      db.all<{ name: string }>('PRAGMA table_info(consumption_records)').map((c) => c.name),
    ).not.toEqual(
      expect.arrayContaining(['cash_outflow_minor', 'payment_parts_json', 'is_coupon_purchase']),
    );
    expect(db.get(`SELECT name FROM sqlite_master WHERE name = 'coupons'`)).toBeUndefined();
    expect(db.get(`SELECT name FROM sqlite_master WHERE name = 'fund_flows'`)).toBeUndefined();
    db.close();
  });

  it('invalidates unconfirmed 2.0 proposals and advances unfinished jobs to date contract 2.1', () => {
    const db = openBetterSqliteDatabase(':memory:');
    migrateThroughVersion(db, 6);
    const repo = new LedgerRepository(db, new SequenceIdGenerator());
    const submitted = repo.submitRawInput({
      id: 'raw-old-date-contract',
      rawText: '昨天买菜30元',
      submittedAt: '2026-07-16T04:00:00.000Z',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
      confirmMode: 'confirm_before_post',
      modeIdSnapshot: null,
      modeNameSnapshot: null,
      defaultTagsSnapshot: [],
      includeInModeStats: false,
      jobId: 'job-old-date-contract',
      clientRequestId: 'req-old-date-contract',
    });
    db.run(
      `UPDATE raw_inputs
       SET lifecycle_status = 'pending_confirm', candidates_json = '[]'
       WHERE id = ?`,
      [submitted.rawInput.id],
    );
    db.run(`UPDATE parse_jobs SET status = 'succeeded', contract_version = '2.0.0' WHERE id = ?`, [
      submitted.job.id,
    ]);

    migrate(db);

    expect(repo.getRawInput(submitted.rawInput.id)).toMatchObject({
      lifecycleStatus: 'parse_failed',
      candidatesJson: null,
      parseErrorCategory: 'unsupported_contract_version',
    });
    expect(repo.getParseJob(submitted.job.id)?.contractVersion).toBe('2.1.0');
    db.close();
  });

  it('makes historical records using the preset travel tag visible in consumption-category breakdown', () => {
    const db = openBetterSqliteDatabase(':memory:');
    migrateThroughVersion(db, 7);
    const repo = new LedgerRepository(db, new SequenceIdGenerator());
    const submitted = repo.submitRawInput({
      id: 'raw-travel-document',
      rawText: '办理港澳通行证花了43元',
      submittedAt: '2026-08-03T04:00:00.000Z',
      timezone: 'Asia/Shanghai',
      localDate: '2026-08-03',
      confirmMode: 'auto_post',
      modeIdSnapshot: null,
      modeNameSnapshot: null,
      defaultTagsSnapshot: [],
      includeInModeStats: false,
      jobId: 'job-travel-document',
      clientRequestId: 'req-travel-document',
    });
    repo.postCandidateList({
      rawInputId: submitted.rawInput.id,
      now: '2026-08-03T04:01:00.000Z',
      lifecycle: 'posted',
      records: [
        {
          direction: 'expense',
          merchant: '出入境管理局',
          note: '港澳通行证',
          occurred_at: '2026-08-03T04:00:00.000Z',
          timezone: 'Asia/Shanghai',
          local_date: '2026-08-03',
          currency: 'CNY',
          list_price_minor: 4300,
          actual_cost_minor: 4300,
          discount_minor: 0,
          tags: [
            {
              name: '旅游',
              type: 'trip',
              existing_tag_id: 'preset_trip_travel',
            },
          ],
        },
      ],
    });

    migrate(db);

    const tags = repo.listTags();
    const group = repo.listExclusiveGroups().find(({ name }) => name === '消费类目')!;
    const result = computeExclusiveBreakdown(
      repo.listEffectiveConsumptionRecords(),
      {
        range: { kind: 'time', startLocalDate: '2026-08-03', endLocalDate: '2026-08-03' },
        tagIds: [],
        tagMatch: 'and',
      },
      group,
      new Map(tags.map((tag) => [tag.id, tag])),
    );
    expect(tags.find(({ id }) => id === 'preset_trip_travel')?.type).toBe('category');
    expect(result.buckets.find(({ label }) => label === '旅游')?.amountMinor).toBe(4300);
    expect(result.buckets.find(({ label }) => label === '未归类')).toBeUndefined();
    db.close();
  });

  // Positive: migrations apply on empty database
  it('applies forward migrations and seeds defaults', () => {
    const db = openBetterSqliteDatabase(':memory:');
    migrate(db);
    seedDefaults(db);
    const version = db.get<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1',
    );
    expect(version?.version).toBe(8);
    const settings = new LedgerRepository(db, new SequenceIdGenerator()).getSettings();
    expect(settings.confirmMode).toBe('auto_post');
    db.close();
  });

  // Positive: foreign keys enabled
  it('enforces foreign keys for parse_jobs', () => {
    const db = openBetterSqliteDatabase(':memory:');
    migrate(db);
    expect(() => {
      db.run(
        `INSERT INTO parse_jobs (
          id, raw_input_id, status, attempts, max_attempts, next_eligible_at,
          client_request_id, idempotency_key, contract_version, created_at, updated_at
        ) VALUES ('j1', 'missing', 'pending', 0, 5, '2026-07-16T00:00:00.000Z',
          'r1', 'k1', '1.0.0', '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z')`,
      );
    }).toThrow();
    db.close();
  });

  // Positive: migrations are idempotent
  it('re-running migrate does not fail', () => {
    const db = openBetterSqliteDatabase(':memory:');
    migrate(db);
    migrate(db);
    db.close();
  });
});
