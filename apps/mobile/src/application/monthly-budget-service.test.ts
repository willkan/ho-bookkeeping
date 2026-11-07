import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTRACT_VERSION, type CandidateRecord } from '@bookkeeping/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeAiParseTransport } from '../infrastructure/ai/transport';
import { openBetterSqliteDatabase } from '../infrastructure/db/better-sqlite-adapter';
import { migrate } from '../infrastructure/db/migrations';
import { SqliteMonthlyBudgetRepository } from '../infrastructure/db/monthly-budget-repository';
import { LedgerRepository } from '../infrastructure/db/repositories';
import { SequenceIdGenerator } from '../infrastructure/ids/sequence-id-generator';
import { LedgerService } from './ledger-service';
import { MonthlyBudgetService } from './monthly-budget-service';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
const september = new Date(2026, 8, 27);

function candidate(
  minor: number,
  localDate = '2026-09-10',
  extra: Partial<CandidateRecord> = {},
): CandidateRecord {
  return {
    direction: 'expense',
    merchant: '测试商户',
    note: null,
    occurred_at: `${localDate}T04:00:00.000Z`,
    timezone: 'Asia/Shanghai',
    local_date: localDate,
    currency: 'CNY',
    list_price_minor: minor,
    actual_cost_minor: minor,
    discount_minor: 0,
    tags: [],
    ...extra,
  };
}

function setup() {
  const folder = mkdtempSync(join(tmpdir(), 'huana-budget-'));
  cleanups.push(() => rmSync(folder, { recursive: true }));
  const path = join(folder, 'ledger.sqlite');
  const db = openBetterSqliteDatabase(path);
  cleanups.push(() => db.close());
  migrate(db);
  const ids = new SequenceIdGenerator();
  const store = new SqliteMonthlyBudgetRepository(db);
  const budgets = new MonthlyBudgetService(store, ids);
  let records: CandidateRecord[] = [];
  const transport = new FakeAiParseTransport((request) => ({
    contract_version: CONTRACT_VERSION,
    request_id: request.request_id,
    status: 'ok',
    records,
  }));
  const ledger = new LedgerService(new LedgerRepository(db, ids), transport, ids);
  const submit = async (proposals: CandidateRecord[], confirm = false) => {
    records = proposals;
    const input = await ledger.submitRawInput({
      rawText: '合成预算验证数据',
      timezone: 'Asia/Shanghai',
      localDate: '2026-09-27',
      confirmModeOverride: confirm ? 'confirm_before_post' : 'auto_post',
    });
    await ledger.processJob(input.job.id);
    return input;
  };
  return { db, path, ids, store, budgets, ledger, submit };
}

