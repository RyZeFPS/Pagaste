import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type DimensionValue,
  type PressableProps,
  type ScrollViewProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
  type ViewProps,
} from 'react-native';
import { Image } from 'expo-image';
import { usePathname } from 'expo-router';
import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppColors } from '@/providers/theme-context';
import { layout, radii, shadows, spacing, touchTarget, typography } from '@/theme';
import { formatCentsExact } from '@/lib/money-format';
import { useProfileAvatarUrl } from '@/lib/profile-avatar-url';

export function AppText({
  variant = 'body',
  color,
  tone,
  tabular,
  style,
  ...props
}: TextProps & {
  variant?: keyof typeof typography;
  color?: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'secondary' | 'muted';
  tabular?: boolean;
}) {
  const palette = useAppColors();
  const toneColor =
    tone === 'primary'
      ? palette.primary
      : tone === 'success'
        ? palette.successInk
        : tone === 'warning'
          ? palette.warningInk
          : tone === 'danger'
            ? palette.dangerInk
            : tone === 'secondary'
              ? palette.textSecondary
              : tone === 'muted'
                ? palette.textMuted
                : undefined;
  return (
    <Text
      {...props}
      style={[
        typography[variant],
        { color: color ?? toneColor ?? palette.textPrimary },
        tabular && styles.tabular,
        style,
      ]}
    />
  );
}

export type ButtonVariant =
  'primary' | 'success' | 'surfacePrimary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';
