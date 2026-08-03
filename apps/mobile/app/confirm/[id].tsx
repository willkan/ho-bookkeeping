import { Ionicons } from '@expo/vector-icons';
import type { CandidateRecord, CandidateTag } from '@bookkeeping/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp } from '../../src/application/app-context';
import { formatYuan, yuanToMinor } from '../../src/domain/money';
import {
  Chip,
  EmptyState,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SecondaryButton,
} from '../../src/ui/primitives';
import { colors, radius, spacing, typography } from '../../src/ui/tokens';

type Editable = {
  base: CandidateRecord;
  direction: CandidateRecord['direction'];
  merchant: string;
  note: string;
  localDate: string;
  listPriceYuan: string;
  actualCostYuan: string;
  discountYuan: string;
  tags: CandidateTag[];
};

const directionOptions = [
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'transfer', label: '资产转换' },
] as const;

export default function ConfirmScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { service, refresh, tick } = useApp();
  const router = useRouter();
  const [rows, setRows] = useState<Editable[]>([]);

  const raw = useMemo(() => {
    void tick;
    if (!service || !id) return null;
    return service.getRawInput(id) ?? null;
  }, [service, id, tick]);
  const knownTags = useMemo(() => {
    void tick;
    return service?.listTags() ?? [];
  }, [service, tick]);

  useEffect(() => {
    if (!raw?.candidatesJson) {
      setRows([]);
      return;
    }
    const records = JSON.parse(raw.candidatesJson) as CandidateRecord[];
    setRows(
      records.map((base) => ({
        base,
        direction: base.direction,
        merchant: base.merchant ?? '',
        note: base.note ?? '',
        localDate: base.local_date,
        listPriceYuan: (base.list_price_minor / 100).toFixed(2),
        actualCostYuan: (base.actual_cost_minor / 100).toFixed(2),
        discountYuan: (base.discount_minor / 100).toFixed(2),
        tags: base.tags,
      })),
    );
  }, [raw?.id, raw?.candidatesJson]);

  if (!service) {
    return (
      <Screen>
        <LoadingBlock />
      </Screen>
    );
  }
  if (!raw) {
    return (
      <Screen>
        <EmptyState title="找不到待确认结果" />
      </Screen>
    );
  }

  const update = (index: number, patch: Partial<Editable>) => {
    setRows((previous) =>
      previous.map((row, itemIndex) => (itemIndex === index ? { ...row, ...patch } : row)),
    );
  };

  const buildCandidates = (): CandidateRecord[] =>
    rows.map((row) => ({
      ...row.base,
      direction: row.direction,
      merchant: row.merchant.trim() || null,
      note: row.note.trim() || null,
      occurred_at: `${row.localDate}${row.base.occurred_at.slice(10)}`,
      local_date: row.localDate,
      list_price_minor: yuanToMinor(Number(row.listPriceYuan)),
      actual_cost_minor: yuanToMinor(Number(row.actualCostYuan)),
      discount_minor: yuanToMinor(Number(row.discountYuan)),
      tags: row.tags,
    }));

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={typography.secondary}>你记下的是</Text>
        <View style={styles.rawText}>
          <Text style={typography.body}>{raw.rawText}</Text>
        </View>
        <Text style={styles.summary}>整理出 {rows.length} 笔记录，请确认</Text>

        {rows.map((row, index) => (
          <View key={index} style={styles.record}>
            <View style={styles.recordHeader}>
              <Text style={typography.headline}>第 {index + 1} 笔</Text>
              <Text style={styles.amount}>
                ¥{formatYuan(yuanToMinor(Number(row.actualCostYuan) || 0))}
              </Text>
            </View>

            <Text style={styles.label}>类型</Text>
            <View style={styles.segment}>
              {directionOptions.map((option) => {
                const selected = row.direction === option.value;
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.segmentItem, selected && styles.segmentItemSelected]}
                    onPress={() => update(index, { direction: option.value })}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                  >
                    <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Labeled
              label="商户"
              value={row.merchant}
              onChangeText={(value) => update(index, { merchant: value })}
            />
            <Labeled
              label="备注"
              value={row.note}
              onChangeText={(value) => update(index, { note: value })}
            />
            <Labeled
              label="日期"
              value={row.localDate}
              onChangeText={(value) => update(index, { localDate: value })}
            />
            <View style={styles.moneyGrid}>
              <Labeled
                label="本次实付（元）"
                value={row.actualCostYuan}
                onChangeText={(value) => update(index, { actualCostYuan: value })}
                keyboardType="decimal-pad"
                compact
              />
              <Labeled
                label="原价（元）"
                value={row.listPriceYuan}
                onChangeText={(value) => update(index, { listPriceYuan: value })}
                keyboardType="decimal-pad"
                compact
              />
              <Labeled
                label="优惠券抵扣（元）"
                value={row.discountYuan}
                onChangeText={(value) => update(index, { discountYuan: value })}
                keyboardType="decimal-pad"
                compact
              />
            </View>

            <Text style={styles.label}>标签</Text>
            <View style={styles.tags}>
              {row.tags.map((tag) => (
                <Chip
                  key={`${tag.type}:${tag.name}`}
                  label={tag.name}
                  tone="success"
                  onClose={() => update(index, { tags: row.tags.filter((item) => item !== tag) })}
                />
              ))}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tags}
            >
              {knownTags
                .filter(
                  (tag) =>
                    !row.tags.some(
                      (selected) =>
                        selected.existing_tag_id === tag.id ||
                        (selected.name === tag.name && selected.type === tag.type),
                    ),
                )
                .map((tag) => (
                  <Pressable
                    key={tag.id}
                    onPress={() =>
                      update(index, {
                        tags: [
                          ...row.tags,
                          { name: tag.name, type: tag.type, existing_tag_id: tag.id },
                        ],
                      })
                    }
                    accessibilityLabel={`添加标签${tag.name}`}
                  >
                    <View style={styles.addTag}>
                      <Ionicons name="add" size={15} color={colors.accent} />
                      <Text style={styles.addTagText}>{tag.name}</Text>
                    </View>
                  </Pressable>
                ))}
            </ScrollView>
          </View>
        ))}

        <View style={styles.actions}>
          <SecondaryButton
            label="不要这些结果"
            danger
            onPress={() => {
              service.rejectPending(raw.id);
              void refresh();
              router.back();
            }}
          />
          <PrimaryButton
            label="确认入账"
            onPress={() => {
              try {
                const candidates = buildCandidates();
                void service.confirmPending(raw.id, candidates).then(async () => {
                  await refresh();
                  router.replace('/ledger');
                });
              } catch (error) {
                Alert.alert('无法确认', error instanceof Error ? error.message : '请检查填写内容');
              }
            }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

function Labeled({
  label,
  value,
  onChangeText,
  keyboardType,
  compact,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: 'default' | 'decimal-pad';
  compact?: boolean;
}) {
  return (
    <View style={[styles.field, compact && styles.compactField]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rawText: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  summary: { ...typography.secondary, marginTop: spacing.lg },
  record: {
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  recordHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  amount: { ...typography.amount, color: colors.accent },
  label: { ...typography.caption, marginBottom: spacing.xs },
  field: { marginBottom: spacing.sm },
  compactField: { width: '48%' },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    padding: 10,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  segment: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  segmentItem: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  segmentItemSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  segmentText: { ...typography.secondary, color: colors.ink },
  segmentTextSelected: { color: colors.white, fontWeight: '600' },
  moneyGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingBottom: spacing.sm },
  addTag: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
  },
  addTagText: { ...typography.caption, color: colors.accent },
  actions: { gap: spacing.sm, marginTop: spacing.lg },
});
