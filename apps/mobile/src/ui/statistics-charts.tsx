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
  const max = Math.max(1, ...buckets.map((bucket) => bucket.amountMinor));

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      contentContainerStyle={styles.trendContent}
      accessibilityLabel="消费趋势，可横向滚动查看全部时间"
    >
      {buckets.map((bucket) => {
        const isZero = bucket.amountMinor === 0;
        const height = isZero ? 3 : Math.max(8, Math.round((bucket.amountMinor / max) * 112));
        return (
          <Pressable
            key={bucket.key}
            style={styles.trendColumn}
            accessibilityRole="button"
            accessibilityLabel={`${shortBucketLabel(bucket.label, granularity)}，¥${formatYuan(bucket.amountMinor)}，轻点查看记录`}
            onPress={() => onBucketPress?.(bucket)}
          >
            <Text numberOfLines={1} style={styles.trendValue}>
              {isZero ? '' : `¥${formatYuan(bucket.amountMinor)}`}
            </Text>
            <View style={styles.barArea}>
              <View style={[styles.trendBar, isZero && styles.zeroBar, { height }]} />
            </View>
            <Text numberOfLines={1} style={styles.trendLabel}>
              {shortBucketLabel(bucket.label, granularity)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pieWrap: {
    alignItems: 'center',
    marginVertical: spacing.xl,
  },
  trendContent: {
    minWidth: '100%',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xs,
    alignItems: 'flex-end',
  },
  trendColumn: {
    width: 58,
    alignItems: 'center',
  },
  trendValue: {
    ...typography.caption,
    width: 58,
    height: 18,
    fontSize: 10,
    textAlign: 'center',
    color: colors.ink,
  },
  barArea: {
    height: 116,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  trendBar: {
    width: 28,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    backgroundColor: colors.accent,
  },
  zeroBar: {
    backgroundColor: colors.divider,
    borderRadius: 2,
  },
  trendLabel: {
    ...typography.caption,
    width: 58,
    marginTop: spacing.sm,
    textAlign: 'center',
    fontSize: 11,
  },
});
