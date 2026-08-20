import { FlashList } from '@shopify/flash-list';
import React, { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '../src/application/app-context';
import { formatYuan } from '../src/domain/money';
import type { ConsumptionRecord } from '../src/domain/types';
import { consumptionRecordTitle } from '../src/ui/consumption-record-display';
import { EmptyState, LoadingBlock, Screen, SecondaryButton } from '../src/ui/primitives';
import { colors, radius, spacing, typography } from '../src/ui/tokens';

function withdrawnTime(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

const WithdrawnRecordRow = memo(function WithdrawnRecordRow({
  record,
  onRestore,
}: {
  record: ConsumptionRecord;
  onRestore: (id: string) => void;
}) {
  const title = consumptionRecordTitle(record);
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={typography.body} numberOfLines={1}>
          {title}
        </Text>
        <Text style={typography.caption}>
          {record.localDate} · 撤销于 {withdrawnTime(record.deletedAt)}
        </Text>
      </View>
      <View style={styles.rowAction}>
        <Text style={typography.amount}>¥{formatYuan(record.actualCostMinor)}</Text>
        <Pressable
          style={({ pressed }) => [styles.restoreButton, pressed && styles.pressed]}
          onPress={() => onRestore(record.id)}
          accessibilityRole="button"
          accessibilityLabel={`恢复账单 ${title}`}
        >
          <Text style={styles.restoreText}>恢复</Text>
        </Pressable>
      </View>
    </View>
  );
});

export default function WithdrawnLedgerScreen() {
  const { ready, service, refresh, tick } = useApp();
  const router = useRouter();
  const records = useMemo(() => {
    void tick;
    return service?.listWithdrawnLedger() ?? [];
  }, [service, tick]);
  const restore = useCallback(
    (id: string) => {
      if (!service) return;
      service.restoreConsumption(id);
      void refresh();
    },
    [refresh, service],
  );

  if (!ready || !service) {
    return (
      <Screen>
        <LoadingBlock />
      </Screen>
    );
  }

  return (
    <Screen>
      {records.length === 0 ? (
        <View style={styles.emptyPage}>
          <EmptyState title="没有已撤销账单" detail="撤销的账单会暂存在这里，可以随时恢复" />
          <SecondaryButton label="返回账单" onPress={() => router.back()} />
        </View>
      ) : (
        <FlashList
          data={records}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <WithdrawnRecordRow record={item} onRestore={restore} />}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xxl },
  emptyPage: { flex: 1, justifyContent: 'center', gap: spacing.md },
  row: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowText: { flex: 1, gap: spacing.xs },
  rowAction: { alignItems: 'flex-end', gap: spacing.xs },
  restoreButton: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  restoreText: { ...typography.secondary, color: colors.accent, fontWeight: '600' },
  pressed: { opacity: 0.65 },
});
