import { describe, expect, it } from 'vitest';
import { SequenceIdGenerator } from '../infrastructure/ids/sequence-id-generator';
import { openBetterSqliteDatabase } from '../infrastructure/db/better-sqlite-adapter';
import { migrate, seedDefaults } from '../infrastructure/db/migrations';
import { LedgerRepository } from '../infrastructure/db/repositories';
import { parseWeChatCsv } from './wechat-csv';

const hash = 'a'.repeat(64);
const now = '2026-09-27T03:00:00.000Z';
const source =
  '\uFEFF日期,时间,收支,分类,金额(元),备注\r\n' +
  '2026-03-01,23:59,支出,购物,-10.80,"文具,笔"\r\n' +
  '2026-04-02,09:25,支出,旅行,-181.50,车票\r\n';

function setup() {
  const db = openBetterSqliteDatabase(':memory:');
  migrate(db);
  seedDefaults(db);
  const repo = new LedgerRepository(db, new SequenceIdGenerator());
  return { db, repo };
}

describe('微信记账本已分类 CSV 导入', () => {
  it('解析带 BOM 和 CSV 引号的明细，金额按整数分计算', () => {
    const rows = parseWeChatCsv(source);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      localDate: '2026-03-01',
      occurredAt: '2026-03-01T15:59:00.000Z',
      amountMinor: 1080,
      category: '购物',
      note: '文具,笔',
    });
  });

  it('拒绝缺少分类、无效日期或非支出的整份文件', () => {
    for (const line of [
      '2026-03-01,23:59,支出,,-10.80,',
      '2026-02-30,23:59,支出,购物,-10.80,',
      '2026-03-01,23:59,收入,购物,10.80,',
    ]) {
      expect(() => parseWeChatCsv('日期,时间,收支,分类,金额(元),备注\n' + line)).toThrow();
    }
  });

  it('整批写入并保持月份、分类与来源金额一致', () => {
    const { db, repo } = setup();
    expect(
      repo.importWeChatCsv({
        fileHash: hash,
        rows: parseWeChatCsv(source),
        now,
        importLocalDate: '2026-09-27',
      }),
    ).toBe(2);
    const records = repo.listEffectiveConsumptionRecords();
    expect(records.map((record) => [record.localDate, record.actualCostMinor])).toEqual([
      ['2026-04-02', 18150],
      ['2026-03-01', 1080],
    ]);
    const categories = repo.listTags().filter((tag) => tag.type === 'category');
    const names = new Map(categories.map((tag) => [tag.id, tag.name]));
    expect(records.map((record) => names.get(record.tags[0]?.tagId ?? ''))).toEqual([
      '旅行',
      '购物',
    ]);
    const group = repo.listExclusiveGroups().find((item) => item.name === '消费类目');
    expect(group?.tagIds).toContain(categories.find((tag) => tag.name === '旅行')?.id);
    db.close();
  });

  it('再次导入同一文件不重复写入', () => {
    const { db, repo } = setup();
    const input = {
      fileHash: hash,
      rows: parseWeChatCsv(source),
      now,
      importLocalDate: '2026-09-27',
    };
    expect(repo.importWeChatCsv(input)).toBe(2);
    expect(repo.importWeChatCsv(input)).toBe(0);
    expect(repo.listEffectiveConsumptionRecords()).toHaveLength(2);
    db.close();
  });

  it('事务中任一写入失败则原账本保持不变', () => {
    const { db, repo } = setup();
    const originalRun = db.run.bind(db);
    let inserts = 0;
    db.run = (sql, params) => {
      if (sql.includes('INSERT INTO consumption_records') && ++inserts === 2) {
        throw new Error('injected write failure');
      }
      return originalRun(sql, params);
    };
    expect(() =>
      repo.importWeChatCsv({
        fileHash: hash,
        rows: parseWeChatCsv(source),
        now,
        importLocalDate: '2026-09-27',
      }),
    ).toThrow('injected write failure');
    expect(repo.listEffectiveConsumptionRecords()).toHaveLength(0);
    expect(db.get<{ count: number }>('SELECT COUNT(*) AS count FROM raw_inputs')?.count).toBe(0);
    db.close();
  });
});
