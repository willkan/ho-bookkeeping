import { CONTRACT_VERSION } from '@bookkeeping/contracts';
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../src/application/app-context';
import {
  ManagedPilotActivationClient,
  ManagedPilotClientError,
  ManagedPilotParseTransport,
} from '../src/infrastructure/ai/managed-pilot';
import { ExpoCryptoIdGenerator } from '../src/infrastructure/ids/expo-crypto-id-generator';
import { LoadingBlock, Screen, SectionLabel } from '../src/ui/primitives';
import { colors, spacing, typography } from '../src/ui/tokens';

const ids = new ExpoCryptoIdGenerator();

export default function ManagedAiPilotScreen() {
  const insets = useSafeAreaInsets();
  const { ready, managedPilotStore, managedPilotPublic, reloadManagedPilot } = useApp();
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const activate = useCallback(async () => {
    if (!managedPilotStore) return;
    setBusy(true);
    setStatus(null);
    try {
      const client = new ManagedPilotActivationClient(managedPilotStore, () =>
        ids.createId('activate'),
      );
      await client.activate(inviteCode);
      setInviteCode('');
      await reloadManagedPilot();
      setStatus('邀请码已激活，之后的智能整理将使用托管 AI 内测');
    } catch (error) {
      setStatus(error instanceof ManagedPilotClientError ? error.message : '激活失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  }, [inviteCode, managedPilotStore, reloadManagedPilot]);

  const testConnection = useCallback(async () => {
    if (!managedPilotStore) return;
    setBusy(true);
    setStatus(null);
    const now = new Date();
    try {
      const result = await new ManagedPilotParseTransport(managedPilotStore).parse({
        contract_version: CONTRACT_VERSION,
        request_id: ids.createId('pilot_test'),
        raw_text: '测试连接：一瓶水3元',
        submitted_at: now.toISOString(),
        timezone: 'Asia/Shanghai',
        local_date: localDate(now, 'Asia/Shanghai'),
        mode_snapshot: {
          mode_id: null,
          mode_name: null,
          default_tags: [],
          include_in_mode_stats: false,
        },
        tag_candidates: [],
      });
      setStatus(
        result.status === 'ok' ? '连接正常，托管 AI 可以使用' : `测试失败：${result.message}`,
      );
    } catch {
      setStatus('测试失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  }, [managedPilotStore]);

  const leavePilot = useCallback(() => {
    Alert.alert(
      '退出托管 AI 内测？',
      '本机会清除内测访问凭证。之后仅使用你单独保存的自备密钥配置。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '退出内测',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (!managedPilotStore) return;
              setBusy(true);
              try {
                await managedPilotStore.clear();
                await reloadManagedPilot();
                setStatus('已退出托管 AI 内测');
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [managedPilotStore, reloadManagedPilot]);

  if (!ready) {
    return (
      <Screen style={{ paddingTop: insets.top }}>
        <LoadingBlock />
      </Screen>
    );
  }

  const credentialCurrent = managedPilotPublic?.accessTokenCurrent;

  return (
    <Screen style={{ paddingTop: insets.top + spacing.sm, flex: 1 }}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={typography.title}>托管 AI 内测</Text>
        <Text style={styles.intro}>
          仅面向受邀用户。每次只发送当前这条待整理内容，完整账本仍只保存在本机。
        </Text>

        {managedPilotPublic && credentialCurrent ? (
          <>
            <SectionLabel>当前状态</SectionLabel>
            <View style={styles.statusCard}>
              <Text style={typography.body}>已激活</Text>
              <Text style={typography.secondary}>
                内测有效期至 {formatDate(managedPilotPublic.entitlementExpiresAt)}
              </Text>
              <Text style={typography.secondary}>
                总额度 {managedPilotPublic.totalLimit} 次 · 每日 {managedPilotPublic.dailyLimit} 次
              </Text>
            </View>
            <Pressable
              style={[styles.primaryButton, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void testConnection()}
              accessibilityLabel="managed-pilot-test"
            >
              <Text style={styles.primaryText}>测试连接</Text>
            </Pressable>
            <Pressable
              style={[styles.dangerButton, busy && styles.disabled]}
              disabled={busy}
              onPress={leavePilot}
              accessibilityLabel="managed-pilot-leave"
            >
              <Text style={styles.dangerText}>退出内测</Text>
            </Pressable>
            <Text style={typography.caption}>测试会消耗一次内测额度，但不会写入账本。</Text>
          </>
        ) : (
          <>
            <SectionLabel>邀请码</SectionLabel>
            {managedPilotPublic ? (
              <Text style={[typography.secondary, { marginBottom: spacing.sm }]}>
                访问凭证已过期，请重新输入原邀请码激活。
              </Text>
            ) : null}
            <TextInput
              style={styles.input}
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              placeholder="输入邀请码"
              placeholderTextColor={colors.muted}
              accessibilityLabel="managed-pilot-invite-code"
            />
            <Pressable
              style={[styles.primaryButton, busy && styles.disabled]}
              disabled={busy || inviteCode.trim().length < 16}
              onPress={() => void activate()}
              accessibilityLabel="managed-pilot-activate"
            >
              <Text style={styles.primaryText}>{busy ? '正在激活…' : '激活邀请码'}</Text>
            </Pressable>
            <Text style={typography.caption}>
              激活后，短期访问凭证只保存在系统安全存储，不会写入账本或导出。
            </Text>
          </>
        )}

        {status ? (
          <Text style={styles.result} accessibilityLabel="managed-pilot-status">
            {status}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function localDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}-${parts.find((p) => p.type === 'day')?.value}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value));
}

const styles = StyleSheet.create({
  page: { paddingBottom: spacing.xxl },
  intro: { ...typography.secondary, marginBottom: spacing.md },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.ink,
    fontSize: 16,
    marginBottom: spacing.md,
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  primaryText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  dangerButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  dangerText: { color: colors.danger, fontWeight: '600', fontSize: 16 },
  disabled: { opacity: 0.5 },
  result: { ...typography.secondary, color: colors.ink, marginTop: spacing.md },
});
