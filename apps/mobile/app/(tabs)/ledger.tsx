import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../src/application/app-context';
import { formatYuan } from '../../src/domain/money';
import type { TagMatchMode, TrendGranularity } from '../../src/domain/types';
import { Chip, EmptyState, LoadingBlock, PrimaryButton, Screen } from '../../src/ui/primitives';
import { colors, radius, spacing, typography } from '../../src/ui/tokens';

type AnalysisKind = 'breakdown' | 'trend';
type ScopeKind = 'time' | 'mode';

function monthRange(): { start: string; end: string } {
  const date = new Date();
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const start = `${year}-${`${month}`.padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  return { start, end: `${year}-${`${month}`.padStart(2, '0')}-${lastDay}` };
}

export default function LedgerHomeScreen() {
  const insets = useSafeAreaInsets();
  const { ready, service, refresh, tick } = useApp();
  const router = useRouter();
  const defaults = monthRange();
  const [filterOpen, setFilterOpen] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisKind>('breakdown');
  const [scope, setScope] = useState<ScopeKind>('time');
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [tagMatch, setTagMatch] = useState<TagMatchMode>('and');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [granularity, setGranularity] = useState<TrendGranularity>('day');
  const [modeId, setModeId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const groups = useMemo(() => {
    void tick;
    return service?.listExclusiveGroups() ?? [];
  }, [service, tick]);
  const tags = useMemo(() => {
    void tick;
    return service?.listTags() ?? [];
  }, [service, tick]);
  const modes = useMemo(() => {
    void tick;
    return service?.listModes() ?? [];
  }, [service, tick]);
  const monthRecords = useMemo(() => {
    void tick;
    if (!service) return [];
    return service.filterRecords({
      range: { kind: 'time', startLocalDate: defaults.start, endLocalDate: defaults.end },
      tagIds: [],
      tagMatch: 'and',
    });
  }, [service, tick, defaults.end, defaults.start]);

  if (!ready || !service) {
    return (
      <Screen style={{ paddingTop: insets.top }}>
        <LoadingBlock />
      </Screen>
    );
  }

  const groupId = selectedGroupId ?? groups[0]?.id ?? null;
  const monthTotal = monthRecords.reduce((sum, record) => sum + record.actualCostMinor, 0);
  const recent = monthRecords.slice(0, 5);
  const selectedMode = modes.find((mode) => mode.id === modeId);
  const filterSummary = [
    analysis === 'breakdown' && scope === 'mode' ? (selectedMode?.name ?? '选择模式') : '本月',
    selectedTagIds.length ? `${selectedTagIds.length} 个标签` : '全部标签',
  ].join(' · ');

  const openFilters = (kind: AnalysisKind) => {
    setAnalysis(kind);
    if (kind === 'trend') setScope('time');
    setFilterOpen(true);
  };

  const viewResult = () => {
    const tagIds = selectedTagIds.join(',');
    if (analysis === 'trend') {
      setFilterOpen(false);
      router.push({
        pathname: '/stats/trend',
        params: { start, end, granularity, tagIds, tagMatch },
      });
      return;
    }
    if (!groupId || (scope === 'mode' && !modeId)) return;
    setFilterOpen(false);
    router.push({
      pathname: '/stats/breakdown',
      params:
        scope === 'mode'
          ? { groupId, tagIds, tagMatch, modeId: modeId! }
          : { start, end, groupId, tagIds, tagMatch },
    });
  };

  const confirmDeleteRecord = (recordId: string) => {
    Alert.alert('删除这条记录？', '删除后将不再计入账本和统计。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除记录',
        style: 'destructive',
        onPress: () => {
          service.softDeleteConsumption(recordId);
          void refresh();
        },
      },
    ]);
  };

  return (
    <Screen style={{ paddingTop: insets.top + spacing.sm }}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <Text style={typography.title}>看账本</Text>
        <View style={styles.overview}>
          <Text style={typography.secondary}>本月消费</Text>
          <Text style={styles.total}>¥{formatYuan(monthTotal)}</Text>
          <Text style={typography.caption}>{monthRecords.length} 条记录</Text>
        </View>

        <View style={styles.analysisRow}>
          <Pressable style={styles.analysisButton} onPress={() => openFilters('breakdown')}>
            <Ionicons name="pie-chart-outline" size={22} color={colors.accent} />
            <Text style={styles.analysisLabel}>消费占比</Text>
          </Pressable>
          <Pressable style={styles.analysisButton} onPress={() => openFilters('trend')}>
            <Ionicons name="bar-chart-outline" size={22} color={colors.accent} />
            <Text style={styles.analysisLabel}>消费趋势</Text>
          </Pressable>
        </View>

        <Pressable style={styles.filterSummary} onPress={() => openFilters('breakdown')}>
          <Text style={[typography.body, { flex: 1 }]}>{filterSummary}</Text>
          <Ionicons name="options-outline" size={21} color={colors.ink} />
        </Pressable>

        <Text style={styles.sectionTitle}>近期消费</Text>
        {recent.length === 0 ? (
          <EmptyState title="这个月还没有消费" detail="记下一笔后会出现在这里" />
        ) : (
          recent.map((record) => (
            <View key={record.id} style={styles.recordRow}>
              <Pressable
                style={styles.recordMain}
                onPress={() => router.push(`/record/${record.id}`)}
                onLongPress={() => confirmDeleteRecord(record.id)}
                delayLongPress={450}
                accessibilityLabel={`记录 ${record.merchant || record.note || '消费'}`}
                accessibilityHint="轻点查看详情，长按删除"
                accessibilityActions={[{ name: 'delete', label: '删除记录' }]}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === 'delete') confirmDeleteRecord(record.id);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={typography.body}>{record.merchant || record.note || '消费'}</Text>
                  <Text style={typography.caption}>{record.localDate}</Text>
                </View>
                <Text style={typography.amount}>¥{formatYuan(record.actualCostMinor)}</Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={filterOpen} animationType="slide" presentationStyle="pageSheet">
        <Screen style={{ paddingTop: insets.top + spacing.sm }}>
          <View style={styles.modalHeader}>
            <Text style={typography.headline}>筛选</Text>
            <Pressable
              onPress={() => setFilterOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="关闭筛选"
              hitSlop={12}
            >
              <Ionicons name="close" size={25} color={colors.ink} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.filterPage}>
            <Text style={styles.sectionTitle}>想看什么</Text>
            <View style={styles.segment}>
              <Segment
                label="消费占比"
                selected={analysis === 'breakdown'}
                onPress={() => setAnalysis('breakdown')}
              />
              <Segment
                label="消费趋势"
                selected={analysis === 'trend'}
                onPress={() => {
                  setAnalysis('trend');
                  setScope('time');
                }}
              />
            </View>

            {analysis === 'breakdown' ? (
              <>
                <Text style={styles.sectionTitle}>范围</Text>
                <View style={styles.segment}>
                  <Segment
                    label="按时间"
                    selected={scope === 'time'}
                    onPress={() => setScope('time')}
                  />
                  <Segment
                    label="按模式"
                    selected={scope === 'mode'}
                    onPress={() => setScope('mode')}
                  />
                </View>
              </>
            ) : null}

            {scope === 'time' ? (
              <>
                <Text style={styles.sectionTitle}>时间</Text>
                <View style={styles.dateRow}>
                  <TextInput value={start} onChangeText={setStart} style={styles.input} />
                  <Text style={typography.secondary}>至</Text>
                  <TextInput value={end} onChangeText={setEnd} style={styles.input} />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.sectionTitle}>模式</Text>
                {modes.length === 0 ? (
                  <Pressable style={styles.emptyMode} onPress={() => router.push('/modes/edit')}>
                    <Text style={typography.body}>还没有模式</Text>
                    <Text style={styles.link}>新建模式</Text>
                  </Pressable>
                ) : (
                  modes.map((mode) => (
                    <Pressable
                      key={mode.id}
                      style={styles.choiceRow}
                      onPress={() => setModeId(mode.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: modeId === mode.id }}
                    >
                      <Ionicons
                        name={modeId === mode.id ? 'radio-button-on' : 'radio-button-off'}
                        size={22}
                        color={modeId === mode.id ? colors.accent : colors.muted}
                      />
                      <Text style={typography.body}>{mode.name}</Text>
                    </Pressable>
                  ))
                )}
                <Text style={typography.caption}>默认查看这个模式的全部时间</Text>
              </>
            )}

            {analysis === 'breakdown' ? (
              <>
                <Text style={styles.sectionTitle}>按什么分类</Text>
                <View style={styles.wrap}>
                  {groups.map((group) => (
                    <Pressable key={group.id} onPress={() => setSelectedGroupId(group.id)}>
                      <Chip
                        label={group.name}
                        tone={groupId === group.id ? 'success' : 'default'}
                      />
                    </Pressable>
                  ))}
                </View>
              </>
            ) : (
              <>
                <Text style={styles.sectionTitle}>按天、周或月</Text>
                <View style={styles.segment}>
                  {(['day', 'week', 'month'] as const).map((item) => (
                    <Segment
                      key={item}
                      label={item === 'day' ? '日' : item === 'week' ? '周' : '月'}
                      selected={granularity === item}
                      onPress={() => setGranularity(item)}
                    />
                  ))}
                </View>
              </>
            )}

            <Text style={styles.sectionTitle}>标签（可选）</Text>
            <View style={styles.segment}>
              <Segment
                label="同时符合"
                selected={tagMatch === 'and'}
                onPress={() => setTagMatch('and')}
              />
              <Segment
                label="符合任一"
                selected={tagMatch === 'or'}
                onPress={() => setTagMatch('or')}
              />
            </View>
            <View style={[styles.wrap, styles.tagWrap]}>
              {tags.map((tag) => {
                const selected = selectedTagIds.includes(tag.id);
                return (
                  <Pressable
                    key={tag.id}
                    onPress={() =>
                      setSelectedTagIds((previous) =>
                        selected ? previous.filter((id) => id !== tag.id) : [...previous, tag.id],
                      )
                    }
                    accessibilityState={{ selected }}
                  >
                    <Chip label={tag.name} tone={selected ? 'success' : 'default'} />
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
          <View style={styles.footer}>
            <Pressable
              onPress={() => {
                setSelectedTagIds([]);
                setModeId(null);
                setScope('time');
              }}
            >
              <Text style={styles.link}>清除</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                label="查看结果"
                disabled={analysis === 'breakdown' && (!groupId || (scope === 'mode' && !modeId))}
                onPress={viewResult}
              />
            </View>
          </View>
        </Screen>
      </Modal>
    </Screen>
  );
}

function Segment({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.segmentItem, selected && styles.segmentItemSelected]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
    >
      <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { paddingBottom: spacing.xxl },
  overview: { paddingVertical: spacing.xl },
  total: { fontSize: 34, fontWeight: '700', color: colors.accent, marginVertical: spacing.xs },
  analysisRow: { flexDirection: 'row', gap: spacing.sm },
  analysisButton: {
    flex: 1,
    minHeight: 76,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  analysisLabel: { ...typography.body, fontWeight: '600' },
  filterSummary: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: { ...typography.secondary, marginTop: spacing.lg, marginBottom: spacing.sm },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  recordMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filterPage: { paddingBottom: 110 },
  segment: { flexDirection: 'row', gap: spacing.sm },
  segmentItem: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  segmentItemSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  segmentText: { ...typography.secondary, color: colors.ink },
  segmentTextSelected: { color: colors.white, fontWeight: '600' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.md,
    color: colors.ink,
  },
  choiceRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  emptyMode: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tagWrap: { marginTop: spacing.md },
  link: { color: colors.accent, fontWeight: '600' },
  footer: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
  },
});
