import type {
  BreakdownBucket,
  BreakdownResult,
  ConsumptionRecord,
  ExclusiveStatGroup,
  StatFilter,
  Tag,
  TrendGranularity,
  TrendResult,
} from './types';

function isEffective(record: ConsumptionRecord): boolean {
  return record.deletedAt === null;
}

function inTimeRange(
  record: ConsumptionRecord,
  startLocalDate?: string,
  endLocalDate?: string,
): boolean {
  if (startLocalDate && record.localDate < startLocalDate) return false;
  if (endLocalDate && record.localDate > endLocalDate) return false;
  return true;
}

export function filterRecords(
  records: readonly ConsumptionRecord[],
  filter: StatFilter,
): ConsumptionRecord[] {
  return records.filter((record) => {
    if (!isEffective(record)) return false;

    if (filter.range.kind === 'time') {
      if (!inTimeRange(record, filter.range.startLocalDate, filter.range.endLocalDate)) {
        return false;
      }
    } else {
      if (record.modeId !== filter.range.modeId || !record.includeInModeStats) {
        return false;
      }
      if (!inTimeRange(record, filter.range.startLocalDate, filter.range.endLocalDate)) {
        return false;
      }
    }

    if (filter.tagIds.length === 0) return true;
    const recordTagIds = new Set(record.tags.map((t) => t.tagId));
    if (filter.tagMatch === 'and') {
      return filter.tagIds.every((id) => recordTagIds.has(id));
    }
    // OR: union of records; each record counted once.
    return filter.tagIds.some((id) => recordTagIds.has(id));
  });
}

/**
 * Exclusive-group breakdown: each filtered record enters exactly one bucket.
 * Records with no matching group tag enter the explicit unclassified bucket.
 * Bucket sums must equal filtered total.
 */
export function computeExclusiveBreakdown(
  records: readonly ConsumptionRecord[],
  filter: StatFilter,
  group: ExclusiveStatGroup,
  tagsById: ReadonlyMap<string, Tag>,
): BreakdownResult {
  const filtered = filterRecords(records, filter);
  const totalMinor = filtered.reduce((sum, r) => sum + r.actualCostMinor, 0);
  const groupTagSet = new Set(group.tagIds);
  const amounts = new Map<string, number>();

  for (const record of filtered) {
    const match = record.tags.map((t) => t.tagId).find((id) => groupTagSet.has(id));
    const key = match ?? '__unclassified__';
    amounts.set(key, (amounts.get(key) ?? 0) + record.actualCostMinor);
  }

  const buckets: BreakdownBucket[] = [];
  for (const tagId of group.tagIds) {
    const amount = amounts.get(tagId) ?? 0;
    if (amount === 0 && !amounts.has(tagId)) {
      // Still allow zero-amount known tags only if present in data map; skip pure zeros optional.
    }
    if (amounts.has(tagId)) {
      const tag = tagsById.get(tagId);
      buckets.push({
        key: tagId,
        label: tag?.name ?? tagId,
        amountMinor: amount,
        share: totalMinor === 0 ? 0 : amount / totalMinor,
        isUnclassified: false,
      });
    }
  }

  const unclassified = amounts.get('__unclassified__') ?? 0;
  if (unclassified > 0 || filtered.some((r) => !r.tags.some((t) => groupTagSet.has(t.tagId)))) {
    buckets.push({
      key: '__unclassified__',
      label: '未归类',
      amountMinor: unclassified,
      share: totalMinor === 0 ? 0 : unclassified / totalMinor,
      isUnclassified: true,
    });
  }

  // Ensure bucket sum equals total even when some group tags had zero hits and were omitted.
  const bucketSum = buckets.reduce((s, b) => s + b.amountMinor, 0);
  if (bucketSum !== totalMinor) {
    throw new Error(`breakdown invariant violated: buckets ${bucketSum} != total ${totalMinor}`);
  }

  return { totalMinor, buckets, metric: 'actual_cost' };
}

/** Records behind one exclusive-breakdown bucket, using the exact same bucket rule. */
export function filterBreakdownBucketRecords(
  records: readonly ConsumptionRecord[],
  filter: StatFilter,
  group: ExclusiveStatGroup,
  bucketKey: string,
): ConsumptionRecord[] {
  const groupTagSet = new Set(group.tagIds);
  return filterRecords(records, filter).filter((record) => {
    const match = record.tags.map((tag) => tag.tagId).find((id) => groupTagSet.has(id));
    return bucketKey === '__unclassified__' ? match === undefined : match === bucketKey;
  });
}

function startOfIsoWeek(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function monthKey(localDate: string): string {
  return localDate.slice(0, 7);
}

function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  const [ys, ms, ds] = start.split('-').map(Number) as [number, number, number];
  const cursor = new Date(Date.UTC(ys, ms - 1, ds));
  const [ye, me, de] = end.split('-').map(Number) as [number, number, number];
  const endDate = new Date(Date.UTC(ye, me - 1, de));
  while (cursor <= endDate) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function eachMonth(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = start.split('-').map(Number) as [number, number];
  const [ye, me] = end.split('-').map(Number) as [number, number];
  while (y < ye || (y === ye && m <= me)) {
    out.push(`${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function eachWeek(start: string, end: string): string[] {
  const days = eachDay(start, end);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const day of days) {
    const key = startOfIsoWeek(day);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/**
 * Trend: zero-value buckets included for every period in the range.
 * Soft-deleted excluded via filterRecords.
 */
export function computeTrend(
  records: readonly ConsumptionRecord[],
  filter: StatFilter,
  granularity: TrendGranularity,
): TrendResult {
  if (filter.range.kind !== 'time') {
    throw new Error('trend requires a time range filter');
  }
  const { startLocalDate, endLocalDate } = filter.range;
  const filtered = filterRecords(records, filter);
  const totals = new Map<string, number>();

  for (const record of filtered) {
    let key: string;
    if (granularity === 'day') key = record.localDate;
    else if (granularity === 'week') key = startOfIsoWeek(record.localDate);
    else key = monthKey(record.localDate);
    totals.set(key, (totals.get(key) ?? 0) + record.actualCostMinor);
  }

  const keys =
    granularity === 'day'
      ? eachDay(startLocalDate, endLocalDate)
      : granularity === 'week'
        ? eachWeek(startLocalDate, endLocalDate)
        : eachMonth(startLocalDate, endLocalDate);

  const buckets = keys.map((key) => ({
    key,
    label: key,
    amountMinor: totals.get(key) ?? 0,
  }));

  const totalMinor = buckets.reduce((s, b) => s + b.amountMinor, 0);
  return { totalMinor, granularity, buckets, metric: 'actual_cost' };
}
