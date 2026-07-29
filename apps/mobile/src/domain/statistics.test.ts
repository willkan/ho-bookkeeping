import { describe, expect, it } from 'vitest';
import {
  computeExclusiveBreakdown,
  computeTrend,
  filterBreakdownBucketRecords,
  filterRecords,
} from './statistics';
import type { ConsumptionRecord, ExclusiveStatGroup, Tag } from './types';

function record(
  partial: Partial<ConsumptionRecord> &
    Pick<ConsumptionRecord, 'id' | 'actualCostMinor' | 'localDate'>,
): ConsumptionRecord {
  return {
    rawInputId: null,
    sourceSequence: 0,
    direction: 'expense',
    merchant: null,
    note: null,
    occurredAt: `${partial.localDate}T12:00:00.000Z`,
    timezone: 'Asia/Shanghai',
    currency: 'CNY',
    listPriceMinor: partial.actualCostMinor,
    discountMinor: 0,
    tags: [],
    modeId: null,
    includeInModeStats: false,
    manuallyEdited: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    deletedAt: null,
    ...partial,
  };
}

const food = 'tag_food';
const travel = 'tag_travel';
const place = 'tag_place';

const tagsById = new Map<string, Tag>([
  [
    food,
    {
      id: food,
      type: 'category',
      name: '餐饮',
      aliases: [],
      mergedIntoTagId: null,
      createdAt: '',
      updatedAt: '',
      deletedAt: null,
    },
  ],
  [
    travel,
    {
      id: travel,
      type: 'trip',
      name: '江西旅游',
      aliases: [],
      mergedIntoTagId: null,
      createdAt: '',
      updatedAt: '',
      deletedAt: null,
    },
  ],
  [
    place,
    {
      id: place,
      type: 'place',
      name: '景德镇',
      aliases: [],
      mergedIntoTagId: null,
      createdAt: '',
      updatedAt: '',
      deletedAt: null,
    },
  ],
]);

const categoryGroup: ExclusiveStatGroup = {
  id: 'g1',
  name: '消费类目',
  tagIds: [food],
  createdAt: '',
  updatedAt: '',
  deletedAt: null,
};

