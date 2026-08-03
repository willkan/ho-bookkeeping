import { FlashList } from '@shopify/flash-list';
import React, { memo, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LedgerFeedItem } from '../application/ledger-feed';
import type { LedgerPendingItem } from '../application/ledger-service';
import { formatYuan } from '../domain/money';
import type { ConsumptionRecord, RawInput } from '../domain/types';
import { Chip, EmptyState } from './primitives';
import { colors, spacing, typography } from './tokens';

type Props = {
  items: LedgerFeedItem[];
  header: ReactElement;
  onOpenRecord: (recordId: string) => void;
  onDeleteRecord: (recordId: string) => void;
  onOpenPending: (rawInputId: string) => void;
  onRetryPending: (rawInputId: string) => void;
};

function localToday(): string {
  const date = new Date();
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

function shiftLocalDate(localDate: string, days: number): string {
  const [year, month, day] = localDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return shifted.toISOString().slice(0, 10);
}

function dateLabel(localDate: string): string {
  const today = localToday();
  if (localDate === today) return '今天';
  if (localDate === shiftLocalDate(today, -1)) return '昨天';
  const [year, month, day] = localDate.split('-');
  return year === today.slice(0, 4)
    ? `${Number(month)}月${Number(day)}日`
    : `${year}年${Number(month)}月${Number(day)}日`;
}

function timeLabel(instant: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(instant));
  } catch {
    return '';
  }
}

const SectionRow = memo(function SectionRow({
  section,
  count,
}: {
  section: 'pending' | 'withdrawn';
  count: number;
}) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{section === 'pending' ? '待处理' : '已撤销'}</Text>
      <Text style={typography.caption}>{count}</Text>
    </View>
  );
});

const DateRow = memo(function DateRow({ localDate }: { localDate: string }) {
  return <Text style={styles.dateTitle}>{dateLabel(localDate)}</Text>;
});

const PendingRow = memo(function PendingRow({
  item,
  onOpen,
  onRetry,
}: {
  item: LedgerPendingItem;
  onOpen: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const { raw, viewStatus } = item;
  const label =
    viewStatus === 'pending_parse'
      ? '整理中'
      : viewStatus === 'pending_confirm'
        ? '待确认'
        : '整理失败';
  const tone =
    viewStatus === 'pending_parse'
      ? 'pending'
      : viewStatus === 'pending_confirm'
        ? 'confirm'
        : 'danger';
  const actionable = viewStatus !== 'pending_parse';
  return (
    <Pressable
      style={({ pressed }) => [styles.rawRow, pressed && actionable && styles.pressed]}
      disabled={!actionable}
      onPress={() => (viewStatus === 'pending_confirm' ? onOpen(raw.id) : onRetry(raw.id))}
      accessibilityRole={actionable ? 'button' : undefined}
      accessibilityLabel={`${raw.rawText}，${label}`}
    >
      <View style={styles.rowText}>
        <Text style={typography.body} numberOfLines={2}>
          {raw.rawText}
        </Text>
        <Text style={typography.caption}>{timeLabel(raw.submittedAt, raw.timezone)}</Text>
      </View>
      <Chip label={label} tone={tone} />
    </Pressable>
  );
});

const WithdrawnRow = memo(function WithdrawnRow({ raw }: { raw: RawInput }) {
  return (
    <View style={styles.rawRow}>
      <View style={styles.rowText}>
        <Text style={styles.withdrawnText} numberOfLines={2}>
          {raw.rawText}
        </Text>
        <Text style={typography.caption}>{timeLabel(raw.submittedAt, raw.timezone)}</Text>
      </View>
      <Chip label="已撤销" />
    </View>
  );
});

const RecordRow = memo(function RecordRow({
  record,
  onOpen,
  onDelete,
}: {
  record: ConsumptionRecord;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const title = record.merchant || record.note || '消费';
  return (
    <Pressable
      style={({ pressed }) => [styles.recordRow, pressed && styles.pressed]}
      onPress={() => onOpen(record.id)}
      onLongPress={() => onDelete(record.id)}
      delayLongPress={450}
      accessibilityLabel={`记录 ${title}`}
      accessibilityHint="轻点查看详情，长按删除"
      accessibilityActions={[{ name: 'delete', label: '删除记录' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'delete') onDelete(record.id);
      }}
    >
      <View style={styles.rowText}>
        <Text style={typography.body} numberOfLines={1}>
          {title}
        </Text>
        <Text style={typography.caption}>{timeLabel(record.occurredAt, record.timezone)}</Text>
      </View>
      <Text style={typography.amount}>¥{formatYuan(record.actualCostMinor)}</Text>
    </Pressable>
  );
});

export function LedgerFeed({
  items,
  header,
  onOpenRecord,
  onDeleteRecord,
  onOpenPending,
  onRetryPending,
}: Props) {
  return (
    <FlashList
      data={items}
      keyExtractor={(item) => item.key}
      getItemType={(item) => item.type}
      ListHeaderComponent={header}
      ListEmptyComponent={<EmptyState title="还没有账单" detail="记下一笔后会出现在这里" />}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      renderItem={({ item }) => {
        switch (item.type) {
          case 'section':
            return <SectionRow section={item.section} count={item.count} />;
          case 'date':
            return <DateRow localDate={item.localDate} />;
          case 'pending':
            return <PendingRow item={item.item} onOpen={onOpenPending} onRetry={onRetryPending} />;
          case 'withdrawn':
            return <WithdrawnRow raw={item.raw} />;
          case 'record':
            return (
              <RecordRow record={item.record} onOpen={onOpenRecord} onDelete={onDeleteRecord} />
            );
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xxl },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  sectionTitle: { ...typography.secondary, color: colors.ink, fontWeight: '600' },
  dateTitle: {
    ...typography.secondary,
    color: colors.ink,
    fontWeight: '600',
    paddingTop: spacing.xl,
    paddingBottom: spacing.xs,
  },
  rawRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  recordRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowText: { flex: 1, gap: spacing.xs },
  withdrawnText: { ...typography.body, color: colors.muted },
  pressed: { opacity: 0.62 },
});
