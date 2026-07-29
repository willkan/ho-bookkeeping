import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useApp } from '../src/application/app-context';
import { formatYuan } from '../src/domain/money';
import type { TodayTimelineItem } from '../src/application/ledger-service';
import { Chip, EmptyState, LoadingBlock, Screen } from '../src/ui/primitives';
import { colors, spacing, typography } from '../src/ui/tokens';

function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

export default function TodayScreen() {
  const { ready, service, refresh, tick } = useApp();
  const router = useRouter();
  const [filter, setFilter] = useState<'all' | 'posted' | 'pending'>('all');
  const localDate = todayLocalDate();

  const rows = useMemo(() => {
    void tick;
    if (!service) return [] as TodayTimelineItem[];
    const items = service.listTodayTimeline(localDate);
    if (filter === 'posted') return items.filter((i) => i.kind === 'record');
    if (filter === 'pending')
      return items.filter((i) => i.kind === 'raw' && i.viewStatus !== 'withdrawn');
    return items;
  }, [service, tick, localDate, filter]);

  if (!ready || !service) {
    return (
      <Screen>
        <LoadingBlock />
      </Screen>
    );
  }

  const confirmDeleteRecord = (recordId: string) => {
    Alert.alert('删除这条记录？', '删除后将不再计入账本和统计。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除记录',
        style: 'destructive',
        onPress: () => {
          service.softDeleteConsumption(recordId);
          void refresh();
        },
      },
    ]);
  };

  return (
    <Screen>
      <View style={styles.tabs}>
        {(
          [
            ['all', '全部'],
            ['posted', '已入账'],
            ['pending', '待处理'],
          ] as const
        ).map(([key, label]) => (
          <Pressable key={key} onPress={() => setFilter(key)} style={styles.tab}>
            <Text style={[styles.tabText, filter === key && styles.tabActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {rows.length === 0 ? (
        <EmptyState title="今天还没有记录" detail="回到记录页，用自然语言记一笔" />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(item) => (item.kind === 'record' ? item.record.id : `raw-${item.raw.id}`)}
          renderItem={({ item }) => {
            if (item.kind === 'record') {
              const r = item.record;
              const title = r.merchant || r.note || '未命名记录';
              return (
                <View style={styles.card}>
                  <Pressable
                    style={{ flex: 1 }}
                    onPress={() => router.push(`/record/${r.id}`)}
                    onLongPress={() => confirmDeleteRecord(r.id)}
                    delayLongPress={450}
                    accessibilityLabel={`记录 ${title}`}
                    accessibilityHint="轻点查看详情，长按删除"
                    accessibilityActions={[{ name: 'delete', label: '删除记录' }]}
                    onAccessibilityAction={(event) => {
                      if (event.nativeEvent.actionName === 'delete') confirmDeleteRecord(r.id);
                    }}
                  >
                    <View style={styles.rowTop}>
                      <Text style={typography.body}>{title}</Text>
                      <Text style={typography.amount}>-¥{formatYuan(r.actualCostMinor)}</Text>
                    </View>
                    <View style={styles.meta}>
                      <Text style={typography.caption}>{r.localDate}</Text>
                      <Chip label="已入账" tone="success" />
                    </View>
                  </Pressable>
                </View>
              );
            }
            const raw = item.raw;
            const withdrawn = item.viewStatus === 'withdrawn';
            const tone = withdrawn
              ? 'danger'
              : raw.lifecycleStatus === 'pending_parse'
                ? 'pending'
                : raw.lifecycleStatus === 'pending_confirm'
                  ? 'confirm'
                  : 'danger';
            const label = withdrawn
              ? '已撤销'
              : raw.lifecycleStatus === 'pending_parse'
                ? '待解析'
                : raw.lifecycleStatus === 'pending_confirm'
                  ? '待确认'
                  : '解析失败';
            return (
              <Pressable
                style={styles.card}
                onPress={() => {
                  if (raw.lifecycleStatus === 'pending_confirm') {
                    router.push(`/confirm/${raw.id}`);
                  } else if (!withdrawn && raw.lifecycleStatus === 'parse_failed') {
                    Alert.alert('这次输入还没有整理成功', raw.parseErrorMessage ?? '解析失败', [
                      { text: '稍后处理', style: 'cancel' },
                      {
                        text: '重新解析',
                        onPress: () => {
                          service.retryParse(raw.id);
                          void refresh();
                        },
                      },
                    ]);
                  }
                }}
              >
                <Text style={typography.body} numberOfLines={2}>
                  {raw.rawText}
                </Text>
                <View style={styles.meta}>
                  <Chip label={label} tone={tone} />
                  <Text style={typography.caption}>
                    {withdrawn ? '不再进入统计' : '原文已保存'}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.md },
  tab: { paddingVertical: spacing.sm },
  tabText: { ...typography.secondary, fontSize: 15 },
  tabActive: { color: colors.accent, fontWeight: '600' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
