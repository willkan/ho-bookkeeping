import type { ConsumptionRecord, Mode, RawInput, Tag } from '../../domain/types';
import { ALL_EXPORT_FIELDS, type ExportFieldId, allExportFieldIds } from './export-fields';

/**
 * Load ExcelJS only when export runs.
 * A top-level import of exceljs is evaluated for every Expo Router route preload
 * and its bundled promise helper recurses on Hermes (Maximum call stack size exceeded).
 */
async function loadExcelJS(): Promise<typeof import('exceljs')> {
  return import('exceljs');
}

export type ExportSnapshot = {
  rawInputs: RawInput[];
  records: ConsumptionRecord[];
  tags: Tag[];
  modes: Mode[];
};

export type ExportOptions = {
  startLocalDate?: string;
  endLocalDate?: string;
  /** When true, ignore date filters and export all business fields. */
  fullLedger: boolean;
  /** When not full ledger, only these business sheets/columns are included. */
  selectedFields?: ExportFieldId[];
  generatedAt: string;
};

function inRange(localDate: string, start?: string, end?: string): boolean {
  if (start && localDate < start) return false;
  if (end && localDate > end) return false;
  return true;
}

function selectedSet(options: ExportOptions): Set<ExportFieldId> {
  if (options.fullLedger) return new Set(allExportFieldIds());
  const fields = options.selectedFields?.length ? options.selectedFields : allExportFieldIds();
  return new Set(fields);
}

/**
 * Local Excel projection. Never includes credentials or internal job queue state.
 * Custom export: only selected business tables + stable IDs needed for relationships.
 * Complete export: all business fields.
 */
export async function buildLedgerWorkbook(
  snapshot: ExportSnapshot,
  options: ExportOptions,
): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '花哪';
  workbook.created = new Date(options.generatedAt);
  const selected = selectedSet(options);

  const meta = workbook.addWorksheet('导出说明');
  meta.addRow(['数据格式版本', '1.1.0']);
  meta.addRow(['生成时间', options.generatedAt]);
  meta.addRow([
    '时间范围',
    options.fullLedger ? '全部' : `${options.startLocalDate ?? ''} ~ ${options.endLocalDate ?? ''}`,
  ]);
  meta.addRow([
    '导出字段',
    options.fullLedger
      ? '完整账本（全部业务字段）'
      : ALL_EXPORT_FIELDS.filter((f) => selected.has(f.id))
          .map((f) => f.label)
          .join('、'),
  ]);
  meta.addRow(['口径说明', '金额单位为分（整数）']);

  const rawInputs = snapshot.rawInputs.filter((r) =>
    options.fullLedger ? true : inRange(r.localDate, options.startLocalDate, options.endLocalDate),
  );
  const records = snapshot.records.filter((r) =>
    options.fullLedger ? true : inRange(r.localDate, options.startLocalDate, options.endLocalDate),
  );
  if (selected.has('raw_inputs')) {
    const rawSheet = workbook.addWorksheet('原始输入');
    rawSheet.addRow([
      '原始输入ID',
      '原文',
      '提交时间',
      '本地日期',
      '时区',
      '解析状态',
      '确认模式',
      '模式快照名称',
      '纳入模式统计',
    ]);
    for (const r of rawInputs) {
      rawSheet.addRow([
        r.id,
        r.rawText,
        r.submittedAt,
        r.localDate,
        r.timezone,
        r.lifecycleStatus,
        r.confirmMode,
        r.modeNameSnapshot,
        r.includeInModeStats ? 1 : 0,
      ]);
    }
  }

  if (selected.has('consumption_records')) {
    const recordSheet = workbook.addWorksheet('消费记录');
    recordSheet.addRow([
      '消费记录ID',
      '原始输入ID',
      '来源顺序',
      '发生时间',
      '本地日期',
      '时区',
      '方向',
      '商户',
      '商品原价_分',
      '本次实付_分',
      '优惠券抵扣_分',
      '币种',
      '模式ID',
      '纳入模式统计',
      '手工修改',
    ]);
    for (const r of records) {
      recordSheet.addRow([
        r.id,
        r.rawInputId,
        r.sourceSequence,
        r.occurredAt,
        r.localDate,
        r.timezone,
        r.direction,
        r.merchant,
        r.listPriceMinor,
        r.actualCostMinor,
        r.discountMinor,
        r.currency,
        r.modeId,
        r.includeInModeStats ? 1 : 0,
        r.manuallyEdited ? 1 : 0,
      ]);
    }
  }

  if (selected.has('consumption_record_tags')) {
    const tagLinkSheet = workbook.addWorksheet('消费记录标签');
    tagLinkSheet.addRow(['消费记录ID', '标签ID', '来源']);
    for (const r of records) {
      for (const t of r.tags) {
        tagLinkSheet.addRow([r.id, t.tagId, t.source]);
      }
    }
  }

  if (selected.has('tags')) {
    const tagSheet = workbook.addWorksheet('标签');
    tagSheet.addRow(['标签ID', '类型', '名称', '别名', '合并指向']);
    for (const t of snapshot.tags) {
      tagSheet.addRow([t.id, t.type, t.name, t.aliases.join('|'), t.mergedIntoTagId]);
    }
  }

  if (selected.has('modes')) {
    const modeSheet = workbook.addWorksheet('模式');
    modeSheet.addRow(['模式ID', '名称', '是否启用', '默认标签IDs']);
    for (const m of snapshot.modes) {
      modeSheet.addRow([m.id, m.name, m.isActive ? 1 : 0, m.defaultTagIds.join('|')]);
    }
  }

  // Node returns Buffer; Hermes/browser may return ArrayBuffer. Callers accept both via Uint8Array.
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}
