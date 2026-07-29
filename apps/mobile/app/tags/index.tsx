import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import type { TagType } from '@bookkeeping/contracts';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useApp } from '../../src/application/app-context';
import { Chip, PrimaryButton, Screen, SecondaryButton } from '../../src/ui/primitives';
import { colors, spacing, typography } from '../../src/ui/tokens';
import { TAG_TYPE_OPTIONS, tagTypeLabel } from '../../src/ui/tag-types';

export default function TagsScreen() {
  const { service, refresh, tick } = useApp();
  const [q, setQ] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<TagType>('category');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameType, setRenameType] = useState<TagType>('category');
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);

  const tags = useMemo(() => {
    void tick;
    const all = service?.listTags() ?? [];
    if (!q.trim()) return all;
    return all.filter((t) => t.name.includes(q.trim()));
  }, [service, tick, q]);

  if (!service) return <Screen />;

  const renameTarget = tags.find((t) => t.id === renameId);
  const mergeSource = tags.find((t) => t.id === mergeSourceId);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="搜索标签"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        <View style={styles.createRow}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="新建标签"
            placeholderTextColor={colors.muted}
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="新建标签"
            disabled={!newName.trim()}
            style={({ pressed }) => [
              styles.addButton,
              !newName.trim() && styles.disabled,
              pressed && Boolean(newName.trim()) && styles.addButtonPressed,
            ]}
            onPress={() => {
              if (!newName.trim()) return;
              service.createTag(newType, newName.trim());
              setNewName('');
              void refresh();
            }}
          >
            <Ionicons name="add" size={24} color={newName.trim() ? colors.accent : colors.muted} />
          </Pressable>
        </View>
        <View style={styles.typeRow}>
          {TAG_TYPE_OPTIONS.map((option) => (
            <Pressable key={option.value} onPress={() => setNewType(option.value)}>
              <Chip label={option.label} tone={newType === option.value ? 'success' : 'default'} />
            </Pressable>
          ))}
        </View>
        <Text style={typography.caption}>标签调整仅影响引用，原始输入不会改变。</Text>
        {tags.map((tag) => (
          <View key={tag.id} style={styles.row}>
            <View>
              <Text style={typography.body}>{tag.name}</Text>
              <Text style={typography.caption}>{tagTypeLabel(tag.type)}</Text>
            </View>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`编辑${tag.name}`}
                onPress={() => {
                  setRenameId(tag.id);
                  setRenameValue(tag.name);
                  setRenameType(tag.type);
                }}
              >
                <Ionicons name="pencil-outline" size={20} color={colors.muted} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`合并${tag.name}`}
                onPress={() => setMergeSourceId(tag.id)}
              >
                <Ionicons name="git-merge-outline" size={20} color={colors.muted} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`删除${tag.name}`}
                onPress={() => {
                  Alert.alert('删除标签？', `将删除「${tag.name}」。`, [
                    { text: '取消', style: 'cancel' },
                    {
                      text: '删除',
                      style: 'destructive',
                      onPress: () => {
                        try {
                          service.deleteTag(tag.id);
                          void refresh();
                        } catch (error) {
                          Alert.alert(
                            '无法删除',
                            error instanceof Error ? error.message : '这个标签暂时不能删除',
                          );
                        }
                      },
                    },
                  ]);
                }}
              >
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>

      <Modal visible={Boolean(renameId)} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={typography.headline}>重命名标签</Text>
            <Text style={typography.secondary}>{renameTarget?.name}</Text>
            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              style={styles.input}
              autoFocus
            />
            <Text style={typography.secondary}>标签类型</Text>
            <View style={styles.typeRow}>
              {TAG_TYPE_OPTIONS.map((option) => (
                <Pressable key={option.value} onPress={() => setRenameType(option.value)}>
                  <Chip
                    label={option.label}
                    tone={renameType === option.value ? 'success' : 'default'}
                  />
                </Pressable>
              ))}
            </View>
            <PrimaryButton
              label="保存"
              onPress={() => {
                if (renameId && renameValue.trim()) {
                  service.updateTagIdentity(renameId, renameType, renameValue.trim());
                  void refresh();
                }
                setRenameId(null);
              }}
            />
            <View style={{ height: spacing.sm }} />
            <SecondaryButton label="取消" onPress={() => setRenameId(null)} />
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(mergeSourceId)} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={typography.headline}>合并标签</Text>
            <Text style={typography.secondary}>
              将「{mergeSource?.name}」合并到哪个目标？历史账目将统一引用目标标签。
            </Text>
            {tags
              .filter((t) => t.id !== mergeSourceId)
              .map((target) => (
                <Pressable
                  key={target.id}
                  style={styles.mergeOption}
                  onPress={() => {
                    if (!mergeSourceId) return;
                    Alert.alert(
                      '确认合并',
                      `将「${mergeSource?.name}」合并到「${target.name}」？`,
                      [
                        { text: '取消', style: 'cancel' },
                        {
                          text: '确认合并',
                          onPress: () => {
                            service.mergeTags(mergeSourceId, target.id);
                            setMergeSourceId(null);
                            void refresh();
                          },
                        },
                      ],
                    );
                  }}
                >
                  <Text style={typography.body}>{target.name}</Text>
                </Pressable>
              ))}
            <SecondaryButton label="取消" onPress={() => setMergeSourceId(null)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    color: colors.ink,
  },
  createRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  addButtonPressed: { backgroundColor: colors.accentSoft },
  disabled: { opacity: 0.72 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(23,59,54,0.35)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  mergeOption: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
});
