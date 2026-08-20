import type { ConsumptionRecord } from '../domain/types';
import type { LedgerPendingItem, LedgerProjection } from './ledger-service';

export type LedgerFeedItem =
  | { type: 'section'; key: string; section: 'pending'; count: number }
  | { type: 'date'; key: string; localDate: string }
  | { type: 'pending'; key: string; item: LedgerPendingItem }
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