export function AppButton({
  title,
  loading,
  variant = 'primary',
  size = 'md',
  fullWidth,
  leftIcon,
  style,
  disabled,
  ...props
}: Omit<PressableProps, 'children'> & {
  title: string;
  loading?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
}) {
  const palette = useAppColors();
  const solid = variant === 'primary' || variant === 'success' || variant === 'danger';
  const background =
    variant === 'primary'
      ? palette.primary
      : variant === 'success'
        ? palette.success
        : variant === 'danger'
          ? palette.danger
          : variant === 'surfacePrimary' || variant === 'secondary'
            ? palette.surface
            : 'transparent';
  const border =
    variant === 'surfacePrimary'
      ? palette.surface
      : variant === 'outline'
        ? palette.primary
        : variant === 'secondary'
          ? palette.border
          : background;
  const foreground = solid
    ? palette.white
    : variant === 'ghost' || variant === 'outline' || variant === 'surfacePrimary'
      ? palette.primary
      : palette.textPrimary;
  const pressedBackground =
    variant === 'primary'
      ? palette.primaryDark
      : variant === 'success'
        ? palette.successInk
        : variant === 'danger'
          ? palette.dangerInk
          : variant === 'surfacePrimary' || variant === 'outline' || variant === 'ghost'
            ? palette.primaryLight
            : palette.divider;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      {...props}
      style={(state) => [
        styles.button,
        size === 'sm' ? styles.buttonSm : size === 'lg' ? styles.buttonLg : styles.buttonMd,
        fullWidth && styles.fullWidth,
        {
          backgroundColor: inactive && solid ? palette.disabled : background,
          borderColor: inactive && solid ? palette.disabled : border,
        },
        state.pressed && !inactive && { backgroundColor: pressedBackground },
        state.pressed && !inactive && styles.pressed,
        inactive && !solid && styles.disabled,
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      {loading ? <ActivityIndicator color={foreground} /> : leftIcon}
      <AppText variant="button" color={foreground}>
        {title}
      </AppText>
    </Pressable>
  );
}

export function IconButton({
  label,
  icon,
  variant = 'outline',
  size = touchTarget,
  style,
  ...props
}: Omit<PressableProps, 'children'> & {
  label: string;
  icon: ReactNode;
  variant?: 'outline' | 'plain' | 'soft';
  size?: number;
}) {
  const palette = useAppColors();
  const backgroundColor =
    variant === 'soft'
      ? palette.primaryLight
      : variant === 'plain'
        ? 'transparent'
        : palette.surface;
  const borderColor = variant === 'outline' ? palette.border : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...props}
      style={(state) => [
        styles.iconButton,
        { width: size, height: size, borderColor, backgroundColor },
        state.pressed && { backgroundColor: palette.primaryLight },
        state.pressed && styles.pressed,
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      {icon}
    </Pressable>
  );
}

export const AppInput = forwardRef<
  TextInput,
  TextInputProps & { label: string; error?: string; hint?: string }
>(function AppInput({ label, error, hint, style, ...props }, ref) {
  const palette = useAppColors();
  const [focused, setFocused] = useState(false);
  const labelId = props.testID ? `${props.testID}-label` : undefined;
  const errorId = props.testID ? `${props.testID}-error` : undefined;
  const editable = props.editable !== false;
  return (
    <View style={styles.field}>
      <AppText nativeID={labelId} variant="label">
        {label}
      </AppText>
      <TextInput
        ref={ref}
        accessibilityLabel={props.accessibilityLabel ?? label}
        accessibilityHint={error ?? hint}
        aria-labelledby={labelId}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        placeholderTextColor={palette.textMuted}
        {...props}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        style={[
          styles.input,
          {
            color: editable ? palette.textPrimary : palette.textMuted,
            backgroundColor: editable ? palette.surface : palette.divider,
            borderColor: error ? palette.danger : focused ? palette.primary : palette.border,
          },
          focused && styles.inputFocused,
          style,
        ]}
      />
      {error ? (
        <AppText
          nativeID={errorId}
          accessibilityLiveRegion="polite"
          variant="caption"
          color={palette.dangerInk}
        >
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" color={palette.textSecondary}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
});

function editableMoney(cents: number) {
  if (!cents) return '';
  const sign = cents < 0 ? '-' : '';
  const absolute = BigInt(cents < 0 ? -cents : cents);
  return `${sign}${absolute / 100n},${String(absolute % 100n).padStart(2, '0')}`;
}

function parseMoneyInput(text: string, allowNegative: boolean): number | null {
  const normalized = text.trim().replace(/\s/g, '').replace(',', '.');
  const match = (allowNegative ? /^(-)?(\d*)(?:\.(\d{0,2}))?$/ : /^(\d*)(?:\.(\d{0,2}))?$/).exec(
    normalized,
  );
  if (!match) return null;
  const negative = allowNegative && match[1] === '-';
  const wholeIndex = allowNegative ? 2 : 1;
  const fractionIndex = allowNegative ? 3 : 2;
  const whole = match[wholeIndex] || '0';
  const fraction = (match[fractionIndex] || '').padEnd(2, '0');
  const amount = BigInt(whole) * 100n + BigInt(fraction || '0');
  const signed = negative ? -amount : amount;
  return signed <= BigInt(Number.MAX_SAFE_INTEGER) && signed >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(signed)
    : null;
}

export function MoneyInput({
  valueCents,
  onChangeCents,
  currency = 'EUR',
  allowNegative = false,
  ...props
}: Omit<TextInputProps, 'value' | 'onChangeText' | 'keyboardType'> & {
  label: string;
  hint?: string;
  error?: string;
  valueCents: number;
  onChangeCents: (value: number) => void;
  currency?: string;
  allowNegative?: boolean;
}) {
  const [draft, setDraft] = useState(() => editableMoney(valueCents));
  const [focused, setFocused] = useState(false);
  return (
    <AppInput
      {...props}
      keyboardType={allowNegative ? 'numbers-and-punctuation' : 'decimal-pad'}
      value={focused ? draft : editableMoney(valueCents)}
      onFocus={(event) => {
        setDraft(editableMoney(valueCents));
        setFocused(true);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        setDraft(editableMoney(valueCents));
        props.onBlur?.(event);
      }}
      onChangeText={(text) => {
        const parsed = parseMoneyInput(text, allowNegative);
        if (parsed === null) return;
        setDraft(text);
        onChangeCents(parsed);
      }}
      hint={props.hint ?? currency}
    />
  );
}

export type CardVariant = 'elevated' | 'outlined' | 'flat' | 'grouped';
export type CardPadding = 'none' | 'compact' | 'default' | 'spacious';
export function Card({
  style,
  variant = 'elevated',
  padding = variant === 'grouped' ? 'none' : 'default',
  ...props
}: ViewProps & { variant?: CardVariant; padding?: CardPadding }) {
  const palette = useAppColors();
  const variantStyle: ViewStyle =
    variant === 'outlined'
      ? { borderColor: palette.border }
      : variant === 'flat'
        ? { borderColor: 'transparent' }
        : { borderColor: 'transparent', ...shadows.card };
  return (
    <View
      {...props}
      style={[
        styles.card,
        variantStyle,
        padding === 'none'
          ? styles.cardPaddingNone
          : padding === 'compact'
            ? styles.cardPaddingCompact
            : padding === 'spacious'
              ? styles.cardPaddingSpacious
              : styles.cardPaddingDefault,
        { backgroundColor: palette.surface },
        style,
      ]}
    />
  );
}

const statusColors: Record<string, 'success' | 'warning' | 'danger' | 'primary'> = {
  received: 'success',
  settled: 'success',
  pending: 'warning',
  draft: 'warning',
  reminder_sent: 'primary',
  disputed: 'danger',
  cancelled: 'danger',
  failed: 'danger',
};
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const palette = useAppColors();
  const tone = statusColors[status] ?? 'warning';
  const color =
    tone === 'success'
      ? palette.successInk
      : tone === 'warning'
        ? palette.warningInk
        : tone === 'danger'
          ? palette.dangerInk
          : palette.primary;
  const soft =
    tone === 'primary'
      ? palette.primaryLight
      : tone === 'success'
        ? palette.successLight
        : tone === 'warning'
          ? palette.warningLight
          : palette.dangerLight;
  return (
    <View style={[styles.badge, { backgroundColor: soft }]}>
      <AppText variant="caption" color={color}>
        {label ?? status}
      </AppText>
    </View>
  );
}

export function StatusLabel({
  status,
  label,
  icon,
}: {
  status: string;
  label?: string;
  icon?: ReactNode;
}) {
  const palette = useAppColors();
  const tone = statusColors[status] ?? 'warning';
  const color =
    tone === 'success'
      ? palette.successInk
      : tone === 'warning'
        ? palette.warningInk
        : tone === 'danger'
          ? palette.dangerInk
          : palette.primary;
  return (
    <View style={styles.statusLabel}>
      {icon ?? <View style={[styles.statusDot, { backgroundColor: color }]} />}
      <AppText variant="label" color={color}>
        {label ?? status}
      </AppText>
    </View>
  );
}

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}
export function Avatar({
  name,
  uri,
  size = 40,
}: {
  name: string;
  uri?: string | null;
  size?: number;
}) {
  const palette = useAppColors();
  const resolvedUri = useProfileAvatarUrl(uri);
  return (
    <View
      accessibilityLabel={name}
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: palette.primarySoft },
      ]}
    >
      {resolvedUri ? (
        <Image
          source={{ uri: resolvedUri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          contentFit="cover"
        />
      ) : (
        <AppText variant="label" color={palette.primary}>
          {initials(name)}
        </AppText>
      )}
    </View>
  );
}
export function AvatarGroup({
  people,
  max = 4,
}: {
  people: { name: string; uri?: string | null }[];
  max?: number;
}) {
  const palette = useAppColors();
  return (
    <View style={styles.avatarGroup}>
      {people.slice(0, max).map((person, index) => (
        <View
          key={`${person.name}-${index}`}
          style={[
            styles.avatarGroupItem,
            { borderColor: palette.surface, zIndex: max - index },
            index ? styles.avatarOverlap : undefined,
          ]}
        >
          <Avatar {...person} size={32} />
        </View>
      ))}
      {people.length > max ? (
        <View
          style={[
            styles.avatarOverflow,
            styles.avatarOverlap,
            { backgroundColor: palette.divider, borderColor: palette.surface },
          ]}
        >
          <AppText variant="caption" color={palette.textSecondary}>
            +{people.length - max}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const palette = useAppColors();
  const normalized = Math.min(1, Math.max(0, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(normalized * 100) }}
      style={[styles.progress, { backgroundColor: palette.divider }]}
    >
      <View
        style={[
          styles.progressFill,
          { backgroundColor: color ?? palette.success, width: `${normalized * 100}%` },
        ]}
      />
    </View>
  );
}

export function SegmentedProgress({
  segments,
}: {
  segments: { value: number; color: string; label: string }[];
}) {
  const palette = useAppColors();
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={segments
        .map((segment) => `${segment.label}: ${segment.value}`)
        .join(', ')}
      style={[styles.progress, styles.segmented, { backgroundColor: palette.divider }]}
    >
      {segments
        .filter((segment) => segment.value > 0)
        .map((segment) => (
          <View
            key={segment.label}
            style={{
              height: '100%',
              width: `${total ? (segment.value / total) * 100 : 0}%`,
              backgroundColor: segment.color,
            }}
          />
        ))}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  const palette = useAppColors();
  return (
    <View style={styles.state}>
      <AppText variant="heading" style={styles.center}>
        {title}
      </AppText>
      {body ? (
        <AppText color={palette.textSecondary} style={styles.center}>
          {body}
        </AppText>
      ) : null}
      {action}
    </View>
  );
}
export function ErrorState({
  title = 'Algo no ha salido bien',
  body,
  onRetry,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      title={title}
      body={body}
      action={
        onRetry ? <AppButton title="Reintentar" variant="secondary" onPress={onRetry} /> : undefined
      }
    />
  );
}
export function LoadingSkeleton({
  height = 72,
  width = '100%',
  borderRadius = radii.md,
  circle = false,
  style,
  testID,
}: {
  height?: number;
  width?: DimensionValue;
  borderRadius?: number;
  circle?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const palette = useAppColors();
  const [shimmer] = useState(() => new Animated.Value(0));
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    shimmer.stopAnimation();
    if (reduceMotion) {
      shimmer.setValue(0.45);
      return;
    }
    shimmer.setValue(0);
    const animation = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1350,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, shimmer]);

  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      testID={testID}
      onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
      style={[
        styles.skeleton,
        {
          height,
          width,
          borderRadius: circle ? height / 2 : borderRadius,
          backgroundColor: palette.divider,
        },
        style,
      ]}
    >
      {measuredWidth > 0 ? (
        <Animated.View
          style={[
            styles.skeletonHighlight,
            {
              width: Math.max(36, measuredWidth * 0.46),
              backgroundColor: palette.surface,
              opacity: reduceMotion ? 0.28 : 0.62,
              transform: [
                {
                  translateX: shimmer.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-measuredWidth, measuredWidth],
                  }),
                },
                { skewX: '-14deg' },
              ],
            },
          ]}
        />
      ) : null}
    </View>
  );
}

