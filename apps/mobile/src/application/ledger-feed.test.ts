import { describe, expect, it } from 'vitest';
import type { ConsumptionRecord, RawInput } from '../domain/types';
import { buildLedgerFeed } from './ledger-feed';
import type { LedgerProjection } from './ledger-service';

function raw(id: string, lifecycleStatus: RawInput['lifecycleStatus']): RawInput {
  return {
    id,
    rawText: id,
    submittedAt: '2026-07-16T10:00:00.000Z',
    timezone: 'Asia/Shanghai',
    localDate: '2026-07-16',
    lifecycleStatus,
    confirmMode: 'auto_post',
    modeIdSnapshot: null,
    modeNameSnapshot: null,
    defaultTagsSnapshot: [],
    includeInModeStats: false,
    parseErrorCategory: null,
    parseErrorMessage: null,
    candidatesJson: null,
    createdAt: '2026-07-16T10:00:00.000Z',
    updatedAt: '2026-07-16T10:00:00.000Z',
    deletedAt: null,
  };
}

function record(id: string, localDate: string): ConsumptionRecord {
  return {
    id,
    rawInputId: null,
    sourceSequence: 0,
    direction: 'expense',
    merchant: id,
    note: null,
    occurredAt: `${localDate}T10:00:00.000Z`,
    timezone: 'UTC',
    localDate,
    currency: 'CNY',
    listPriceMinor: 100,
    actualCostMinor: 100,
    discountMinor: 0,
    tags: [],
    modeId: null,
    includeInModeStats: false,
    manuallyEdited: false,
    createdAt: `${localDate}T10:00:00.000Z`,
    updatedAt: `${localDate}T10:00:00.000Z`,
    deletedAt: null,
  };
}

describe('ledger feed projection', () => {
  it('places pending and withdrawn sections before occurred-date record sections', () => {
    const pendingRaw = raw('pending', 'pending_parse');
    const withdrawnRaw = raw('withdrawn', 'posted');
    const projection: LedgerProjection = {
      pending: [{ raw: pendingRaw, viewStatus: 'pending_parse' }],
      withdrawn: [withdrawnRaw],
      records: [record('today', '2026-07-16'), record('yesterday', '2026-07-15')],
    };

    const feed = buildLedgerFeed(projection);

    expect(feed.map((item) => item.key)).toEqual([
      'section-pending',
      'pending-pending',
      'section-withdrawn',
      'withdrawn-withdrawn',
      'date-2026-07-16',
      'record-today',
      'date-2026-07-15',
      'record-yesterday',
    ]);
  });
  it('emits one date header for adjacent records on the same local date', () => {
    const projection: LedgerProjection = {
      pending: [],
      withdrawn: [],
      records: [record('lunch', '2026-07-16'), record('dinner', '2026-07-16')],
    };

    const feed = buildLedgerFeed(projection);

    expect(feed.map((item) => item.key)).toEqual([
      'date-2026-07-16',
      'record-lunch',
      'record-dinner',
    ]);
  });
});
