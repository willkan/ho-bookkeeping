import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SpeechModelDownloadSource } from '../application/speech-model';
import type { SpeechModelUiState } from '../application/use-speech-model';
import { PrimaryButton, SecondaryButton } from './primitives';
import { colors, radius, spacing, typography } from './tokens';

export function SpeechModelDownloadModal({
  visible,
  state,
  onClose,
  onDownload,
}: {
  visible: boolean;
  state: SpeechModelUiState;
  onClose: () => void;
  onDownload: (source: SpeechModelDownloadSource) => void;
}) {
  const [source, setSource] = useState<SpeechModelDownloadSource>('domestic');
  const downloading = state.phase === 'downloading';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={downloading ? undefined : onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.titleRow}>
            <View style={styles.icon}>
              <Ionicons name="sparkles-outline" size={20} color={colors.accent} />
            </View>
            <View style={styles.titleCopy}>
              <Text style={typography.headline}>启用离线语音</Text>
              <Text style={typography.secondary}>
                首次下载约 240 MB，之后无需联网；停顿或松手后，语音会在本机转成文字。
              </Text>
            </View>
          </View>

          <Text style={styles.label}>选择下载线路</Text>
          <SourceOption
            selected={source === 'domestic'}
            title="国内加速"
            detail="hf-mirror.com"
            onPress={() => setSource('domestic')}
            disabled={downloading}
          />
          <SourceOption
            selected={source === 'international'}
            title="境外"
            detail="huggingface.co"
            onPress={() => setSource('international')}
            disabled={downloading}
          />

          {downloading || state.phase === 'error' ? (
            <View style={styles.progressBlock}>
              <View style={styles.progressTrack}>
                <View
                  style={[styles.progressFill, { width: `${Math.round(state.progress * 100)}%` }]}
                />
              </View>
              <Text
                style={[styles.progressText, state.error ? styles.errorText : null]}
                accessibilityLiveRegion="polite"
              >
                {state.error ? state.error : `正在下载并校验 ${Math.round(state.progress * 100)}%`}
              </Text>
            </View>
          ) : null}

          <Text style={styles.footnote}>
            两条线路下载同一个锁定模型，App 会校验文件；失败不会自动切换线路。
          </Text>
          <PrimaryButton
            label={
              downloading
                ? '下载中，请保持 App 在前台'
                : state.phase === 'error'
                  ? '重新下载'
                  : '下载并启用'
            }
            onPress={() => onDownload(source)}
            disabled={downloading}
          />
          {!downloading ? <SecondaryButton label="暂不使用" onPress={onClose} /> : null}
        </View>
      </View>
    </Modal>
  );
}

function SourceOption({
  selected,
  title,
  detail,
  onPress,
  disabled,
}: {
  selected: boolean;
  title: string;
  detail: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.source, selected && styles.sourceSelected]}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
      <View>
        <Text style={styles.sourceTitle}>{title}</Text>
        <Text style={typography.caption}>{detail}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(16, 43, 39, 0.28)',
    justifyContent: 'flex-end',
    padding: spacing.md,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  titleRow: { flexDirection: 'row', gap: spacing.md },
  titleCopy: { flex: 1, gap: spacing.xs },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { ...typography.caption, marginTop: spacing.xs },
  source: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  sourceSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.accent },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  sourceTitle: { ...typography.body, fontSize: 15 },
  progressBlock: { gap: spacing.sm },
  progressTrack: {
    height: 6,
    backgroundColor: colors.divider,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  progressText: typography.caption,
  errorText: { color: colors.danger },
  footnote: typography.caption,
});
