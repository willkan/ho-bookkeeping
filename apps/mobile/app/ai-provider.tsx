import { CONTRACT_VERSION } from '@bookkeeping/contracts';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../src/application/app-context';
import {
  DEFAULT_PROVIDER_BASE_URL,
  DEFAULT_PROVIDER_MODEL,
  InvalidProviderConfigError,
  providerFormValues,
} from '../src/infrastructure/ai/provider-config';
import type { ProviderConfigStore } from '../src/infrastructure/ai/provider-config-store';
import { SecureProviderConfigRepository } from '../src/infrastructure/ai/secure-provider-config';
import { OpenAiCompatibleParseTransport } from '../src/infrastructure/ai/transport';
import { LoadingBlock, Screen, SectionLabel } from '../src/ui/primitives';
import { colors, spacing, typography } from '../src/ui/tokens';

async function saveProviderForm(
  store: ProviderConfigStore,
  input: {
    baseUrl: string;
    apiKey: string | null;
    model: string;
    keepExistingKey: boolean;
  },
) {
  if (store instanceof SecureProviderConfigRepository) {
    return store.saveFromForm(input);
  }
  // Test/memory stores: use build path via public API surface only when available.
  const anyStore = store as ProviderConfigStore & {
    saveFromForm?: typeof SecureProviderConfigRepository.prototype.saveFromForm;
  };
  if (typeof anyStore.saveFromForm === 'function') {
    return anyStore.saveFromForm(input);
  }
  throw new Error('provider config store cannot save form');
}

/**
 * BYOK settings: Endpoint, API Key, Model, Save, Test, Clear.
 * API key is held only in local form state while editing; saved exclusively to secure store.
 */
