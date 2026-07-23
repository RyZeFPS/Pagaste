import { Platform, type ViewStyle } from 'react-native';

const lightColors = {
  background: '#F5F7FB',
  surface: '#FFFFFF',

  primary: '#1769E8',
  primaryDark: '#0F56C9',
  primaryLight: '#EAF2FF',

  success: '#17B45B',
  successLight: '#E9F9F0',
  successInk: '#067647',

  warning: '#FF7A1A',
  warningLight: '#FFF2E8',
  warningInk: '#B54708',

  danger: '#E5484D',
  dangerLight: '#FDEDEE',
  dangerInk: '#B42318',

  textPrimary: '#111827',
  textSecondary: '#667085',
  textMuted: '#98A2B3',

  border: '#E7EAF0',
  divider: '#EEF0F4',
  disabled: '#C9CED8',
  overlay: 'rgba(17, 24, 39, 0.45)',
  focusRing: 'rgba(23, 105, 232, 0.18)',
  white: '#FFFFFF',

  // Backwards-compatible aliases while screens migrate to the semantic names above.
  text: '#111827',
  primarySoft: '#EAF2FF',
  successSoft: '#E9F9F0',
  warningSoft: '#FFF2E8',
  dangerSoft: '#FDEDEE',
  muted: '#EEF0F4',
} as const;

export const colors = {
  light: lightColors,
  // The supplied visual direction is light-only. Keep this key for API compatibility,
  // but do not silently switch to an unrelated dark palette.
  dark: lightColors,
} as const;

export type AppColors = {
  [Key in keyof (typeof colors)['light']]: string;
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  section: 48,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  control: 14,
  lg: 16,
  card: 20,
  xl: 24,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' as const },
  screenTitle: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  navTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700' as const },
  metric: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' as const },
  bodySmall: { fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' as const },
  button: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: '500' as const },

  // Existing names remain available to avoid a flag-day migration across screens.
  hero: { fontSize: 32, lineHeight: 38, fontWeight: '700' as const },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '700' as const },
} as const;

export const motion = { fast: 120, normal: 220, slow: 360 } as const;
export const touchTarget = 44;

export const layout = {
  screenGutter: 20,
  mobileMaxWidth: 500,
  appMaxWidth: 500,
  formMaxWidth: 560,
  publicMaxWidth: 500,
  tabletMaxWidth: 720,
  tabBarHeight: 76,
} as const;

export const shadows: Record<'card' | 'floating' | 'tabBar', ViewStyle> = {
  card: Platform.select({
    web: { boxShadow: '0 4px 16px rgba(17, 24, 39, 0.06)' },
    default: {
      shadowColor: '#111827',
      shadowOpacity: 0.06,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
  }) as ViewStyle,
  floating: Platform.select({
    web: { boxShadow: '0 12px 32px rgba(17, 24, 39, 0.12)' },
    default: {
      shadowColor: '#111827',
      shadowOpacity: 0.12,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: 6,
    },
  }) as ViewStyle,
  tabBar: Platform.select({
    web: { boxShadow: '0 -4px 20px rgba(17, 24, 39, 0.06)' },
    default: {
      shadowColor: '#111827',
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: -4 },
      elevation: 4,
    },
  }) as ViewStyle,
};
