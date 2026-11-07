import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../src/application/app-context';
import { formatYuan } from '../../src/domain/money';
import type { TagMatchMode, TrendBucket, TrendGranularity } from '../../src/domain/types';
import { EmptyState, LoadingBlock, Screen } from '../../src/ui/primitives';
import { TrendBarChart } from '../../src/ui/statistics-charts';
import { colors, radius, spacing, typography } from '../../src/ui/tokens';

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
  const insets = useSafeAreaInsets();
  const selectedTags = useMemo(() => {
    void tick;
    const ids = new Set(tagIds?.split(',').filter(Boolean));
    return service?.listTags().filter((tag) => ids.has(tag.id)) ?? [];
  }, [service, tagIds, tick]);

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

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
      >
        <Text style={typography.secondary}>
          {start.replaceAll('-', '.')} — {end.replaceAll('-', '.')}
        </Text>
        {selectedTags.length > 0 ? (
          <Text style={styles.conditions}>
            {selectedTags.map((tag) => tag.name).join(' · ')}
            {selectedTags.length > 1 ? ` · ${tagMatch === 'or' ? '满足任一' : '同时满足'}` : ''}
          </Text>
        ) : null}
        <View style={styles.summary}>
          <Text style={typography.secondary}>期间消费</Text>
          <Text
            style={styles.total}
            accessibilityLabel={`期间消费 ${formatYuan(result.totalMinor)} 元`}
          >
            <Text style={styles.currency}>¥ </Text>
            {formatYuan(result.totalMinor)}
          </Text>
          <Text style={typography.caption}>按本次实付统计</Text>
        </View>
        <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="时间粒度">
          {(['day', 'week', 'month'] as const).map((item) => (
            <Pressable
              key={item}
              accessibilityRole="radio"
              accessibilityState={{ checked: result.granularity === item }}
              onPress={() => router.setParams({ granularity: item })}
              style={[styles.segmentItem, result.granularity === item && styles.selectedItem]}
            >
              <Text
                style={[styles.segmentText, result.granularity === item && styles.selectedText]}
              >
                {item === 'day' ? '日' : item === 'week' ? '周' : '月'}
              </Text>
            </Pressable>
          ))}
        </View>
        <TrendBarChart
          key={result.granularity}
          buckets={result.buckets}
          granularity={result.granularity}
          onBucketPress={openBucket}
        />
        <View style={styles.hint}>
          <Text style={typography.secondary}>轻点柱形，查看这段时间的账单</Text>
          <Text style={typography.caption}>左右滑动查看全部 · 无消费的时间显示为 0</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.sm },
  conditions: { ...typography.caption, marginTop: spacing.sm },
  summary: { paddingVertical: spacing.xl, gap: spacing.sm },
  total: { ...typography.amount, fontSize: 36, color: colors.ink },
  currency: { fontSize: 22, fontWeight: '400' },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.accentSoft,
    padding: spacing.xs,
    borderRadius: radius.md,
  },
  segmentItem: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  selectedItem: { backgroundColor: colors.surface },
  segmentText: { ...typography.body, color: colors.muted },
  selectedText: { color: colors.accent, fontWeight: '600' },
  hint: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    gap: spacing.sm,
  },
});
