import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MonthlyBudgetService } from '../application/monthly-budget-service';
import { formatYuan } from '../domain/money';
import { parseBudgetAmount, type MonthlyBudget } from '../domain/monthly-budget';
import { createMobileLogger } from '../infrastructure/logging/mobile-logger';
import { PrimaryButton } from './primitives';
import { colors, radius, spacing, typography } from './tokens';

const logger = createMobileLogger('monthly-budget-editor');

/** Mount on open so cancelling discards only the draft, never saved configuration. */
export function MonthlyBudgetEditor({
  budget,
  service,
  onSaved,
  onClose,
}: {
  budget: MonthlyBudget | null;
  service: MonthlyBudgetService;
  onSaved: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const initial = budget ? formatYuan(budget.amountMinor) : '';
  const [amount, setAmount] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    if (saving) return;
    if (amount !== initial) {
      Alert.alert('预算修改还没有保存', '是否放弃这次修改？', [
        { text: '继续编辑', style: 'cancel' },
        { text: '放弃修改', style: 'destructive', onPress: onClose },
      ]);
    } else onClose();
  };

  const save = () => {
    if (saving) return;
    try {
      parseBudgetAmount(amount);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '请输入有效的预算金额');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      service.save(amount);
      onSaved();
    } catch {
      logger.error('save_failed');
      setError('预算保存失败，输入已保留，请重试');
      setSaving(false);
    }
  };

  const disable = () => {
    Alert.alert('关闭月度预算？', '关闭后将不再显示预算，已记录的消费不会改变。', [
      { text: '取消', style: 'cancel' },
      {
        text: '关闭预算',
        style: 'destructive',
        onPress: () => {
          try {
            service.disable();
            onSaved();
          } catch {
            logger.error('disable_failed');
            setError('关闭失败，请重试；若预算已关闭，请退出后刷新');
          }
        },
      },
    ]);
  };

  return (
    <Modal transparent visible animationType="none" onRequestClose={close} statusBarTranslucent>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} />
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing.lg), maxHeight: '90%' },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles.handle} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <View style={styles.heading}>
              <Text style={typography.headline}>设置月度预算</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="关闭预算设置"
                onPress={close}
                style={styles.close}
                disabled={saving}
              >
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>
            <Text style={typography.secondary}>给每个月设一个消费上限</Text>
            <Text style={styles.label}>每月预算（元）</Text>
            <View style={styles.inputRow}>
              <Text style={typography.amount}>¥</Text>
              <TextInput
                value={amount}
                onChangeText={(text) => {
                  setAmount(text);
                  setError(null);
                }}
                keyboardType="decimal-pad"
                accessibilityLabel="每月预算金额"
                placeholder="请输入金额"
                placeholderTextColor={colors.muted}
                style={styles.input}
                editable={!saving}
                selectTextOnFocus
                returnKeyType="done"
                onSubmitEditing={save}
              />
            </View>
            <Text style={styles.help}>
              每月沿用此上限，剩余额度不结转。仅按本月已入账消费计算。
            </Text>
            {error ? (
              <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            <PrimaryButton
              label={saving ? '保存中…' : '保存预算'}
              onPress={save}
              disabled={saving}
            />
            {budget ? (
              <Pressable
                accessibilityRole="button"
                onPress={disable}
                disabled={saving}
                style={styles.disable}
              >
                <Text style={styles.link}>关闭预算</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.32)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginTop: spacing.sm,
  },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  label: { ...typography.body, marginTop: spacing.xl, marginBottom: spacing.sm },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  input: { ...typography.amount, flex: 1, minHeight: 52, paddingVertical: spacing.md },
  help: { ...typography.caption, lineHeight: 20, marginVertical: spacing.md },
  error: { ...typography.secondary, color: colors.danger, marginBottom: spacing.md },
  disable: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  link: { ...typography.body, color: colors.accent },
});
