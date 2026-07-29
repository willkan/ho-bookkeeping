/** final-v1 design tokens — celadon white / ink green */
export const colors = {
  background: '#F6FAF8',
  surface: '#FFFFFF',
  ink: '#173B36',
  muted: '#71827E',
  accent: '#239D87',
  accentSoft: '#DDF3EE',
  pending: '#68BCC4',
  confirm: '#C2933C',
  danger: '#D9685F',
  divider: '#DCE7E3',
  white: '#FFFFFF',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const typography = {
  title: { fontSize: 22, fontWeight: '600' as const, color: colors.ink },
  headline: { fontSize: 18, fontWeight: '600' as const, color: colors.ink },
  body: { fontSize: 16, fontWeight: '400' as const, color: colors.ink },
  secondary: { fontSize: 14, fontWeight: '400' as const, color: colors.muted },
  caption: { fontSize: 12, fontWeight: '400' as const, color: colors.muted },
  amount: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: colors.ink,
    fontVariant: ['tabular-nums'] as 'tabular-nums'[],
  },
};
