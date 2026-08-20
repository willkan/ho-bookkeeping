import type { ConsumptionRecord } from '../domain/types';

/** User-facing identity for one flat purchase; raw input is the final contextual fallback. */
export function consumptionRecordTitle(record: ConsumptionRecord, rawText?: string | null): string {
  return record.merchant?.trim() || record.note?.trim() || rawText?.trim() || '消费';
}
