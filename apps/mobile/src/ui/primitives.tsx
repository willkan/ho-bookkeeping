import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewProps,
} from 'react-native';
import { colors, radius, spacing, typography } from './tokens';

export function Screen({ style, ...props }: ViewProps) {
  return <View style={[styles.screen, style]} {...props} />;
}

export function Hairline() {
  return <View style={styles.hairline} />;
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        danger && styles.dangerBorder,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.secondaryButtonText, danger && styles.dangerText]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ style, ...props }: TextInputProps) {
  return <TextInput placeholderTextColor={colors.muted} style={[styles.field, style]} {...props} />;
}

export function Chip({
  label,
  onClose,
  tone = 'default',
}: {
  label: string;
  onClose?: () => void;
  tone?: 'default' | 'pending' | 'confirm' | 'danger' | 'success';
}) {
  const toneStyle =
    tone === 'pending'
      ? styles.chipPending
      : tone === 'confirm'
        ? styles.chipConfirm
        : tone === 'danger'
          ? styles.chipDanger
          : tone === 'success'
            ? styles.chipSuccess
            : styles.chipDefault;
  return (
    <View style={[styles.chip, toneStyle]}>
      <Text style={[styles.chipText, tone === 'success' && styles.chipTextSelected]}>{label}</Text>
      {onClose ? (
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={`移除 ${label}`}
        >
          <Ionicons
            name="close"
            size={15}
            color={tone === 'success' ? colors.white : colors.muted}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function LoadingBlock({ label = '加载中' }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} />
      <Text style={typography.secondary}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={typography.headline}>{title}</Text>
      {detail ? <Text style={typography.secondary}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '500',
  },
  dangerBorder: { borderColor: colors.danger },
  dangerText: { color: colors.danger },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85 },
  field: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.ink,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  chipDefault: { backgroundColor: colors.accentSoft },
  chipPending: { backgroundColor: '#E5F5F7' },
  chipConfirm: { backgroundColor: '#F7EEDC' },
  chipDanger: { backgroundColor: '#FBE7E5' },
  chipSuccess: { backgroundColor: colors.accent },
  chipText: { color: colors.ink, fontSize: 13 },
  chipTextSelected: { color: colors.white, fontWeight: '600' },
  sectionLabel: {
    ...typography.secondary,
    marginBottom: spacing.sm,
  },
  loading: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
});
