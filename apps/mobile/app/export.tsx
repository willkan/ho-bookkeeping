import React, { useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { useApp } from '../src/application/app-context';
import {
  ALL_EXPORT_FIELDS,
  type ExportFieldId,
  allExportFieldIds,
} from '../src/infrastructure/export/export-fields';
import { writeExportFile } from '../src/infrastructure/export/write-export-file';
import { Chip, PrimaryButton, Screen, SectionLabel, SecondaryButton } from '../src/ui/primitives';
import { colors, spacing, typography } from '../src/ui/tokens';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ExportScreen() {
  const { service } = useApp();
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState('2020-01-01');
  const [end, setEnd] = useState(today());
  const [selected, setSelected] = useState<ExportFieldId[]>(allExportFieldIds());

  const toggle = (id: ExportFieldId) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const runExport = async (full: boolean) => {
    if (!service || busy) return;
    if (!full && selected.length === 0) {
      Alert.alert('请选择至少一个业务字段');
      return;
    }
    setBusy(true);
    try {
      const snapshot = service.exportSnapshot();
      const generatedAt = new Date().toISOString();
      // Dynamic import keeps exceljs off the startup graph (Hermes stack overflow).
      const { buildLedgerWorkbook } = await import('../src/infrastructure/export/excel-export');
      const buffer = await buildLedgerWorkbook(snapshot, {
        fullLedger: full,
        startLocalDate: full ? undefined : start,
        endLocalDate: full ? undefined : end,
        selectedFields: full ? undefined : selected,
        generatedAt,
      });

      const filename = `bookkeeping_${generatedAt.slice(0, 10)}.xlsx`;
      const bytes = new Uint8Array(buffer);
      const { uri } = writeExportFile(filename, bytes);

      const Sharing = await import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          dialogTitle: '导出完成',
        });
      }
      Alert.alert(
        '导出完成',
        `${filename}\n范围：${full ? '完整账本' : `${start} ~ ${end}`}\n字段：${
          full
            ? '全部业务字段'
            : ALL_EXPORT_FIELDS.filter((f) => selected.includes(f.id))
                .map((f) => f.label)
                .join('、')
        }`,
      );
    } catch (e) {
      // Do not report false in-memory success.
      Alert.alert('导出失败', e instanceof Error ? e.message : 'unknown');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <SectionLabel>时间范围</SectionLabel>
      <TextInput
        value={start}
        onChangeText={setStart}
        placeholder="开始 YYYY-MM-DD"
        placeholderTextColor={colors.muted}
        style={inputStyle}
      />
      <TextInput
        value={end}
        onChangeText={setEnd}
        placeholder="结束 YYYY-MM-DD"
        placeholderTextColor={colors.muted}
        style={inputStyle}
      />

      <SectionLabel>选择导出内容</SectionLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md }}>
        {ALL_EXPORT_FIELDS.map((f) => (
          <Pressable key={f.id} onPress={() => toggle(f.id)}>
            <Chip label={f.label} tone={selected.includes(f.id) ? 'success' : 'default'} />
          </Pressable>
        ))}
      </View>
      <SecondaryButton label="全选字段" onPress={() => setSelected(allExportFieldIds())} />
      <View style={{ height: spacing.sm }} />
      <PrimaryButton
        label={busy ? '正在生成…' : '导出所选内容'}
        onPress={() => void runExport(false)}
        disabled={busy || !service}
      />
      <View style={{ height: spacing.sm }} />
      <SecondaryButton label="导出完整账本" onPress={() => void runExport(true)} />
      <Text style={[typography.caption, { marginTop: spacing.lg }]}>
        导出内容不包含 AI 密钥等敏感信息。
      </Text>
    </Screen>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.divider,
  borderRadius: 12,
  padding: spacing.md,
  marginBottom: spacing.sm,
  color: colors.ink,
  backgroundColor: colors.surface,
} as const;