export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const palette = useAppColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.modalOverlay, { backgroundColor: palette.overlay }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetKeyboard}
        >
          <View
            style={[
              styles.sheet,
              shadows.floating,
              {
                backgroundColor: palette.surface,
                paddingBottom: Math.max(spacing.xxl, insets.bottom + spacing.lg),
              },
            ]}
          >
            <View style={[styles.sheetHandle, { backgroundColor: palette.disabled }]} />
            <View style={styles.sheetHeader}>
              <AppText variant="sectionTitle">{title}</AppText>
              <AppButton title="Cerrar" variant="ghost" size="sm" onPress={onClose} />
            </View>
            <ScrollView
              style={styles.sheetContent}
              contentContainerStyle={styles.sheetContentContainer}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel = 'Confirmar',
  destructive,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <AppText>{body}</AppText>
      <View style={styles.rowEnd}>
        <AppButton title="Cancelar" variant="ghost" onPress={onClose} />
        <AppButton
          title={confirmLabel}
          variant={destructive ? 'danger' : 'primary'}
          onPress={onConfirm}
        />
      </View>
    </BottomSheet>
  );
}
export function CurrencyAmount({
  cents,
  currency = 'EUR',
  locale = 'es-ES',
  variant = 'heading',
  color,
  tone,
  style,
}: {
  cents: number;
  currency?: string;
  locale?: string;
  variant?: keyof typeof typography;
  color?: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'secondary' | 'muted';
  style?: TextStyle;
}) {
  return (
    <AppText variant={variant} color={color} tone={tone} tabular style={style}>
      {formatCentsExact(cents, currency, locale)}
    </AppText>
  );
}

