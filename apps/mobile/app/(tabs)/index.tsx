import { Ionicons } from '@expo/vector-icons';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../src/application/app-context';
import { SpeechModelManager } from '../../src/application/speech-model-manager';
import { useSpeechModel } from '../../src/application/use-speech-model';
import { useVoiceSession } from '../../src/application/use-voice-session';
import type { ModeTagSnapshot } from '../../src/domain/types';
import { SherpaStreamingSpeech } from '../../src/infrastructure/speech/sherpa-streaming-speech';
import { SenseVoiceVadModelArtifacts } from '../../src/infrastructure/speech/sense-voice-vad-model-artifacts';
import {
  Chip,
  EmptyState,
  Field,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SectionLabel,
} from '../../src/ui/primitives';
import { SpeechModelDownloadModal } from '../../src/ui/speech-model-download-modal';
import { colors, radius, spacing, typography } from '../../src/ui/tokens';

function todayLocalDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function RecordScreen() {
  const insets = useSafeAreaInsets();
  const { ready, error, configError, service, refresh, tick } = useApp();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [skipMode, setSkipMode] = useState(false);
  const [disabledTagIds, setDisabledTagIds] = useState<Set<string>>(new Set());
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  const [showSpeechModel, setShowSpeechModel] = useState(false);
  const [speechModelManager] = useState(
    () => new SpeechModelManager(new SenseVoiceVadModelArtifacts()),
  );
  const speechModel = useSpeechModel(speechModelManager);
  const refreshSpeechModel = speechModel.refresh;
  const [streamingSpeech] = useState(() => new SherpaStreamingSpeech(speechModelManager));
  const voice = useVoiceSession(streamingSpeech);
  const wasCapturingVoice = useRef(false);

  useFocusEffect(
    useCallback(() => {
      void refreshSpeechModel();
    }, [refreshSpeechModel]),
  );

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (mounted) setScreenReaderEnabled(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      setScreenReaderEnabled,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const capturing = voice.state.phase === 'streaming';
    if (capturing && !wasCapturingVoice.current) {
      Vibration.vibrate(60);
    } else if (!capturing && wasCapturingVoice.current) {
      Vibration.vibrate([0, 60, 90, 60]);
    }
    wasCapturingVoice.current = capturing;
  }, [voice.state.phase]);

  useEffect(() => {
    if (voice.state.error) {
      Vibration.vibrate([0, 120, 80, 120, 80, 120]);
    }
  }, [voice.state.error]);

  const activeMode = useMemo(() => {
    void tick;
    return service?.getActiveMode();
  }, [service, tick]);

  const defaultTags = useMemo(() => {
    void tick;
    if (!service || !activeMode) return [] as ModeTagSnapshot[];
    return activeMode.defaultTagIds
      .map((id) => {
        const tag = service.listTags().find((t) => t.id === id);
        return tag ? { tagId: tag.id, name: tag.name, type: tag.type } : null;
      })
      .filter(Boolean) as ModeTagSnapshot[];
  }, [service, activeMode, tick]);

  if (!ready) {
    return (
      <Screen style={{ paddingTop: insets.top }}>
        {error ? <EmptyState title="无法打开账本" detail={error} /> : <LoadingBlock />}
      </Screen>
    );
  }

  const onSave = async () => {
    const raw = voice.displayValue.trim();
    if (!service || !raw || saving || voice.editingDisabled) return;
    setSaving(true);
    try {
      const tags = skipMode
        ? []
        : defaultTags.filter((t) => !t.tagId || !disabledTagIds.has(t.tagId));
      await service.submitRawInput({
        rawText: raw,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
        localDate: todayLocalDate(),
        defaultTagsSnapshot: tags,
        includeInModeStats: !skipMode && Boolean(activeMode),
      });
      voice.setTypedText('');
      setSkipMode(false);
      setDisabledTagIds(new Set());
      void refresh();
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2400);
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : 'unknown');
    } finally {
      setSaving(false);
    }
  };

  const onChangeText = (next: string) => {
    if (voice.editingDisabled) return;
    voice.setTypedText(next);
  };

  const onMicPress = () => {
    if (speechModel.state.phase !== 'ready') {
      setShowSpeechModel(true);
      return;
    }
    voice.pressMic();
  };

  const onMicRelease = () => {
    if (speechModel.state.phase === 'ready') voice.releaseMic();
  };

  const onAccessibleMicPress = () => {
    if (speechModel.state.phase !== 'ready') {
      setShowSpeechModel(true);
      return;
    }
    voice.toggleMicForAccessibility();
  };

  const downloadSpeechModel = async (source: Parameters<typeof speechModel.download>[0]) => {
    await speechModel.download(source);
    if (await speechModelManager.isReady()) {
      setShowSpeechModel(false);
      Alert.alert('离线语音已启用', '请再按住麦克风说话');
    }
  };

  return (
    <Screen style={{ paddingTop: insets.top + spacing.sm }}>
      <View style={styles.headerRow}>
        <Text style={typography.title}>记录</Text>
        <Pressable onPress={() => router.push('/today')} accessibilityLabel="今日账">
          <Text style={styles.link}>今日账</Text>
        </Pressable>
      </View>

      <SectionLabel>当前模式</SectionLabel>
      <Pressable
        style={styles.modeCard}
        onPress={() => router.push('/modes')}
        accessibilityLabel={`选择模式，当前${activeMode?.name ?? '未启用'}`}
      >
        <Text style={typography.body}>{activeMode?.name ?? '未启用模式'}</Text>
        <Text style={typography.secondary}>›</Text>
      </Pressable>

      {activeMode ? (
        <View style={styles.tagRow}>
          {(skipMode ? [] : defaultTags)
            .filter((t) => !t.tagId || !disabledTagIds.has(t.tagId))
            .map((t) => (
              <Chip
                key={`${t.tagId}-${t.name}`}
                label={t.name}
                onClose={() => {
                  if (t.tagId) {
                    setDisabledTagIds((prev) => new Set(prev).add(t.tagId!));
                  }
                }}
              />
            ))}
          <Pressable onPress={() => setSkipMode((v) => !v)} accessibilityLabel="本笔跳出模式">
            <Text style={[styles.escape, skipMode && styles.escapeOn]}>
              {skipMode ? '已跳出模式' : '本笔跳出模式'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.inputRow}>
        <Field
          multiline
          value={voice.displayValue}
          onChangeText={onChangeText}
          editable={!voice.editingDisabled}
          placeholder="用自然语言记一笔，例如：买xx花了100，买yy花了200"
          accessibilityLabel="自然语言输入"
          style={styles.inputField}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            screenReaderEnabled
              ? voice.micToggleAccessibilityLabel
              : voice.micHoldAccessibilityLabel
          }
          accessibilityState={{
            busy: voice.isBusy,
            selected: voice.isRecording,
          }}
          onPress={screenReaderEnabled ? onAccessibleMicPress : undefined}
          onPressIn={screenReaderEnabled ? undefined : onMicPress}
          onPressOut={screenReaderEnabled ? undefined : onMicRelease}
          style={({ pressed }) => [
            styles.micButton,
            voice.isRecording && styles.micButtonActive,
            pressed && styles.micPressed,
          ]}
        >
          <Ionicons
            name={voice.isRecording ? 'stop-circle' : voice.isBusy ? 'hourglass-outline' : 'mic'}
            size={22}
            color={voice.isRecording ? colors.white : colors.accent}
          />
        </Pressable>
      </View>

      {voice.statusMessage ? (
        <Text
          style={[styles.voiceStatus, voice.state.error ? styles.voiceError : null]}
          accessibilityRole={voice.state.error ? 'alert' : 'text'}
          accessibilityLiveRegion="polite"
        >
          {voice.statusMessage}
        </Text>
      ) : null}

      <Text style={styles.hint}>立刻保存在本机，整理在后台完成</Text>
      {savedNotice ? (
        <Text style={styles.savedNotice} accessibilityLiveRegion="polite">
          已保存，正在整理
        </Text>
      ) : null}
      <Text style={styles.disclosure}>{voice.disclosure}</Text>
      {configError ? (
        <Text style={[styles.hint, { color: colors.danger }]} accessibilityRole="alert">
          AI 未配置：{configError}
        </Text>
      ) : null}

      <PrimaryButton
        label={saving ? '保存中…' : '记下来'}
        onPress={() => void onSave()}
        disabled={saving || voice.editingDisabled || !voice.displayValue.trim()}
      />

      <View style={{ height: spacing.xl }} />
      <Link href="/settings" style={{ marginTop: spacing.md }}>
        <Text style={styles.link}>设置入账方式</Text>
      </Link>

      <SpeechModelDownloadModal
        visible={showSpeechModel}
        state={speechModel.state}
        onClose={() => setShowSpeechModel(false)}
        onDownload={(source) => void downloadSpeechModel(source)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  link: { color: colors.accent, fontSize: 15, fontWeight: '500' },
  modeCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    padding: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  escape: {
    color: colors.accent,
    fontSize: 13,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  escapeOn: {
    backgroundColor: colors.accentSoft,
    borderRadius: 999,
    overflow: 'hidden',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  inputField: {
    flex: 1,
    marginBottom: 0,
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  micButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  micPressed: {
    opacity: 0.85,
  },
  voiceStatus: {
    ...typography.caption,
    color: colors.pending,
    marginTop: spacing.sm,
  },
  voiceError: {
    color: colors.danger,
  },
  hint: {
    ...typography.caption,
    marginTop: spacing.md,
  },
  disclosure: {
    ...typography.caption,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  savedNotice: {
    ...typography.caption,
    color: colors.accent,
    marginTop: spacing.xs,
  },
});
