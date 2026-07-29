import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../../src/application/app-context';
import { Screen } from '../../src/ui/primitives';
import { colors, spacing, typography } from '../../src/ui/tokens';

export default function ModesScreen() {
  const { service, refresh, tick } = useApp();
  const router = useRouter();
  const modes = useMemo(() => {
    void tick;
    return service?.listModes() ?? [];
  }, [service, tick]);

  if (!service) return <Screen />;

  const selectMode = (modeId: string | null) => {
    service.activateMode(modeId);
    void refresh();
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={typography.secondary}>选择一个模式开始记账</Text>
        <Pressable
          onPress={() => router.push('/modes/edit')}
          accessibilityRole="button"
          accessibilityLabel="新建模式"
          style={styles.iconButton}
        >
          <Ionicons name="add" size={25} color={colors.ink} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <Pressable style={styles.row} onPress={() => selectMode(null)}>
          <Ionicons
            name={modes.some((mode) => mode.isActive) ? 'radio-button-off' : 'radio-button-on'}
            size={22}
            color={modes.some((mode) => mode.isActive) ? colors.muted : colors.accent}
          />
          <View style={{ flex: 1 }}>
            <Text style={typography.body}>无模式</Text>
            <Text style={typography.caption}>不使用模式默认标签</Text>
          </View>
        </Pressable>
        {modes.map((mode) => (
          <Pressable key={mode.id} style={styles.row} onPress={() => selectMode(mode.id)}>
            <Ionicons
              name={mode.isActive ? 'radio-button-on' : 'radio-button-off'}
              size={22}
              color={mode.isActive ? colors.accent : colors.muted}
            />
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={typography.body}>{mode.name}</Text>
                {mode.isActive ? <Text style={styles.active}>使用中</Text> : null}
              </View>
              <Text style={typography.caption}>{mode.defaultTagIds.length} 个默认标签</Text>
            </View>
            <Pressable
              onPress={(event) => {
                event.stopPropagation();
                router.push({ pathname: '/modes/edit', params: { id: mode.id } });
              }}
              accessibilityRole="button"
              accessibilityLabel={`编辑${mode.name}`}
              style={styles.iconButton}
            >
              <Ionicons name="pencil-outline" size={20} color={colors.muted} />
            </Pressable>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  active: {
    ...typography.caption,
    color: colors.accent,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
  },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