export default function AiProviderScreen() {
  const insets = useSafeAreaInsets();
  const { ready, providerConfigStore, providerPublic, reloadProviderConfig, configError } =
    useApp();

  const [baseUrl, setBaseUrl] = useState(DEFAULT_PROVIDER_BASE_URL);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_PROVIDER_MODEL);
  const [keyDirty, setKeyDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!providerPublic) {
      const defaults = providerFormValues(null);
      setBaseUrl(defaults.baseUrl);
      setModel(defaults.model);
      setApiKey('');
      setKeyDirty(false);
      return;
    }
    const saved = providerFormValues(providerPublic);
    setBaseUrl(saved.baseUrl);
    setModel(saved.model);
    setApiKey('');
    setKeyDirty(false);
  }, [providerPublic]);

  const onSave = useCallback(async () => {
    if (!providerConfigStore) {
      setStatus('配置存储不可用');
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await saveProviderForm(providerConfigStore, {
        baseUrl,
        apiKey: keyDirty ? apiKey : null,
        model,
        keepExistingKey: !keyDirty && Boolean(providerPublic?.hasApiKey),
      });
      // Drop key from React state immediately after successful save.
      setApiKey('');
      setKeyDirty(false);
      await reloadProviderConfig();
      setStatus('已保存，可以开始智能整理账目');
    } catch (e) {
      const message =
        e instanceof InvalidProviderConfigError
          ? e.message
          : e instanceof Error
            ? e.message
            : '保存失败';
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }, [apiKey, baseUrl, keyDirty, model, providerConfigStore, providerPublic, reloadProviderConfig]);

  const onClear = useCallback(() => {
    Alert.alert('清除智能整理配置', '清除后，尚未整理的记录会暂时停下，原文不会丢失。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            if (!providerConfigStore) return;
            setBusy(true);
            try {
              await providerConfigStore.clear();
              setBaseUrl(DEFAULT_PROVIDER_BASE_URL);
              setApiKey('');
              setModel(DEFAULT_PROVIDER_MODEL);
              setKeyDirty(false);
              await reloadProviderConfig();
              setStatus('已清除');
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  }, [providerConfigStore, reloadProviderConfig]);

  const onTest = useCallback(async () => {
    if (!providerConfigStore) return;
    setBusy(true);
    setStatus(null);
    try {
      if (keyDirty || !providerPublic) {
        setStatus('请先保存配置，再测试连接');
        return;
      }
      const transport = new OpenAiCompatibleParseTransport(providerConfigStore);
      const result = await transport.parse({
        contract_version: CONTRACT_VERSION,
        request_id: `test_${Date.now()}`,
        raw_text: '测试连接：一瓶水3元',
        submitted_at: new Date().toISOString(),
        timezone: 'Asia/Shanghai',
        local_date: new Date().toISOString().slice(0, 10),
        mode_snapshot: {
          mode_id: null,
          mode_name: null,
          default_tags: [],
          include_in_mode_stats: false,
        },
        tag_candidates: [],
      });
      if (result.status === 'ok') {
        setStatus('连接正常，可以开始智能整理账目');
      } else {
        setStatus(`测试失败：${result.error_category} — ${result.message}`);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : '测试失败');
    } finally {
      setBusy(false);
    }
  }, [keyDirty, providerConfigStore, providerPublic]);

  if (!ready) {
    return (
      <Screen style={{ paddingTop: insets.top }}>
        <LoadingBlock />
      </Screen>
    );
  }

  const keyPlaceholder = providerPublic?.hasApiKey
    ? `已保存 ${providerPublic.apiKeyMasked ?? '••••'}`
    : '粘贴 API Key';

  return (
    <Screen style={{ paddingTop: insets.top + spacing.sm, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={typography.title}>智能整理</Text>
        <Text style={[typography.secondary, { marginBottom: spacing.md }]}>
          连接你使用的 AI 服务。默认值适用于 DeepSeek，也可以填写其他兼容服务。
        </Text>

        <SectionLabel>服务地址</SectionLabel>
        <TextInput
          style={styles.input}
          value={baseUrl}
          onChangeText={setBaseUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={DEFAULT_PROVIDER_BASE_URL}
          placeholderTextColor={colors.muted}
          accessibilityLabel="ai-endpoint"
        />

        <SectionLabel>密钥</SectionLabel>
        <TextInput
          style={styles.input}
          value={apiKey}
          onChangeText={(t) => {
            setApiKey(t);
            setKeyDirty(true);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder={keyPlaceholder}
          placeholderTextColor={colors.muted}
          accessibilityLabel="ai-api-key"
        />
        {providerPublic?.hasApiKey && !keyDirty ? (
          <Text style={typography.caption} accessibilityLabel="ai-api-key-masked">
            已保存（{providerPublic.apiKeyMasked}）。留空会保留原密钥，输入新密钥会替换。
          </Text>
        ) : (
          <Text style={typography.caption}>密钥仅保存在系统安全存储，不会写入账本或导出。</Text>
        )}

        <SectionLabel>模型</SectionLabel>
        <TextInput
          style={styles.input}
          value={model}
          onChangeText={setModel}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={DEFAULT_PROVIDER_MODEL}
          placeholderTextColor={colors.muted}
          accessibilityLabel="ai-model"
        />

        <View style={styles.actions}>
          <Pressable
            style={[styles.btnPrimary, busy && styles.btnDisabled]}
            onPress={() => void onSave()}
            disabled={busy}
            accessibilityLabel="ai-save"
          >
            <Text style={styles.btnPrimaryText}>保存</Text>
          </Pressable>
          <Pressable
            style={[styles.btnSecondary, busy && styles.btnDisabled]}
            onPress={() => void onTest()}
            disabled={busy}
            accessibilityLabel="ai-test"
          >
            <Text style={styles.btnSecondaryText}>测试连接</Text>
          </Pressable>
          <Pressable
            style={[styles.btnDanger, busy && styles.btnDisabled]}
            onPress={onClear}
            disabled={busy}
            accessibilityLabel="ai-clear"
          >
            <Text style={styles.btnDangerText}>清空</Text>
          </Pressable>
        </View>

        <Text style={[typography.caption, { marginTop: spacing.sm }]}>
          测试会发送“一瓶水 3 元”并可能产生少量费用，不会写入账本。
        </Text>

        <View style={styles.card}>
          <Text style={typography.body}>安全说明</Text>
          <Text style={typography.secondary}>
            API Key 只存在本机安全存储。已 root /
            越狱的设备仍可能被恶意软件读取本地密钥。请勿把密钥发到聊天或截图分享。
          </Text>
          {configError && !providerPublic ? (
            <Text
              style={[typography.secondary, { color: colors.danger, marginTop: 8 }]}
              accessibilityLabel="ai-missing-config"
            >
              尚未配置 AI 提供商。填写并保存后即可解析。
            </Text>
          ) : null}
          {providerPublic ? (
            <Text
              style={[typography.caption, { marginTop: 8 }]}
              accessibilityLabel="ai-config-meta"
            >
              当前模型：{providerPublic.model}
            </Text>
          ) : null}
        </View>

        {status ? (
          <Text
            style={[typography.secondary, { marginTop: spacing.md, color: colors.ink }]}
            accessibilityLabel="ai-provider-status"
          >
            {status}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.ink,
    fontSize: 16,
    marginBottom: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  btnPrimary: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  btnPrimaryText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  btnSecondary: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  btnSecondaryText: {
    color: colors.ink,
    fontWeight: '600',
    fontSize: 16,
  },
  btnDanger: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
  },
  btnDangerText: {
    color: colors.danger,
    fontWeight: '600',
    fontSize: 16,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginTop: spacing.lg,
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
});
