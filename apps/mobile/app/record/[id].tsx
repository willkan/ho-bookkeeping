import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp } from '../../src/application/app-context';
import { formatYuan, yuanToMinor } from '../../src/domain/money';
import {
  EmptyState,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SecondaryButton,
} from '../../src/ui/primitives';
import { colors, spacing, typography } from '../../src/ui/tokens';

function formatLocalDateTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => `${value}`.padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseLocalDateTime(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error('发生时间请使用 YYYY-MM-DD HH:mm');
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (Number.isNaN(date.getTime())) throw new Error('发生时间无效');
  return date.toISOString();
}

export default function RecordDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { service, refresh, tick } = useApp();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [occurredLocal, setOccurredLocal] = useState('');
  const [listPriceYuan, setListPriceYuan] = useState('');
  const [actualCostYuan, setActualCostYuan] = useState('');
  const [discountYuan, setDiscountYuan] = useState('');
  const [includeInModeStats, setIncludeInModeStats] = useState(false);
  const [modeId, setModeId] = useState<string | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  const record = useMemo(() => {
    void tick;
    return id && service ? service.getConsumption(id) : undefined;
  }, [service, id, tick]);

  const raw = useMemo(() => {
    void tick;
    if (!service || !record?.rawInputId) return undefined;
    return service.getRawInput(record.rawInputId);
  }, [service, record, tick]);

  const allTags = useMemo(() => {
    void tick;
    return service?.listTags() ?? [];
  }, [service, tick]);

  const modes = useMemo(() => {
    void tick;
    return service?.listModes() ?? [];
  }, [service, tick]);

  useEffect(() => {
    if (!record || editing) return;
    setMerchant(record.merchant ?? '');
    setNote(record.note ?? '');
    setOccurredLocal(formatLocalDateTime(record.occurredAt));
    setListPriceYuan((record.listPriceMinor / 100).toFixed(2));
    setActualCostYuan((record.actualCostMinor / 100).toFixed(2));
    setDiscountYuan((record.discountMinor / 100).toFixed(2));
    setIncludeInModeStats(record.includeInModeStats);
    setModeId(record.modeId);
    setSelectedTagIds(record.tags.map((t) => t.tagId));
  }, [record, editing]);

  if (!service) {
    return (
      <Screen>
        <LoadingBlock />
      </Screen>
    );
  }
  if (!record) {
    return (
      <Screen>
        <EmptyState title="记录不存在或已撤销" />
      </Screen>
    );
  }

  const markDirty = () => setDirty(true);

  const save = () => {
    try {
      const occurredAt = parseLocalDateTime(occurredLocal);
      service.editConsumption({
        id: record.id,
        direction: record.direction,
        merchant: merchant.trim() || null,
        note: note.trim() || null,
        occurredAt,
        timezone: record.timezone,
        localDate: occurredLocal.slice(0, 10),
        listPriceMinor: yuanToMinor(Number(listPriceYuan)),
        actualCostMinor: yuanToMinor(Number(actualCostYuan)),
        discountMinor: yuanToMinor(Number(discountYuan)),
        tagIds: selectedTagIds,
        modeId,
        includeInModeStats,
      });
      setEditing(false);
      setDirty(false);
      void refresh();
    } catch (e) {
      Alert.alert('无法保存', e instanceof Error ? e.message : '校验失败');
    }
  };

  const onBackAttempt = () => {
    if (editing && dirty) {
      Alert.alert('修改还没有保存', '字段更改将丢失。', [
        { text: '继续编辑', style: 'cancel' },
        {
          text: '放弃修改',
          style: 'destructive',
          onPress: () => {
            setEditing(false);
            setDirty(false);
            router.back();
          },
        },
      ]);
      return;
    }
    router.back();
  };

  return (
    <Screen>
      <ScrollView>
        {raw ? (
          <View style={styles.box}>
            <Text style={typography.caption}>原始输入（只读）</Text>
            <Text style={typography.body}>{raw.rawText}</Text>
          </View>
        ) : null}

        <Text style={styles.amount}>¥{formatYuan(record.actualCostMinor)}</Text>
        <Text style={typography.secondary}>本次消费</Text>

        {!editing ? (
          <>
            <Row label="商品原价" value={`¥${formatYuan(record.listPriceMinor)}`} />
            <Row label="优惠券抵扣" value={`¥${formatYuan(record.discountMinor)}`} />
            <Row label="时间" value={formatLocalDateTime(record.occurredAt)} />
            <Row label="商户" value={record.merchant ?? '未填写'} />
            <Row label="备注" value={record.note ?? '—'} />
            <Row label="模式" value={modes.find((m) => m.id === record.modeId)?.name ?? '无'} />
            <Row
              label="模式统计"
              value={
                record.modeId && record.includeInModeStats
                  ? `计入“${modes.find((m) => m.id === record.modeId)?.name ?? '所选模式'}”`
                  : '不计入模式统计'
              }
            />
            <Row
              label="标签"
              value={
                record.tags
                  .map((t) => allTags.find((x) => x.id === t.tagId)?.name ?? t.tagId)
                  .join('、') || '无'
              }
            />
            <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
              <PrimaryButton label="直接编辑" onPress={() => setEditing(true)} />
              <SecondaryButton label="返回" onPress={onBackAttempt} />
              <SecondaryButton
                label="删除这条记录"
                danger
                onPress={() => {
                  Alert.alert('删除这条消费记录？', '删除后不再出现在账本和统计中。', [
                    { text: '取消', style: 'cancel' },
                    {
                      text: '删除',
                      style: 'destructive',
                      onPress: () => {
                        service.softDeleteConsumption(record.id);
                        void refresh();
                        router.back();
                      },
                    },
                  ]);
                }}
              />
            </View>
          </>
        ) : (
          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            <Field
              label="商户"
              value={merchant}
              onChangeText={(v) => {
                setMerchant(v);
                markDirty();
              }}
            />
            <Field
              label="备注"
              value={note}
              onChangeText={(v) => {
                setNote(v);
                markDirty();
              }}
            />
            <Field
              label="发生时间（YYYY-MM-DD HH:mm）"
              value={occurredLocal}
              onChangeText={(v) => {
                setOccurredLocal(v);
                markDirty();
              }}
            />
            <Field
              label="商品原价（元）"
              value={listPriceYuan}
              keyboardType="decimal-pad"
              onChangeText={(v) => {
                setListPriceYuan(v);
                markDirty();
              }}
            />
            <Field
              label="本次实付（元）"
              value={actualCostYuan}
              keyboardType="decimal-pad"
              onChangeText={(v) => {
                setActualCostYuan(v);
                markDirty();
              }}
            />
            <Field
              label="优惠券抵扣（元）"
              value={discountYuan}
              keyboardType="decimal-pad"
              onChangeText={(v) => {
                setDiscountYuan(v);
                markDirty();
              }}
            />
            <Text style={typography.secondary}>所属模式</Text>
            <View style={styles.rowWrap}>
              <Pressable
                onPress={() => {
                  setModeId(null);
                  markDirty();
                }}
                style={[styles.chip, modeId === null && styles.chipOn]}
              >
                <Text>无</Text>
              </Pressable>
              {modes.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => {
                    setModeId(m.id);
                    markDirty();
                  }}
                  style={[styles.chip, modeId === m.id && styles.chipOn]}
                >
                  <Text>{m.name}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => {
                setIncludeInModeStats((v) => !v);
                markDirty();
              }}
              style={styles.toggle}
            >
              <Text>{includeInModeStats ? '计入所选模式统计' : '不计入模式统计'}</Text>
            </Pressable>
            <Text style={typography.secondary}>标签</Text>
            <View style={styles.rowWrap}>
              {allTags.map((tag) => {
                const on = selectedTagIds.includes(tag.id);
                return (
                  <Pressable
                    key={tag.id}
                    onPress={() => {
                      setSelectedTagIds((prev) =>
                        on ? prev.filter((x) => x !== tag.id) : [...prev, tag.id],
                      );
                      markDirty();
                    }}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text>{tag.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <PrimaryButton label="保存修改" onPress={save} />
            <SecondaryButton label="取消" onPress={onBackAttempt} />
          </View>
        )}
        <Text style={styles.footnote}>只修改这条记录，不影响同一次输入的其他记录</Text>
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={typography.secondary}>{label}</Text>
      <Text style={[typography.body, { flexShrink: 1, textAlign: 'right' }]}>{value}</Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: 'default' | 'decimal-pad';
}) {
  return (
    <View>
      <Text style={typography.secondary}>{label}</Text>
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
  box: {
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  amount: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.accent,
    fontVariant: ['tabular-nums'],
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    gap: spacing.md,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 12,
    marginVertical: 6,
    backgroundColor: colors.surface,
    color: colors.ink,
  },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  toggle: {
    padding: spacing.md,
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
  },
  footnote: { ...typography.caption, marginTop: spacing.xl, marginBottom: 40 },
});