export function ReceiptItemRow({
  name,
  amountCents,
  currency = 'EUR',
  subtitle,
  action,
}: {
  name: string;
  amountCents: number;
  currency?: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  const palette = useAppColors();
  return (
    <View style={styles.listRow}>
      <View style={styles.flex}>
        <AppText variant="label">{name}</AppText>
        {subtitle ? (
          <AppText variant="caption" color={palette.textSecondary}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <CurrencyAmount cents={amountCents} currency={currency} variant="label" />
      {action}
    </View>
  );
}
export function ParticipantChip({
  name,
  selected,
  onPress,
  testID,
}: {
  name: string;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  const palette = useAppColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? palette.primarySoft : palette.surface,
          borderColor: selected ? palette.primary : palette.border,
        },
      ]}
    >
      <Avatar name={name} size={26} />
      <AppText variant="label" color={selected ? palette.primary : palette.text}>
        {name}
      </AppText>
    </Pressable>
  );
}
export function ClaimCard({
  name,
  amountCents,
  currency = 'EUR',
  status,
  statusLabel,
  action,
}: {
  name: string;
  amountCents: number;
  currency?: string;
  status: string;
  statusLabel?: string;
  action?: ReactNode;
}) {
  return (
    <Card style={styles.claimCard}>
      <View style={styles.listRow}>
        <Avatar name={name} />
        <View style={styles.flex}>
          <AppText variant="heading">{name}</AppText>
          <StatusBadge status={status} label={statusLabel} />
        </View>
        <CurrencyAmount cents={amountCents} currency={currency} />
      </View>
      {action}
    </Card>
  );
}
export function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  const palette = useAppColors();
  return (
    <Card padding="compact" style={styles.metric}>
      <AppText variant="caption" color={palette.textSecondary}>
        {label}
      </AppText>
      <AppText variant="metric" color={tone} tabular>
        {value}
      </AppText>
    </Card>
  );
}
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <AppText variant="heading">{title}</AppText>
      {action}
    </View>
  );
}

