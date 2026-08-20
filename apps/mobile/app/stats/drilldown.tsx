import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useApp } from '../../src/application/app-context';
import { formatYuan } from '../../src/domain/money';
import type { StatFilter, TagMatchMode, TrendGranularity } from '../../src/domain/types';
import { consumptionRecordTitle } from '../../src/ui/consumption-record-display';
import { EmptyState, LoadingBlock, Screen } from '../../src/ui/primitives';
import { colors, spacing, typography } from '../../src/ui/tokens';

export default function DrilldownScreen() {
  const { start, end, tagIds, tagMatch, modeId, groupId, bucketKey, granularity, trendBucketKey } =
    useLocalSearchParams<{
      start?: string;
      end?: string;
      tagIds?: string;
      tagMatch?: TagMatchMode;
      modeId?: string;
      groupId?: string;
      bucketKey?: string;
      granularity?: TrendGranularity;
      trendBucketKey?: string;
    }>();
  const { service, tick } = useApp();
  const router = useRouter();

  const records = useMemo(() => {
    void tick;
    if (!service || (!modeId && (!start || !end))) return [];
    const ids = tagIds ? tagIds.split(',').filter(Boolean) : [];
    let filter: StatFilter;
    if (modeId) {
      filter = {
        range: { kind: 'mode', modeId },
        tagIds: ids,
        tagMatch: tagMatch ?? 'and',
      };
    } else {
      if (!start || !end) return [];
      filter = {
        range: { kind: 'time', startLocalDate: start, endLocalDate: end },
        tagIds: ids,
        tagMatch: tagMatch ?? 'and',
      };
    }
    if (granularity && trendBucketKey) {
      return service.trendRecords(filter, granularity, trendBucketKey);
    }
    if (groupId && bucketKey) {
      return service.breakdownRecords(filter, groupId, bucketKey);
    }
    return service.filterRecords(filter);
  }, [
    service,
    start,
    end,
    tagIds,
    tagMatch,
    modeId,
    groupId,
    bucketKey,
    granularity,
    trendBucketKey,
    tick,
  ]);

  if (!service) {
    return (
      <Screen>
        <LoadingBlock />
      </Screen>
    );
  }

  const total = records.reduce((s, r) => s + r.actualCostMinor, 0);

  return (
    <Screen>
      <Text style={typography.secondary}>
        ¥{formatYuan(total)} · {records.length} 条记录
      </Text>
      {records.length === 0 ? (
        <EmptyState title="没有构成该结果的记录" />
      ) : (
        <FlashList
          data={records}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const rawText = item.rawInputId
              ? service.getRawInput(item.rawInputId)?.rawText
              : undefined;
            const title = consumptionRecordTitle(item, rawText);
            const detail = item.note && item.note.trim() !== title ? item.note.trim() : null;
            return (
              <Pressable style={styles.row} onPress={() => router.push(`/record/${item.id}`)}>
                <View style={styles.rowText}>
                  <Text style={typography.body} numberOfLines={2}>
                    {title}
                  </Text>
                  <Text style={typography.caption}>
                    {detail ? `${detail} · ${item.localDate}` : item.localDate}
                  </Text>
                </View>
                <Text style={typography.amount}>¥{formatYuan(item.actualCostMinor)}</Text>
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    gap: spacing.md,
  },
  rowText: { flex: 1 },
});
