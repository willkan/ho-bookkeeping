/**
 * Selectable Excel business fields (PRD §8).
 * Complete export includes all; custom export includes only selected fields + relationship IDs.
 */

export type ExportFieldId =
  | 'raw_inputs'
  | 'consumption_records'
  | 'consumption_record_tags'
  | 'tags'
  | 'modes';

export const ALL_EXPORT_FIELDS: readonly {
  id: ExportFieldId;
  label: string;
  sheetName: string;
}[] = [
  { id: 'raw_inputs', label: '原始输入', sheetName: '原始输入' },
  { id: 'consumption_records', label: '消费记录', sheetName: '消费记录' },
  { id: 'consumption_record_tags', label: '消费记录标签', sheetName: '消费记录标签' },
  { id: 'tags', label: '标签', sheetName: '标签' },
  { id: 'modes', label: '模式', sheetName: '模式' },
];

export function allExportFieldIds(): ExportFieldId[] {
  return ALL_EXPORT_FIELDS.map((f) => f.id);
}

/**
 * Relationship IDs always retained when a sheet is selected so external tools can join.
 * Not a separate selectable “business field” beyond the sheet itself.
 */
export function requiredIdColumns(field: ExportFieldId): string[] {
  switch (field) {
    case 'raw_inputs':
      return ['原始输入ID'];
    case 'consumption_records':
      return ['消费记录ID', '原始输入ID'];
    case 'consumption_record_tags':
      return ['消费记录ID', '标签ID'];
    case 'tags':
      return ['标签ID'];
    case 'modes':
      return ['模式ID'];
    default:
      return [];
  }
}