describe('monthly budget service with real SQLite — PRD 6.6', () => {
  it('starts without a budget and persists saving, editing, soft disabling and re-enabling across reopening', () => {
    const { db, path, ids, budgets } = setup();
    expect(budgets.overview(september)).toMatchObject({
      budget: null,
      spentMinor: 0,
      remainingMinor: null,
    });
    budgets.save('20000.01');
    const original = budgets.overview(september).budget!;
    budgets.save('15000');
    expect(budgets.overview(september).budget).toMatchObject({
      id: original.id,
      amountMinor: 1500000,
      createdAt: original.createdAt,
    });
    const reopened = openBetterSqliteDatabase(path);
    try {
      const restarted = new MonthlyBudgetService(new SqliteMonthlyBudgetRepository(reopened), ids);
      expect(restarted.overview(september).budget?.amountMinor).toBe(1500000);
      restarted.disable();
      expect(budgets.overview(september).budget).toBeNull();
      expect(
        db.get<{ deleted_at: string }>('SELECT deleted_at FROM monthly_budgets WHERE id = ?', [
          original.id,
        ])?.deleted_at,
      ).toBeTruthy();
      expect(() => restarted.disable()).toThrow('预算已关闭');
      restarted.save('100');
      expect(budgets.overview(september).budget?.id).not.toBe(original.id);
      expect(db.all('SELECT * FROM monthly_budgets')).toHaveLength(2);
    } finally {
      reopened.close();
    }
  });
  it('rejects invalid limits without changing an existing budget', () => {
    const { budgets, store } = setup();
    budgets.save('100');
    for (const value of ['0', '-1', '1.001', 'abc', '1e5', '1000000000']) {
      expect(() => budgets.save(value)).toThrow();
      expect(budgets.overview(september).budget?.amountMinor).toBe(10000);
    }
    expect(() =>
      store.save({ newId: 'invalid', amountMinor: 1.5, now: new Date().toISOString() }),
    ).toThrow();
  });
  it('sums current month effective expenses once, using paid amounts and recorded local dates', async () => {
    const { budgets, ledger, submit } = setup();
    budgets.save('500');
    await submit([
      candidate(10000, '2026-09-01', {
        occurred_at: '2026-08-31T16:30:00.000Z',
        list_price_minor: 12000,
        discount_minor: 2000,
        tags: [
          { name: '餐饮', type: 'category' },
          { name: '旅行', type: 'other' },
        ],
      }),
      candidate(20000, '2026-09-30'),
      candidate(999, '2026-08-31'),
      candidate(888, '2026-10-01'),
      candidate(10000, '2026-09-10', { direction: 'income' }),
      candidate(10000, '2026-09-10', { direction: 'transfer' }),
    ]);
    expect(ledger.listLedger().records).toHaveLength(6);
    expect(budgets.overview(september)).toMatchObject({
      spentMinor: 30000,
      recordCount: 2,
      remainingMinor: 20000,
    });
    ledger.searchLedger('不会匹配');
    expect(budgets.overview(september).spentMinor).toBe(30000);
  });
  it('updates remaining after confirmation, manual edits, withdrawal and restoration', async () => {
    const { budgets, ledger, submit } = setup();
    budgets.save('100');
    const input = await submit([candidate(1000), candidate(2000), candidate(3000)], true);
    expect(budgets.overview(september).spentMinor).toBe(0);
    await ledger.confirmPending(input.rawInput.id);
    expect(budgets.overview(september).remainingMinor).toBe(4000);
    const edited = ledger.listLedger().records[0]!;
    ledger.editConsumption({
      ...edited,
      tagIds: edited.tags.map((tag) => tag.tagId),
      listPriceMinor: 15000,
      actualCostMinor: 15000,
      discountMinor: 0,
    });
    const afterEdit = budgets.overview(september);
    expect(afterEdit.spentMinor).toBe(6000 - edited.actualCostMinor + 15000);
    expect(afterEdit.remainingMinor).toBeLessThan(0);
    ledger.softDeleteConsumption(edited.id);
    expect(budgets.overview(september).spentMinor).toBe(6000 - edited.actualCostMinor);
    ledger.restoreConsumption(edited.id);
    expect(budgets.overview(september)).toEqual(afterEdit);
    expect(ledger.getRawInput(input.rawInput.id)?.rawText).toBe('合成预算验证数据');
  });
  it('does not count pending, failed or invalid proposals and counts CSV imports', async () => {
    const { budgets, ledger, submit } = setup();
    budgets.save('100');
    await ledger.submitRawInput({
      rawText: '待解析',
      timezone: 'Asia/Shanghai',
      localDate: '2026-09-01',
    });
    await submit([candidate(1000), candidate(-1)]);
    expect(budgets.overview(september)).toMatchObject({ spentMinor: 0, recordCount: 0 });
    expect(
      ledger.listLedger().pending.some(({ raw }) => raw.lifecycleStatus === 'parse_failed'),
    ).toBe(true);
    const csv = '日期,时间,收支,分类,金额(元),备注\n2026-09-10,12:00,支出,餐饮,-12.34,合成数据';
    expect(ledger.importWeChatCsv(csv, 'b'.repeat(64))).toBe(1);
    expect(budgets.overview(september)).toMatchObject({
      spentMinor: 1234,
      remainingMinor: 8766,
      recordCount: 1,
    });
    expect(ledger.importWeChatCsv(csv, 'b'.repeat(64))).toBe(0);
    expect(budgets.overview(september).spentMinor).toBe(1234);
  });
  it('reuses the limit next month with no positive or negative rollover', async () => {
    const { budgets, submit } = setup();
    budgets.save('100');
    await submit([candidate(15000)]);
    expect(budgets.overview(september).remainingMinor).toBe(-5000);
    expect(budgets.overview(new Date(2026, 9, 1))).toMatchObject({
      spentMinor: 0,
      remainingMinor: 10000,
    });
    budgets.save('200');
    expect(budgets.overview(september).remainingMinor).toBe(5000);
    expect(budgets.overview(new Date(2026, 9, 1)).remainingMinor).toBe(20000);
  });
  it('propagates read and write failures without replacing facts with zero or clearing the limit', () => {
    const { budgets, db } = setup();
    budgets.save('100');
    db.exec('PRAGMA query_only = ON');
    expect(() => budgets.save('200')).toThrow();
    expect(() => budgets.disable()).toThrow();
    db.exec('PRAGMA query_only = OFF');
    expect(budgets.overview(september).budget?.amountMinor).toBe(10000);
    db.exec('ALTER TABLE consumption_records RENAME TO unavailable_records');
    expect(() => budgets.overview(september)).toThrow();
    db.exec('ALTER TABLE unavailable_records RENAME TO consumption_records');
    expect(budgets.overview(september).budget?.amountMinor).toBe(10000);
  });
});