export function Divider({ inset = 0, style, ...props }: ViewProps & { inset?: number }) {
  const palette = useAppColors();
  return (
    <View
      {...props}
      style={[styles.divider, { backgroundColor: palette.divider, marginLeft: inset }, style]}
    />
  );
}

export function ListCard({ style, ...props }: ViewProps) {
  return <Card {...props} variant="grouped" padding="none" style={[styles.listCard, style]} />;
}

export function ResponsiveContainer({
  publicPage,
  style,
  ...props
}: ViewProps & { publicPage?: boolean }) {
  return (
    <View
      {...props}
      style={[
        styles.responsive,
        { maxWidth: publicPage ? layout.publicMaxWidth : layout.appMaxWidth },
        style,
      ]}
    />
  );
}
export function ScreenContainer({
  children,
  contentContainerStyle,
  publicPage,
  floatingTabs,
  ...props
}: ScrollViewProps & { publicPage?: boolean; floatingTabs?: boolean }) {
  const palette = useAppColors();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.scrollTo(0, 0);
    }, 0);
    return () => clearTimeout(timer);
  }, [pathname]);

  return (
    <ScrollView
      key={pathname}
      ref={scrollRef}
      keyboardShouldPersistTaps="handled"
      {...props}
      showsVerticalScrollIndicator={false}
      style={[styles.screenScroll, { backgroundColor: palette.background }, props.style]}
      contentContainerStyle={[
        styles.screen,
        {
          paddingTop:
            Platform.OS === 'web' ? spacing.xxl : Math.max(spacing.lg, insets.top + spacing.sm),
          paddingBottom: floatingTabs
            ? Math.max(
                layout.tabBarHeight + spacing.section,
                insets.bottom + layout.tabBarHeight + spacing.xxl,
              )
            : Math.max(spacing.section, insets.bottom + spacing.xxl),
        },
        contentContainerStyle,
      ]}
    >
      <ResponsiveContainer publicPage={publicPage}>{children}</ResponsiveContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  button: {
    paddingHorizontal: spacing.lg,
    borderRadius: radii.control,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  buttonSm: { minHeight: 44, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  buttonMd: { minHeight: 48, paddingVertical: spacing.md },
  buttonLg: { minHeight: 56, paddingVertical: spacing.lg },
  fullWidth: { width: '100%', alignSelf: 'stretch' },
  iconButton: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.48 },
  field: { gap: 6 },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: radii.control,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
  },
  inputFocused: { borderWidth: 1.5 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.card,
    gap: spacing.md,
  },
  cardPaddingNone: { padding: 0 },
  cardPaddingCompact: { padding: spacing.md },
  cardPaddingDefault: { padding: spacing.lg },
  cardPaddingSpacious: { padding: spacing.xl },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statusLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: radii.pill },
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarGroup: { flexDirection: 'row', alignItems: 'center' },
  avatarGroupItem: {
    borderWidth: 2,
    borderRadius: radii.pill,
    backgroundColor: '#FFFFFF',
  },
  avatarOverflow: {
    width: 36,
    height: 36,
    borderWidth: 2,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOverlap: { marginLeft: -10 },
  progress: { height: 8, borderRadius: radii.pill, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: radii.pill },
  segmented: { flexDirection: 'row' },
  state: {
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  center: { textAlign: 'center' },
  skeleton: { overflow: 'hidden' },
  skeletonHighlight: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetKeyboard: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    maxWidth: layout.formMaxWidth,
    maxHeight: '92%',
    alignSelf: 'center',
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  sheetHandle: {
    width: 36,
    height: 5,
    borderRadius: radii.pill,
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetContent: { flexShrink: 1 },
  sheetContentContainer: { gap: spacing.lg, paddingTop: spacing.xs },
  rowEnd: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  chip: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  claimCard: { gap: spacing.lg },
  metric: { minWidth: 0, flex: 1, gap: spacing.sm },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  divider: { height: StyleSheet.hairlineWidth },
  listCard: { gap: 0 },
  responsive: { width: '100%', alignSelf: 'center', gap: spacing.lg },
  screenScroll: { flex: 1 },
  screen: {
    flexGrow: 1,
    paddingHorizontal: layout.screenGutter,
    gap: spacing.lg,
  },
});
