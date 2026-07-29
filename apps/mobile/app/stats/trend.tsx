import { useLocalSearchParams } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useApp } from '../../src/application/app-context';
import { formatYuan } from '../../src/domain/money';
import type { TagMatchMode, TrendGranularity } from '../../src/domain/types';
import { EmptyState, LoadingBlock, Screen } from '../../src/ui/primitives';
import { colors, spacing, typography } from '../../src/ui/tokens';

export default function TrendScreen() {
  const { start, end, granularity, tagIds, tagMatch } = useLocalSearchParams<{
    start: string;
    end: string;
    granularity?: TrendGranularity;
    tagIds?: string;
    tagMatch?: TagMatchMode;
  }>();
  const { service, tick } = useApp();

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

  const max = Math.max(1, ...result.buckets.map((b) => b.amountMinor));

  return (
    <Screen>
      <Text style={typography.secondary}>
        期间合计 ¥{formatYuan(result.totalMinor)} · {result.granularity} ·{' '}
        {tagMatch === 'or' ? '满足任一' : '同时满足'}
      </Text>
      <View style={styles.chart}>
        {result.buckets.map((bucket) => (
          <View key={bucket.key} style={styles.col}>
            <View
              style={[
                styles.bar,
                { height: Math.max(4, Math.round((bucket.amountMinor / max) * 120)) },
              ]}
            />
            <Text style={styles.label}>{bucket.label.slice(5)}</Text>
            <Text style={styles.val}>{formatYuan(bucket.amountMinor)}</Text>
          </View>
        ))}
      </View>
      <Text style={typography.caption}>没有消费的日期按 ¥0 显示</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    marginVertical: spacing.xl,
    minHeight: 160,
  },
  col: { alignItems: 'center', flex: 1 },
  bar: {
    width: '80%',
    backgroundColor: colors.accent,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  label: { ...typography.caption, marginTop: 4, fontSize: 10 },
  val: { ...typography.caption, fontSize: 10 },
});
