import { describe, expect, it } from 'vitest';
import { buildLedgerWorkbook } from './excel-export';
import { allExportFieldIds } from './export-fields';

const snapshot = {
  rawInputs: [
    {
      id: 'ri_1',
      rawText: '午饭100',
      submittedAt: '2026-07-16T12:00:00.000Z',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
      lifecycleStatus: 'posted' as const,
      confirmMode: 'auto_post' as const,
      modeIdSnapshot: null,
      modeNameSnapshot: null,
      defaultTagsSnapshot: [],
      includeInModeStats: false,
      parseErrorCategory: null,
      parseErrorMessage: null,
      candidatesJson: null,
      createdAt: '2026-07-16T12:00:00.000Z',
      updatedAt: '2026-07-16T12:00:00.000Z',
      deletedAt: null,
    },
  ],
  records: [
    {
      id: 'cr_1',
      rawInputId: 'ri_1',
      sourceSequence: 0,
      direction: 'expense' as const,
      merchant: '食堂',
      note: null,
      occurredAt: '2026-07-16T12:00:00.000Z',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
      currency: 'CNY' as const,
      listPriceMinor: 10000,
      actualCostMinor: 10000,
      discountMinor: 0,
      tags: [],
      modeId: null,
      includeInModeStats: false,
      manuallyEdited: false,
      createdAt: '2026-07-16T12:00:00.000Z',
      updatedAt: '2026-07-16T12:00:00.000Z',
      deletedAt: null,
    },
  ],
  tags: [],
  modes: [],
};

describe('excel export projection', () => {
  // Positive: full ledger workbook builds
  it('builds a multi-sheet workbook for full ledger', async () => {
    const buffer = await buildLedgerWorkbook(snapshot, {
      fullLedger: true,
      generatedAt: '2026-07-16T12:00:00.000Z',
    });
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });

  // Positive: custom field selection omits unselected business sheets
  it('includes only selected business fields for custom export', async () => {
    const buffer = await buildLedgerWorkbook(snapshot, {
      fullLedger: false,
      startLocalDate: '2026-07-01',
      endLocalDate: '2026-07-31',
      selectedFields: ['consumption_records', 'tags'],
      generatedAt: '2026-07-16T12:00:00.000Z',
    });
    // Parse workbook to inspect sheet names
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as ArrayBuffer);
    const names = wb.worksheets.map((s) => s.name);
    expect(names).toContain('导出说明');
    expect(names).toContain('消费记录');
    expect(names).toContain('标签');
    expect(names).not.toContain('原始输入');
    expect(names).not.toContain('资金流水');
    expect(names).not.toContain('优惠券');
  });

  // Positive: all field ids cover PRD business tables
  it('enumerates all selectable business field ids', () => {
    expect(allExportFieldIds()).toEqual([
      'raw_inputs',
      'consumption_records',
      'consumption_record_tags',
      'tags',
      'modes',
    ]);
  });
});
