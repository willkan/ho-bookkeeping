import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMonthlyBudget } from '../application/use-monthly-budget';
import { formatYuan } from '../domain/money';
import { MonthlyBudgetEditor } from './monthly-budget-editor';
import { LoadingBlock } from './primitives';
import { colors, spacing, typography } from './tokens';

function money(minor: number): string {
  const [yuan, fen] = formatYuan(minor).split('.');
  return `¥${yuan!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fen}`;
}

export function MonthlyBudgetPanel({
  variant,
  onOpenOverview,
}: {
  variant: 'home' | 'ledger';
  onOpenOverview?: () => void;
}) {
  const { state, retry, monthlyBudgetService, refresh } = useMonthlyBudget();
  const [editing, setEditing] = useState(false);
  if (state.status === 'loading') return <LoadingBlock label="正在读取预算" />;
  if (state.status === 'error')
    return (
      <Pressable
        onPress={retry}
        accessibilityRole="button"
        accessibilityLabel="预算暂时无法读取，点击重试"
        style={styles.error}
      >
        <Text style={typography.secondary}>预算暂时无法读取</Text>
        <Text style={styles.link}>重试</Text>
      </Pressable>
    );

  const { budget, remainingMinor, usedPercentTenths, spentMinor, recordCount } = state.overview;
  const overspent = remainingMinor !== null && remainingMinor < 0;
  const tone = overspent ? colors.danger : colors.accent;
  const percent =
    usedPercentTenths === null
      ? null
      : `${Math.floor(usedPercentTenths / 10)}.${usedPercentTenths % 10}%`;
  const remaining = remainingMinor === null ? null : money(Math.abs(remainingMinor));
  const remainingLabel = overspent
    ? '已超出预算'
    : variant === 'home'
      ? '本月剩余预算'
      : '剩余预算';
  const openEditor = () => setEditing(true);

  const progress =
    budget && usedPercentTenths !== null ? (
      <View
        style={styles.progressRow}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`本月预算已使用 ${percent}`}
        accessibilityValue={{ text: `已使用 ${percent}` }}
      >
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { backgroundColor: tone, width: `${Math.min(100, usedPercentTenths / 10)}%` },
            ]}
          />
        </View>
        <Text style={typography.caption}>{percent}</Text>
      </View>
    ) : null;

  return (
    <View style={variant === 'home' ? styles.home : styles.ledger}>
      {variant === 'home' ? (
        budget ? (
          <Pressable
            onPress={onOpenOverview}
            accessibilityRole="button"
            accessibilityLabel={`${remainingLabel} ${remaining}，已花 ${money(spentMinor)}，预算 ${money(budget.amountMinor)}，已使用 ${percent}，查看预算详情`}
          >
            <Text style={typography.secondary}>{remainingLabel}</Text>
            <View style={styles.row}>
              <Text style={[styles.homeAmount, { color: tone }]}>{remaining}</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </View>
            <Text style={typography.caption}>
              已花 {money(spentMinor)} / 预算 {money(budget.amountMinor)}
            </Text>
            {progress}
          </Pressable>
        ) : (
          <Pressable onPress={openEditor} accessibilityRole="button" style={styles.setup}>
            <Text style={styles.link}>设置月度预算</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.accent} />
          </Pressable>
        )
      ) : (
        <>
          <View style={styles.overviewRow}>
            <View style={styles.spending}>
              <Text style={typography.secondary}>本月消费</Text>
              <Text style={styles.total}>{money(spentMinor)}</Text>
              <Text style={typography.caption}>{recordCount} 条记录</Text>
            </View>
            <Pressable
              onPress={openEditor}
              accessibilityRole="button"
              accessibilityLabel={
                budget ? `本月预算 ${money(budget.amountMinor)}，修改月度预算` : '设置月度预算'
              }
              style={styles.edit}
            >
              <Text style={typography.caption}>本月预算</Text>
              <View style={styles.editAmount}>
                <Text style={budget ? typography.amount : styles.link}>
                  {budget ? money(budget.amountMinor) : '设置预算'}
                </Text>
                <Ionicons
                  name={budget ? 'pencil-outline' : 'add'}
                  size={17}
                  color={colors.accent}
                />
              </View>
            </Pressable>
          </View>
          {progress}
          {budget ? (
            <View style={styles.remaining}>
              <Text style={typography.caption}>{remainingLabel}</Text>
              <Text style={[styles.remainingAmount, overspent && styles.danger]}>{remaining}</Text>
              {overspent ? <Text style={typography.caption}>可调整预算，继续正常记账</Text> : null}
            </View>
          ) : null}
        </>
      )}
      {editing && monthlyBudgetService ? (
        <MonthlyBudgetEditor
          budget={budget}
          service={monthlyBudgetService}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void refresh();
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  home: { marginBottom: spacing.lg },
  ledger: { paddingVertical: spacing.xl },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  homeAmount: { ...typography.amount, fontSize: 30, marginVertical: spacing.xs, flexShrink: 1 },
  overviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  spending: { flexGrow: 1 },
  total: { ...typography.amount, fontSize: 30, color: colors.accent, marginVertical: spacing.xs },
  edit: { justifyContent: 'center', minHeight: 44, gap: spacing.xs },
  editAmount: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: colors.accentSoft,
  },
  fill: { height: 4, borderRadius: 2 },
  remaining: { marginTop: spacing.sm, gap: spacing.xs },
  remainingAmount: { ...typography.amount, fontSize: 22 },
  danger: { color: colors.danger },
  setup: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44 },
  link: { ...typography.secondary, color: colors.accent },
  error: { paddingVertical: spacing.md, gap: spacing.sm },
});
