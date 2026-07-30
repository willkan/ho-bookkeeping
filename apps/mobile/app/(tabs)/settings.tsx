import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../src/application/app-context';
import { SpeechModelManager } from '../../src/application/speech-model-manager';
import { useSpeechModel } from '../../src/application/use-speech-model';
import type { ConfirmMode } from '../../src/domain/types';
import { SenseVoiceVadModelArtifacts } from '../../src/infrastructure/speech/sense-voice-vad-model-artifacts';
import { LoadingBlock, Screen, SectionLabel } from '../../src/ui/primitives';
import { colors, spacing, typography } from '../../src/ui/tokens';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { ready, service, refresh, tick, configError, providerPublic } = useApp();
  const router = useRouter();
  const settings = useMemo(() => {
    void tick;
    return service?.getSettings();
  }, [service, tick]);
  const [mode, setMode] = useState<ConfirmMode | undefined>(settings?.confirmMode);
  const [speechModelManager] = useState(
    () => new SpeechModelManager(new SenseVoiceVadModelArtifacts()),
  );
  const speechModel = useSpeechModel(speechModelManager);
  const refreshSpeechModel = speechModel.refresh;

  useFocusEffect(
    useCallback(() => {
      void refreshSpeechModel();
    }, [refreshSpeechModel]),
  );

  if (!ready || !service || !settings) {
    return (
      <Screen style={{ paddingTop: insets.top }}>
        <LoadingBlock />
      </Screen>
    );
  }

  const current = mode ?? settings.confirmMode;

  const choose = (next: ConfirmMode) => {
    service.setConfirmMode(next);
    setMode(next);
    void refresh();
  };

  return (
    <Screen style={{ paddingTop: insets.top + spacing.sm }}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <Text style={typography.title}>设置</Text>

        <SectionLabel>记账方式</SectionLabel>
        <View style={styles.group}>
          <Option
            selected={current === 'auto_post'}
            title="默认直接入账"
            detail="整理完成后直接出现在账本里"
            onPress={() => choose('auto_post')}
          />
          <Option
            selected={current === 'confirm_before_post'}
            title="入账前确认"
            detail="整理完成后，由我确认再入账"
            onPress={() => choose('confirm_before_post')}
          />
        </View>

        <SectionLabel>智能整理</SectionLabel>
        <View style={styles.group}>
          <Menu
            icon="sparkles-outline"
            title={configError ? '连接智能整理' : `已连接 ${providerPublic?.model ?? '智能整理'}`}
            detail={configError ? '填写服务地址、密钥和模型' : '自动识别金额、商户和标签'}
            onPress={() => router.push('/ai-provider')}
          />
          <View style={styles.infoRow}>
            <Ionicons name="shield-checkmark-outline" size={21} color={colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={typography.body}>隐私说明</Text>
              <Text style={typography.secondary}>每次只发送当前这条记录，不会上传完整账本</Text>
            </View>
          </View>
          <Menu
            icon="mic-outline"
            title="离线语音"
            detail={
              speechModel.state.phase === 'ready'
                ? '离线语音已就绪，可在本机识别'
                : '首次使用时选择线路并下载约 240 MB'
            }
            onPress={() => {
              if (speechModel.state.phase !== 'ready') {
                Alert.alert('离线语音', '回到记录页，按麦克风即可选择线路并下载。');
                return;
              }
              Alert.alert('删除离线语音模型？', '将释放约 240 MB，不影响账本或智能整理设置。', [
                { text: '取消', style: 'cancel' },
                {
                  text: '删除',
                  style: 'destructive',
                  onPress: () => void speechModel.deleteModel(),
                },
              ]);
            }}
          />
        </View>

        <SectionLabel>数据与管理</SectionLabel>
        <View style={styles.group}>
          <Menu
            icon="layers-outline"
            title="模式"
            detail="管理常用的记账场景"
            onPress={() => router.push('/modes')}
          />
          <Menu
            icon="pricetag-outline"
            title="标签"
            detail="整理常用标签"
            onPress={() => router.push('/tags')}
          />
          <Menu
            icon="share-outline"
            title="导出账本"
            detail="导出为 Excel 文件"
            onPress={() => router.push('/export')}
          />
        </View>

        <View style={styles.localNote}>
          <Ionicons name="lock-closed-outline" size={15} color={colors.muted} />
          <Text style={typography.caption}>账本只保存在这台设备</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

function Option({
  selected,
  title,
  detail,
  onPress,
}: {
  selected: boolean;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.option} onPress={onPress} accessibilityRole="radio">
      <View style={[styles.radio, selected && styles.radioOn]} />
      <View style={{ flex: 1 }}>
        <Text style={typography.body}>{title}</Text>
        <Text style={typography.secondary}>{detail}</Text>
      </View>
    </Pressable>
  );
}

function Menu({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.menu} onPress={onPress}>
      <Ionicons name={icon} size={22} color={colors.ink} />
      <View style={{ flex: 1 }}>
        <Text style={typography.body}>{title}</Text>
        <Text style={typography.secondary}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { paddingBottom: spacing.xxl },
  option: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.muted,
    marginTop: 2,
  },
  radioOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    overflow: 'hidden',
  },
  menu: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  infoRow: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, alignItems: 'flex-start' },
  localNote: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
});
