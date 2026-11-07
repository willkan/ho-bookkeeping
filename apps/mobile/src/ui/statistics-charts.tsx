import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { formatYuan } from '../domain/money';
import type { BreakdownBucket, TrendBucket, TrendGranularity } from '../domain/types';
import { colors, spacing, typography } from './tokens';

export const BREAKDOWN_COLORS = [
  '#239D87',
  '#68BCC4',
  '#C2933C',
  '#6F9F73',
  '#D9826B',
  '#6C87B8',
  '#A77BB5',
  '#72A6A1',
  '#C8A85A',
  '#4E8E77',
  '#B77979',
  '#718FB0',
  '#8B9D65',
  '#B58A62',
  '#8B829E',
] as const;

function pointOnCircle(angle: number, radius: number, center: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: center + radius * Math.cos(radians),
    y: center + radius * Math.sin(radians),
  };
}

function sectorPath(startAngle: number, endAngle: number, radius: number, center: number): string {
  const start = pointOnCircle(startAngle, radius, center);
  const end = pointOnCircle(endAngle, radius, center);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${center} ${center} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

export function ConsumptionPieChart({
  buckets,
  onBucketPress,
}: {
  buckets: readonly BreakdownBucket[];
  onBucketPress?: (bucket: BreakdownBucket) => void;
}) {
  const size = 220;
  const center = size / 2;
  const radius = center - 4;
  let angle = 0;
  const nonZeroBuckets = buckets.filter((bucket) => bucket.share > 0);

  return (
    <View
      style={styles.pieWrap}
      accessible={!onBucketPress}
      accessibilityRole={onBucketPress ? undefined : 'image'}
      accessibilityLabel={nonZeroBuckets
        .map((bucket) => `${bucket.label} ${(bucket.share * 100).toFixed(1)}%`)
        .join('，')}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {nonZeroBuckets.length === 0 ? (
          <Circle cx={center} cy={center} r={radius} fill={colors.divider} />
        ) : (
          nonZeroBuckets.map((bucket) => {
            const startAngle = angle;
            angle += bucket.share * 360;
            const color = BREAKDOWN_COLORS[buckets.indexOf(bucket) % BREAKDOWN_COLORS.length];
            const accessibilityLabel = `${bucket.label}，¥${formatYuan(bucket.amountMinor)}，${(bucket.share * 100).toFixed(1)}%，轻点查看记录`;
            return bucket.share >= 0.99999 ? (
              <Circle
                key={bucket.key}
                cx={center}
                cy={center}
                r={radius}
                fill={color}
                accessible
                accessibilityLabel={accessibilityLabel}
                onPress={() => onBucketPress?.(bucket)}
              />
            ) : (
              <Path
                key={bucket.key}
                d={sectorPath(startAngle, angle, radius, center)}
                fill={color}
                stroke={colors.background}
                strokeWidth={2}
                accessible
                accessibilityLabel={accessibilityLabel}
                onPress={() => onBucketPress?.(bucket)}
              />
            );
          })
        )}
      </Svg>
    </View>
  );
}

function shortBucketLabel(label: string, granularity: TrendGranularity): string {
  if (granularity === 'month') return label.replace('-', '/');
  const [, month, day] = label.split('-');
  const shortDate = `${Number(month)}/${Number(day)}`;
  return granularity === 'week' ? `${shortDate}周` : shortDate;
}

export function TrendBarChart({
  buckets,
  granularity,
  onBucketPress,
}: {
  buckets: readonly TrendBucket[];
  granularity: TrendGranularity;
  onBucketPress?: (bucket: TrendBucket) => void;
}) {
  const largest = buckets.reduce((value, bucket) => Math.max(value, bucket.amountMinor), 0);
  const max = Math.max(200, Math.ceil(largest / 200) * 200);
  const ticks = [max, Math.floor(max / 2), 0];

  return (
    <View style={styles.trendChart}>
      <Text style={typography.caption}>金额（元）</Text>
      <View style={styles.plotRow}>
        <View style={styles.axis} accessible={false}>
          {ticks.map((amount, index) => (
            <Text
              key={index}
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[styles.axisLabel, { top: 28 + index * 96 - 8 }]}
            >
              {formatYuan(amount)}
            </Text>
          ))}
        </View>
        <View style={styles.plot}>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {ticks.map((_, index) => (
              <View key={index} style={[styles.gridLine, { top: 28 + index * 96 }]} />
            ))}
          </View>
          <ScrollView
            horizontal
            style={styles.trendScroll}
            showsHorizontalScrollIndicator
            contentContainerStyle={styles.trendContent}
            accessibilityLabel="消费趋势，可横向滚动查看全部时间"
          >
            {buckets.map((bucket) => {
              const isZero = bucket.amountMinor === 0;
              const height = (bucket.amountMinor / max) * 192;
              return (
                <Pressable
                  key={bucket.key}
                  style={({ pressed }) => [styles.trendColumn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`${bucket.label}，¥${formatYuan(bucket.amountMinor)}，轻点查看记录`}
                  onPress={() => onBucketPress?.(bucket)}
                >
                  <View style={styles.barArea}>
                    <Text numberOfLines={1} adjustsFontSizeToFit style={styles.trendValue}>
                      {isZero ? '0' : formatYuan(bucket.amountMinor)}
                    </Text>
                    <View
                      style={[
                        styles.trendBar,
                        isZero && styles.zeroBar,
                        { height: isZero ? 2 : height },
                      ]}
                    />
                  </View>
                  <Text numberOfLines={1} style={styles.trendLabel}>
                    {shortBucketLabel(bucket.label, granularity)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pieWrap: {
    alignItems: 'center',
    marginVertical: spacing.xl,
  },
  trendChart: { marginTop: spacing.xl, gap: spacing.sm },
  plotRow: { flexDirection: 'row', height: 264 },
  axis: { width: 58 },
  axisLabel: {
    ...typography.caption,
    position: 'absolute',
    width: 52,
    textAlign: 'right',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  plot: { flex: 1 },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
  },
  trendScroll: { flexGrow: 0, height: 264 },
  trendContent: { paddingHorizontal: spacing.xs },
  trendColumn: { width: 76, alignItems: 'center' },
  pressed: { opacity: 0.6 },
  trendValue: {
    ...typography.caption,
    width: 72,
    paddingBottom: 6,
    fontSize: 11,
    textAlign: 'center',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  barArea: { height: 220, justifyContent: 'flex-end', alignItems: 'center' },
  trendBar: {
    width: 24,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    backgroundColor: colors.accent,
  },
  zeroBar: { backgroundColor: colors.muted, borderRadius: 2 },
  trendLabel: { ...typography.caption, width: 76, marginTop: spacing.md, textAlign: 'center' },
});
