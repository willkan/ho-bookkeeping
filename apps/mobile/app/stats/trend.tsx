import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { Text } from 'react-native';
import { useApp } from '../../src/application/app-context';
import { formatYuan } from '../../src/domain/money';
import type { TagMatchMode, TrendBucket, TrendGranularity } from '../../src/domain/types';
import { EmptyState, LoadingBlock, Screen } from '../../src/ui/primitives';
import { TrendBarChart } from '../../src/ui/statistics-charts';
import { typography } from '../../src/ui/tokens';

export default function TrendScreen() {
  const { start, end, granularity, tagIds, tagMatch } = useLocalSearchParams<{
    start: string;
    end: string;
    granularity?: TrendGranularity;
    tagIds?: string;
    tagMatch?: TagMatchMode;
  }>();
  const { service, tick } = useApp();
  const router = useRouter();

  const openBucket = useCallback(
    (bucket: TrendBucket) => {
      router.push({
        pathname: '/stats/drilldown',
        params: {
          start,
          end,
          tagIds: tagIds ?? '',
          tagMatch: tagMatch ?? 'and',
          granularity: granularity ?? 'day',
          trendBucketKey: bucket.key,
        },
      });
    },
    [end, granularity, router, start, tagIds, tagMatch],
  );

  const result = useMemo(() => {
    void tick;
    if (!service || !start || !end) return null;
    const ids = tagIds ? tagIds.split(',').filter(Boolean) : [];
    return service.trend(
      {
        range: { kind: 'time', startLocalDate: start, endLocalDate: end },
        tagIds: ids,
        tagMatch: tagMatch ?? 'and',
      },
      granularity ?? 'day',
    );
  }, [service, start, end, granularity, tagIds, tagMatch, tick]);

  if (!service) {
    return (
      <Screen>
        <LoadingBlock />
      </Screen>
    );
  }
  if (!result) {
    return (
      <Screen>
        <EmptyState title="暂无趋势数据" />
      </Screen>
    );
  }

  const granularityLabel =
    result.granularity === 'day' ? '按日' : result.granularity === 'week' ? '按周' : '按月';

  return (
    <Screen>
      <Text style={typography.secondary}>
        期间合计 ¥{formatYuan(result.totalMinor)} · {granularityLabel} ·{' '}
        {tagMatch === 'or' ? '满足任一' : '同时满足'}
      </Text>
      <TrendBarChart
        buckets={result.buckets}
        granularity={result.granularity}
        onBucketPress={openBucket}
      />
      <Text style={typography.caption}>没有消费的时间按 ¥0 保留；左右滑动可查看全部</Text>
    </Screen>
  );
}
