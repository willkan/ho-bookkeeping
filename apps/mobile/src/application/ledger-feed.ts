import type { ConsumptionRecord, RawInput } from '../domain/types';
import type { LedgerPendingItem, LedgerProjection } from './ledger-service';

export type LedgerFeedItem =
  | { type: 'section'; key: string; section: 'pending'; count: number }
  | { type: 'section'; key: string; section: 'withdrawn'; count: number }
  | { type: 'date'; key: string; localDate: string }
  | { type: 'pending'; key: string; item: LedgerPendingItem }
  | { type: 'withdrawn'; key: string; raw: RawInput }
  | { type: 'record'; key: string; record: ConsumptionRecord };

export function buildLedgerFeed(projection: LedgerProjection): LedgerFeedItem[] {
  const items: LedgerFeedItem[] = [];
  if (projection.pending.length > 0) {
    items.push({
      type: 'section',
      key: 'section-pending',
      section: 'pending',
      count: projection.pending.length,
    });
    for (const item of projection.pending) {
      items.push({ type: 'pending', key: `pending-${item.raw.id}`, item });
    }
  }
  if (projection.withdrawn.length > 0) {
    items.push({
      type: 'section',
      key: 'section-withdrawn',
      section: 'withdrawn',
      count: projection.withdrawn.length,
    });
    for (const raw of projection.withdrawn) {
      items.push({ type: 'withdrawn', key: `withdrawn-${raw.id}`, raw });
    }
  }

  let currentDate: string | null = null;
  for (const record of projection.records) {
    if (record.localDate !== currentDate) {
      currentDate = record.localDate;
      items.push({ type: 'date', key: `date-${currentDate}`, localDate: currentDate });
    }
    items.push({ type: 'record', key: `record-${record.id}`, record });
  }
  return items;
}
