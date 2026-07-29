import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../../src/application/app-context';
import { formatYuan } from '../../src/domain/money';
import type { StatFilter, TagMatchMode } from '../../src/domain/types';
import { EmptyState, LoadingBlock, Screen } from '../../src/ui/primitives';
import { colors, spacing, typography } from '../../src/ui/tokens';

export default function BreakdownScreen() {
  const { start, end, groupId, tagIds, tagMatch, modeId } = useLocalSearchParams<{
    start?: string;
    end?: string;
    groupId: string;
    tagIds?: string;
    tagMatch?: TagMatchMode;
    modeId?: string;
  }>();
  const { service, tick } = useApp();
  const router = useRouter();

  const filter: StatFilter | null = useMemo(() => {
    const ids = tagIds ? tagIds.split(',').filter(Boolean) : [];
    if (modeId) {
      return {
        range: { kind: 'mode', modeId },
        tagIds: ids,
        tagMatch: tagMatch ?? 'and',
      };
    }
    if (!start || !end) return null;
    return {
      range: { kind: 'time', startLocalDate: start, endLocalDate: end },
      tagIds: ids,
      tagMatch: tagMatch ?? 'and',
    };
  }, [start, end, tagIds, tagMatch, modeId]);

  const outcome = useMemo(() => {
    void tick;
    if (!service || !filter || !groupId) return { result: null, error: null };
    try {
      return { result: service.breakdown(filter, groupId), error: null };
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : '暂时无法生成消费占比',
      };
    }
  }, [service, filter, groupId, tick]);
  const { result, error } = outcome;

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
        <EmptyState
          title={error ? '暂时无法生成消费占比' : '暂无消费数据'}
          detail={error ?? '这个范围内还没有消费'}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={typography.secondary}>
        {modeId ? '所选模式 · 全部时间' : `${start} ~ ${end}`} · 消费金额 ·{' '}
        {tagMatch === 'or' ? '满足任一' : '同时满足'}
      </Text>
      <Text style={styles.total}>筛选后总额 ¥{formatYuan(result.totalMinor)}</Text>
      {result.buckets.map((bucket) => (
        <Pressable
          key={bucket.key}
          style={styles.row}
          onPress={() =>
            router.push({
              pathname: '/stats/drilldown',
              params: {
                start,
                end,
                tagIds: tagIds ?? '',
                tagMatch: tagMatch ?? 'and',
                modeId: modeId ?? '',
                groupId,
                bucketKey: bucket.key,
              },
            })
          }
        >
          <View style={styles.rowTop}>
            <Text style={typography.body}>{bucket.label}</Text>
            <Text style={typography.amount}>¥{formatYuan(bucket.amountMinor)}</Text>
          </View>
          <View style={styles.barTrack}>
            <View
              style={[styles.barFill, { width: `${Math.max(2, Math.round(bucket.share * 100))}%` }]}
            />
          </View>
          <Text style={typography.caption}>{(bucket.share * 100).toFixed(1)}%</Text>
        </Pressable>
      ))}
      <Text style={typography.caption}>
        合计 ¥{formatYuan(result.totalMinor)} · 100% · 每笔只计算一次
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  total: { ...typography.headline, marginVertical: spacing.md },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between' },
  barTrack: {
    height: 8,
    backgroundColor: colors.accentSoft,
    borderRadius: 4,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  barFill: { height: 8, backgroundColor: colors.accent },
});
