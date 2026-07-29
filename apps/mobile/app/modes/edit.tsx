import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import type { TagType } from '@bookkeeping/contracts';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp } from '../../src/application/app-context';
import { Chip, PrimaryButton, Screen } from '../../src/ui/primitives';
import { colors, spacing, typography } from '../../src/ui/tokens';
import { TAG_TYPE_OPTIONS, tagTypeLabel } from '../../src/ui/tag-types';

export default function ModeEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { service, refresh, tick } = useApp();
  const router = useRouter();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [modeId, setModeId] = useState<string | undefined>(id);
  const [newTagName, setNewTagName] = useState('');
  const [newTagType, setNewTagType] = useState<TagType>('category');
  const canAddTag = newTagName.trim().length > 0;

  const tags = useMemo(() => {
    void tick;
    return service?.listTags() ?? [];
  }, [service, tick]);

  useEffect(() => {
    if (!service || !id) return;
    const mode = service.listModes().find((m) => m.id === id);
    if (mode) {
      setModeId(mode.id);
      setName(mode.name);
      setSelected(mode.defaultTagIds);
    }
  }, [service, id, tick]);

  if (!service) return <Screen />;

  return (
    <Screen>
      <Text style={typography.secondary}>{modeId ? '编辑模式' : '新建模式'}</Text>
      <Text style={[typography.secondary, { marginTop: spacing.md }]}>模式名称</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="例如：江西旅游"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <Text style={[typography.secondary, { marginTop: spacing.md }]}>默认标签</Text>
      <View style={styles.newTagRow}>
        <TextInput
          value={newTagName}
          onChangeText={setNewTagName}
          placeholder="直接新建默认标签"
          placeholderTextColor={colors.muted}
          style={[styles.input, { flex: 1, marginTop: 0 }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="添加默认标签"
          accessibilityState={{ disabled: !canAddTag }}
          disabled={!canAddTag}
          onPress={() => {
            const tag = service.createTag(newTagType, newTagName.trim());
            setSelected((prev) => (prev.includes(tag.id) ? prev : [...prev, tag.id]));
            setNewTagName('');
            void refresh();
          }}
          style={({ pressed }) => [
            styles.addTagButton,
            !canAddTag && styles.addTagButtonDisabled,
            pressed && canAddTag && styles.addTagButtonPressed,
          ]}
        >
          <Ionicons name="add" size={24} color={canAddTag ? colors.accent : colors.muted} />
        </Pressable>
      </View>
      <View style={styles.tags}>
        {TAG_TYPE_OPTIONS.map((option) => (
          <Pressable key={option.value} onPress={() => setNewTagType(option.value)}>
            <Chip label={option.label} tone={newTagType === option.value ? 'success' : 'default'} />
          </Pressable>
        ))}
      </View>
      <View style={styles.tags}>
        {tags.map((tag) => {
          const on = selected.includes(tag.id);
          return (
            <Pressable
              key={tag.id}
              onPress={() =>
                setSelected((prev) => (on ? prev.filter((x) => x !== tag.id) : [...prev, tag.id]))
              }
            >
              <Chip
                label={`${tag.name} · ${tagTypeLabel(tag.type)}`}
                tone={on ? 'success' : 'default'}
              />
            </Pressable>
          );
        })}
      </View>
      <PrimaryButton
        label="保存"
        disabled={!name.trim()}
        onPress={() => {
          service.saveMode({
            id: modeId,
            name: name.trim(),
            defaultTagIds: selected,
          });
          void refresh();
          router.back();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    borderRadius: 12,
    padding: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    color: colors.ink,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
  newTagRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  addTagButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  addTagButtonDisabled: {
    opacity: 0.72,
  },
  addTagButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
});
