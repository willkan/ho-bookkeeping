import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from './tokens';

/** Calendar dates stay as YYYY-MM-DD strings; no instant/timezone conversion. */
export function DateRangePicker({
  start,
  end,
  onStartChange,
  onEndChange,
}: {
  start: string;
  end: string;
  onStartChange: (date: string) => void;
  onEndChange: (date: string) => void;
}) {
  const [active, setActive] = useState<'start' | 'end' | null>(null);
  return (
    <View style={styles.container}>
      <View style={styles.fields}>
        {(['start', 'end'] as const).map((field) => (
          <Pressable
            key={field}
            accessibilityRole="button"
            accessibilityLabel={`${field === 'start' ? '开始日期' : '结束日期'} ${field === 'start' ? start : end}`}
            accessibilityState={{ expanded: active === field }}
            onPress={() => setActive(active === field ? null : field)}
            style={[styles.field, active === field && styles.activeField]}
          >
            <Text style={typography.caption}>{field === 'start' ? '开始日期' : '结束日期'}</Text>
            <View style={styles.fieldValue}>
              <Text style={styles.date}>{field === 'start' ? start : end}</Text>
              <Ionicons name="calendar-outline" size={18} color={colors.accent} />
            </View>
          </Pressable>
        ))}
      </View>
      {active ? (
        <Calendar
          key={active}
          value={active === 'start' ? start : end}
          onSelect={(date) => {
            if (active === 'start') onStartChange(date);
            else onEndChange(date);
            setActive(null);
          }}
        />
      ) : null}
      {start > end ? (
        <Text accessibilityRole="alert" style={styles.error}>
          结束日期不能早于开始日期
        </Text>
      ) : null}
    </View>
  );
}

function Calendar({ value, onSelect }: { value: string; onSelect: (date: string) => void }) {
  const [month, setMonth] = useState(() => value.slice(0, 7));
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const first = new Date(year, monthNumber - 1, 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const dayCount = new Date(year, monthNumber, 0, 12).getDate();
  const cells = Math.ceil((offset + dayCount) / 7) * 7;
  const move = (delta: number) => {
    const next = new Date(year, monthNumber - 1 + delta, 1, 12);
    setMonth(
      `${next.getFullYear().toString().padStart(4, '0')}-${String(next.getMonth() + 1).padStart(2, '0')}`,
    );
  };
  return (
    <View style={styles.calendar}>
      <View style={styles.monthHeader}>
        {([-12, -1] as const).map((delta) => (
          <Pressable
            key={delta}
            style={styles.nav}
            accessibilityRole="button"
            accessibilityLabel={delta === -12 ? '上一年' : '上个月'}
            onPress={() => move(delta)}
          >
            <Ionicons
              name={delta === -12 ? 'play-back-outline' : 'chevron-back'}
              size={19}
              color={colors.ink}
            />
          </Pressable>
        ))}
        <Text accessibilityLiveRegion="polite" style={styles.month}>
          {year} 年 {monthNumber} 月
        </Text>
        {([1, 12] as const).map((delta) => (
          <Pressable
            key={delta}
            style={styles.nav}
            accessibilityRole="button"
            accessibilityLabel={delta === 12 ? '下一年' : '下个月'}
            onPress={() => move(delta)}
          >
            <Ionicons
              name={delta === 12 ? 'play-forward-outline' : 'chevron-forward'}
              size={19}
              color={colors.ink}
            />
          </Pressable>
        ))}
      </View>
      <View style={styles.grid}>
        {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
          <View key={day} style={styles.weekday}>
            <Text style={typography.caption}>{day}</Text>
          </View>
        ))}
        {Array.from({ length: cells }, (_, index) => {
          const day = index - offset + 1;
          if (day < 1 || day > dayCount) return <View key={index} style={styles.cell} />;
          const date = `${month}-${String(day).padStart(2, '0')}`;
          const selected = date === value;
          return (
            <Pressable
              key={index}
              accessibilityRole="button"
              accessibilityLabel={`${year}年${monthNumber}月${day}日`}
              accessibilityState={{ selected }}
              onPress={() => onSelect(date)}
              style={styles.cell}
            >
              <View style={[styles.day, selected && styles.selectedDay]}>
                <Text style={[typography.body, selected && styles.selectedText]}>{day}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  fields: { flexDirection: 'row', gap: spacing.sm },
  field: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  activeField: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  fieldValue: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  date: { ...typography.body, fontSize: 14, fontVariant: ['tabular-nums'], flexShrink: 1 },
  calendar: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm },
  monthHeader: { flexDirection: 'row', alignItems: 'center' },
  nav: { width: 40, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  month: { ...typography.body, flex: 1, textAlign: 'center', fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: { width: '14.285714%', alignItems: 'center', paddingVertical: spacing.sm },
  cell: { width: '14.285714%', minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  day: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedDay: { backgroundColor: colors.accent },
  selectedText: { color: colors.white, fontWeight: '600' },
  error: { ...typography.caption, color: colors.danger },
});
