import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PilotFeedbackPort, PilotWillingness } from '../application/ports/pilot-feedback';
import { ManagedPilotClientError } from '../infrastructure/ai/managed-pilot';
import { LoadingBlock, PrimaryButton, Screen, SectionLabel } from './primitives';
import { colors, radius, spacing, typography } from './tokens';

const choices: { value: PilotWillingness; title: string; detail: string }[] = [
  {
    value: 'willing',
    title: '愿意为正式版付费',
    detail: '如果它持续帮我省时间，我愿意支持作者',
  },
  { value: 'unsure', title: '还不确定', detail: '想继续体验一段时间再决定' },
  { value: 'not_willing', title: '暂不愿意', detail: '现在还没有付费意愿' },
];

export function SupportAuthorScreen({
  feedback,
  active,
  onActivate,
}: {
  feedback: PilotFeedbackPort | null;
  active: boolean;
  onActivate: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(active);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<PilotWillingness | null>(null);
  const [saved, setSaved] = useState<PilotWillingness | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!active || !feedback) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      const current = await feedback.load();
      setSelected(current.willingness);
      setSaved(current.willingness);
    } catch (error) {
      setStatus(message(error));
    } finally {
      setLoading(false);
    }
  }, [active, feedback]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(async () => {
    if (!feedback || !selected) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await feedback.save(selected);
      setSaved(result.willingness);
      setStatus('谢谢你的反馈。你可以随时回来修改选择。');
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(false);
    }
  }, [feedback, selected]);

  if (loading) {
    return (
      <Screen style={{ paddingTop: insets.top }}>
        <LoadingBlock label="正在读取反馈" />
      </Screen>
    );
  }

  return (
    <Screen style={{ paddingTop: insets.top + spacing.sm }}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <Text style={typography.title}>支持作者</Text>
        <Text style={styles.intro}>
          这不是付款，也不会产生扣费。你的匿名选择会帮助我判断是否值得继续做正式付费版。
        </Text>

        {!active || !feedback ? (
          <View style={styles.notice}>
            <Text style={typography.headline}>仅限托管 AI 内测用户</Text>
            <Text style={typography.secondary}>先用邀请码激活内测，即可提交匿名付费意愿。</Text>
            <PrimaryButton label="去激活邀请码" onPress={onActivate} />
          </View>
        ) : (
          <>
            <SectionLabel>你目前的想法</SectionLabel>
            <View style={styles.group} accessibilityRole="radiogroup">
              {choices.map((choice) => (
                <Pressable
                  key={choice.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selected === choice.value }}
                  onPress={() => {
                    setSelected(choice.value);
                    setStatus(null);
                  }}
                  style={styles.choice}
                >
                  <View style={[styles.radio, selected === choice.value && styles.radioSelected]} />
                  <View style={styles.choiceText}>
                    <Text style={typography.body}>{choice.title}</Text>
                    <Text style={typography.secondary}>{choice.detail}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
            <PrimaryButton
              label={busy ? '正在提交…' : saved === selected && saved ? '已提交' : '提交匿名反馈'}
              disabled={busy || !selected || (saved === selected && saved !== null)}
              onPress={() => void submit()}
              accessibilityLabel="submit-payment-willingness"
            />
            <Text style={styles.caption}>不占用 AI 解析额度，不会发送任何账本内容。</Text>
          </>
        )}

        {status ? (
          <View style={styles.status}>
            <Text style={typography.secondary}>{status}</Text>
            {active && feedback && saved === null ? (
              <Pressable accessibilityRole="button" onPress={() => void load()}>
                <Text style={styles.retry}>重试</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function message(error: unknown): string {
  return error instanceof ManagedPilotClientError ? error.message : '操作失败，请稍后重试';
}

const styles = StyleSheet.create({
  page: { paddingBottom: spacing.xxl },
  intro: { ...typography.secondary, marginTop: spacing.sm, marginBottom: spacing.xl },
  notice: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  group: { backgroundColor: colors.surface, borderRadius: radius.md, marginBottom: spacing.lg },
  choice: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, alignItems: 'flex-start' },
  choiceText: { flex: 1, gap: spacing.xs },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.muted,
    marginTop: 1,
  },
  radioSelected: { borderWidth: 6, borderColor: colors.accent },
  caption: { ...typography.caption, marginTop: spacing.sm, textAlign: 'center' },
  status: { marginTop: spacing.lg, gap: spacing.sm },
  retry: { color: colors.accent, fontWeight: '600' },
});