describe('statistics projections', () => {
  // Positive: exclusive breakdown includes unclassified and sums to total
  it('buckets exclusive group with unclassified and equal totals', () => {
    const records = [
      record({
        id: '1',
        actualCostMinor: 10000,
        localDate: '2026-07-01',
        tags: [
          { tagId: food, source: 'ai' },
          { tagId: travel, source: 'mode_default' },
          { tagId: place, source: 'mode_default' },
        ],
      }),
      record({
        id: '2',
        actualCostMinor: 5000,
        localDate: '2026-07-02',
        tags: [{ tagId: travel, source: 'mode_default' }],
      }),
    ];
    const result = computeExclusiveBreakdown(
      records,
      {
        range: { kind: 'time', startLocalDate: '2026-07-01', endLocalDate: '2026-07-31' },
        tagIds: [],
        tagMatch: 'or',
      },
      categoryGroup,
      tagsById,
    );
    expect(result.totalMinor).toBe(15000);
    const sum = result.buckets.reduce((s, b) => s + b.amountMinor, 0);
    expect(sum).toBe(result.totalMinor);
    expect(result.buckets.find((b) => b.isUnclassified)?.amountMinor).toBe(5000);
    expect(result.buckets.find((b) => b.key === food)?.amountMinor).toBe(10000);
  });

  // Positive: OR tag filter deduplicates a record matching multiple tags
  it('OR tag filter counts multi-tag record once', () => {
    const records = [
      record({
        id: '1',
        actualCostMinor: 10000,
        localDate: '2026-07-01',
        tags: [
          { tagId: food, source: 'ai' },
          { tagId: place, source: 'mode_default' },
        ],
      }),
    ];
    const filtered = filterRecords(records, {
      range: { kind: 'time', startLocalDate: '2026-07-01', endLocalDate: '2026-07-31' },
      tagIds: [food, place],
      tagMatch: 'or',
    });
    expect(filtered).toHaveLength(1);
  });

  // Positive: AND requires all tags
  it('AND tag filter requires all selected tags', () => {
    const records = [
      record({
        id: '1',
        actualCostMinor: 10000,
        localDate: '2026-07-01',
        tags: [{ tagId: food, source: 'ai' }],
      }),
      record({
        id: '2',
        actualCostMinor: 20000,
        localDate: '2026-07-01',
        tags: [
          { tagId: food, source: 'ai' },
          { tagId: place, source: 'mode_default' },
        ],
      }),
    ];
    const filtered = filterRecords(records, {
      range: { kind: 'time', startLocalDate: '2026-07-01', endLocalDate: '2026-07-31' },
      tagIds: [food, place],
      tagMatch: 'and',
    });
    expect(filtered.map((r) => r.id)).toEqual(['2']);
  });

  // Negative / Positive: soft-deleted absent from stats
  it('excludes soft-deleted records from filters and totals', () => {
    const records = [
      record({
        id: '1',
        actualCostMinor: 10000,
        localDate: '2026-07-01',
        deletedAt: '2026-07-02T00:00:00.000Z',
      }),
      record({ id: '2', actualCostMinor: 3000, localDate: '2026-07-01' }),
    ];
    const filtered = filterRecords(records, {
      range: { kind: 'time', startLocalDate: '2026-07-01', endLocalDate: '2026-07-31' },
      tagIds: [],
      tagMatch: 'or',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.actualCostMinor).toBe(3000);
  });

  // Positive: trend includes zero buckets
  it('includes zero-value day buckets in trend', () => {
    const records = [
      record({ id: '1', actualCostMinor: 10000, localDate: '2026-07-01' }),
      record({ id: '2', actualCostMinor: 2000, localDate: '2026-07-03' }),
    ];
    const trend = computeTrend(
      records,
      {
        range: { kind: 'time', startLocalDate: '2026-07-01', endLocalDate: '2026-07-03' },
        tagIds: [],
        tagMatch: 'or',
      },
      'day',
    );
    expect(trend.buckets).toHaveLength(3);
    expect(trend.buckets.find((b) => b.key === '2026-07-02')?.amountMinor).toBe(0);
    expect(trend.totalMinor).toBe(12000);
  });

  // Positive: mode scope uses current include_in_mode_stats not historical guess
  it('mode range only includes records currently marked in mode stats', () => {
    const records = [
      record({
        id: '1',
        actualCostMinor: 10000,
        localDate: '2026-07-01',
        modeId: 'm1',
        includeInModeStats: true,
      }),
      record({
        id: '2',
        actualCostMinor: 5000,
        localDate: '2026-07-01',
        modeId: 'm1',
        includeInModeStats: false,
      }),
    ];
    const filtered = filterRecords(records, {
      range: { kind: 'mode', modeId: 'm1' },
      tagIds: [],
      tagMatch: 'or',
    });
    expect(filtered.map((r) => r.id)).toEqual(['1']);
  });

  // Positive: classified drill-through contains exactly the selected breakdown bucket
  it('drills through to exactly one classified breakdown bucket', () => {
    const records = [
      record({
        id: 'food',
        actualCostMinor: 10000,
        localDate: '2026-07-01',
        tags: [{ tagId: food, source: 'ai' }],
      }),
      record({ id: 'other', actualCostMinor: 5000, localDate: '2026-07-02' }),
    ];
    const filtered = filterBreakdownBucketRecords(
      records,
      {
        range: { kind: 'time', startLocalDate: '2026-07-01', endLocalDate: '2026-07-31' },
        tagIds: [],
        tagMatch: 'and',
      },
      categoryGroup,
      food,
    );
    expect(filtered.map((item) => item.id)).toEqual(['food']);
  });

  // Negative: unclassified drill-through excludes every record carrying a group tag
  it('drills through unclassified without leaking classified records', () => {
    const records = [
      record({
        id: 'food',
        actualCostMinor: 10000,
        localDate: '2026-07-01',
        tags: [{ tagId: food, source: 'ai' }],
      }),
      record({ id: 'other', actualCostMinor: 5000, localDate: '2026-07-02' }),
    ];
    const filtered = filterBreakdownBucketRecords(
      records,
      {
        range: { kind: 'time', startLocalDate: '2026-07-01', endLocalDate: '2026-07-31' },
        tagIds: [],
        tagMatch: 'and',
      },
      categoryGroup,
      '__unclassified__',
    );
    expect(filtered.map((item) => item.id)).toEqual(['other']);
  });
});
