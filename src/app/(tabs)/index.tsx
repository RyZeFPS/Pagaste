import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { Bell, Camera, ChevronRight } from 'lucide-react-native';
import {
  AppButton,
  AppText,
  Avatar,
  AvatarGroup,
  Card,
  EmptyState,
  ErrorState,
  ScreenContainer,
} from '@/components/ui';
import { HomeDataSkeleton } from '@/components/loading-skeletons';
import { BrandLogo } from '@/components/brand-logo';
import { repository } from '@/lib/repository';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { useNotificationCenter } from '@/providers/notification-center-provider';
import { useI18n } from '@/i18n';
import { radii, spacing } from '@/theme';
import { sumCents } from '@/domain/money';
import type { Claim, Expense } from '@/lib/models';
import { ThreeDIcon } from '@/components/three-d-icon';
import { MerchantLogo } from '@/components/merchant-logo';

const RECEIVABLE_STATUSES = ['pending', 'reminder_sent', 'disputed'];
const PENDING_STATUSES = ['pending', 'reminder_sent', 'disputed'];
const homeEnter = (delay: number) =>
  FadeInDown.duration(340).delay(delay).reduceMotion(ReduceMotion.System);

function ReceiptIllustration() {
  return (
    <View pointerEvents="none" style={styles.heroArtwork}>
      <View style={styles.heroGlow} />
      <ThreeDIcon
        name="receiptScan"
        size={154}
        testID="home-receipt-3d"
        style={styles.heroArtworkIcon}
      />
    </View>
  );
}

function HomeMetric({
  label,
  amount,
  count,
  tone,
  featured,
}: {
  label: string;
  amount: string;
  count: number;
  tone: 'primary' | 'warning' | 'success';
  featured?: boolean;
}) {
  const palette = useAppColors();
  const { t } = useI18n();
  const countLabel = `${count} ${t(count === 1 ? 'home.claimSingular' : 'home.claimPlural')}`;
  const toneColor =
    tone === 'success' ? palette.success : tone === 'warning' ? palette.warning : palette.primary;
  const toneSurface =
    tone === 'success'
      ? palette.successLight
      : tone === 'warning'
        ? palette.warningLight
        : palette.primaryLight;

  if (featured) {
    return (
      <View
        testID="home-receivable-pocket"
        style={[styles.featuredMetric, { backgroundColor: palette.primary }]}
      >
        <View pointerEvents="none" style={styles.featuredMetricStitch} />
        <ThreeDIcon
          name="walletReceivable"
          size={68}
          testID="home-wallet-3d"
          accessibilityLabel={t('home.receivableWallet')}
          style={styles.featuredWalletIcon}
        />
        <View style={styles.featuredMetricHeader}>
          <AppText numberOfLines={1} color={palette.white} style={styles.featuredMetricLabel}>
            {label}
          </AppText>
        </View>
        <AppText
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.62}
          color={palette.white}
          style={styles.featuredMetricAmount}
        >
          {amount}
        </AppText>
        <View style={styles.featuredMetricCount}>
          <AppText numberOfLines={1} color={palette.white} style={styles.metricCountTextFeatured}>
            {countLabel}
          </AppText>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.compactMetric, { backgroundColor: toneSurface }]}>
      <View style={styles.compactMetricIcon}>
        <ThreeDIcon
          name={tone === 'success' ? 'paidCheck' : 'pendingClock'}
          size={44}
          testID={tone === 'success' ? 'home-paid-3d' : 'home-pending-3d'}
          accessibilityLabel={
            tone === 'success' ? t('home.completedPayment') : t('home.pendingClaim')
          }
        />
      </View>
      <View style={styles.compactMetricCopy}>
        <View style={styles.compactMetricHeader}>
          <AppText numberOfLines={1} style={styles.compactMetricLabel}>
            {label}
          </AppText>
          <AppText numberOfLines={1} color={palette.textMuted} style={styles.metricCountText}>
            {countLabel}
          </AppText>
        </View>
        <AppText
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.66}
          color={toneColor}
          style={styles.compactMetricAmount}
        >
          {amount}
        </AppText>
      </View>
    </View>
  );
}

function recentStatus(expense: Expense, expenseClaims: Claim[]) {
  if (
    expense.status === 'settled' ||
    (expenseClaims.length > 0 && expenseClaims.every((claim) => claim.status === 'received'))
  )
    return 'paid' as const;
  if (expenseClaims.some((claim) => claim.status === 'disputed')) return 'disputed' as const;
  if (expenseClaims.some((claim) => claim.status === 'reminder_sent')) return 'reminded' as const;
  if (expenseClaims.some((claim) => claim.status === 'pending')) return 'pending' as const;
  return 'draft' as const;
}

export default function HomeScreen() {
  const router = useRouter();
  const auth = useAuth();
  const palette = useAppColors();
  const notificationCenter = useNotificationCenter();
  const { formatMoney, formatDate, t } = useI18n();
  const expenses = useQuery({
    queryKey: ['expenses'],
    queryFn: repository.listExpenses,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
  const claims = useQuery({
    queryKey: ['claims'],
    queryFn: () => repository.listClaims(),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
  const isInitialDataLoading =
    (expenses.isPending && expenses.data === undefined) ||
    (claims.isPending && claims.data === undefined);
  const displayName = auth.profile?.display_name.trim() || t('home.defaultName');
  const firstName = displayName.split(/\s+/u)[0] || t('home.defaultName');
  const profileAvatar = auth.profile?.avatar_url ?? auth.profile?.avatar_path;
  const metrics = useMemo(() => {
    const values = claims.data ?? [];
    const receivable = values.filter((claim) => RECEIVABLE_STATUSES.includes(claim.status));
    const pending = values.filter((claim) => PENDING_STATUSES.includes(claim.status));
    const paid = values.filter((claim) => claim.status === 'received');

    return {
      receivable: sumCents(receivable.map((claim) => claim.amount_cents)),
      receivableCount: receivable.length,
      pending: sumCents(pending.map((claim) => claim.amount_cents)),
      pendingCount: pending.length,
      paid: sumCents(paid.map((claim) => claim.amount_cents)),
      paidCount: paid.length,
    };
  }, [claims.data]);

  return (
    <ScreenContainer floatingTabs>
      <View style={styles.home}>
        <Animated.View entering={homeEnter(0)} style={styles.top}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('home.openProfile')}
            accessibilityHint={t('home.openProfileHint')}
            onPress={() => router.push('/(tabs)/profile')}
            style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
          >
            <View
              testID="home-profile-avatar"
              style={[
                styles.identityMark,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                  shadowColor: palette.text,
                },
              ]}
            >
              <Avatar name={displayName} uri={profileAvatar} size={50} />
            </View>
            <View style={styles.identityCopy}>
              <AppText color={palette.primary} style={styles.greeting}>
                {t('home.greetingDisplay', { name: firstName })}
              </AppText>
              <BrandLogo
                variant="horizontal"
                width={132}
                accessibilityLabel="Pagaste"
                testID="home-brand-logo"
                style={styles.brand}
              />
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              notificationCenter.unreadCount
                ? t('home.notificationsUnread', { count: notificationCenter.unreadCount })
                : t('home.notifications')
            }
            hitSlop={8}
            onPress={() => router.push('/settings/notifications')}
            style={({ pressed }) => [styles.bellButton, pressed && styles.pressed]}
          >
            <Bell color={palette.text} size={24} strokeWidth={1.9} />
            {notificationCenter.unreadCount > 0 ? (
              <View style={[styles.notificationBadge, { backgroundColor: palette.danger }]}>
                <AppText color={palette.white} style={styles.notificationBadgeText}>
                  +{Math.min(notificationCenter.unreadCount, 99)}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        </Animated.View>

        <Animated.View entering={homeEnter(45)}>
          <Card
            style={[
              styles.hero,
              { backgroundColor: palette.primary, borderColor: palette.primary },
            ]}
          >
            <ReceiptIllustration />
            <View style={styles.heroCopy}>
              <AppText color={palette.white} style={styles.heroTitle}>
                {t('home.heroTitle')}
              </AppText>
              <AppText color={palette.white} style={styles.heroSubtitle}>
                {t('home.heroBody')}
              </AppText>
            </View>
            <View style={styles.heroActions}>
              <Pressable
                testID="new-expense"
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/expense/new', params: { mode: 'scan' } })}
                style={({ pressed }) => [
                  styles.scanButton,
                  { backgroundColor: palette.surface },
                  pressed && styles.buttonPressed,
                ]}
              >
                <Camera color={palette.primary} size={22} strokeWidth={2} />
                <AppText color={palette.primary} style={styles.scanButtonLabel}>
                  {t('home.scan')}
                </AppText>
              </Pressable>
              <Pressable
                testID="manual-expense"
                accessibilityRole="button"
                accessibilityLabel={t('home.manual')}
                accessibilityHint={t('home.manualHint')}
                onPress={() =>
                  router.push({ pathname: '/expense/new', params: { mode: 'manual' } })
                }
                style={({ pressed }) => [styles.manualButton, pressed && styles.buttonPressed]}
              >
                <ThreeDIcon name="manualExpense" size={38} testID="home-manual-3d" />
                <AppText color={palette.white} style={styles.manualButtonLabel}>
                  {t('home.manual')}
                </AppText>
              </Pressable>
            </View>
          </Card>
        </Animated.View>

        <Animated.View entering={homeEnter(95)} style={styles.sectionHeader}>
          <AppText variant="heading">{t('home.summary')}</AppText>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push('/(tabs)/activity')}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <AppText color={palette.primary} style={styles.sectionAction}>
              {t('home.seeAll')}
            </AppText>
          </Pressable>
        </Animated.View>
        {isInitialDataLoading ? (
          <Animated.View entering={homeEnter(130)}>
            <HomeDataSkeleton />
          </Animated.View>
        ) : (
          <Animated.View entering={homeEnter(130)} style={styles.homeData}>
            <View testID="home-summary-wallet" style={styles.walletStage}>
              <View
                pointerEvents="none"
                style={[
                  styles.walletBack,
                  { backgroundColor: palette.primaryLight, borderColor: palette.border },
                ]}
              />
              <Card style={[styles.metrics, { borderColor: palette.border }]}>
                <HomeMetric
                  label={t('home.toCollect')}
                  amount={formatMoney(metrics.receivable)}
                  count={metrics.receivableCount}
                  tone="primary"
                  featured
                />
                <View style={styles.metricStack}>
                  <HomeMetric
                    label={t('home.pending')}
                    amount={formatMoney(metrics.pending)}
                    count={metrics.pendingCount}
                    tone="warning"
                  />
                  <HomeMetric
                    label={t('home.recovered')}
                    amount={formatMoney(metrics.paid)}
                    count={metrics.paidCount}
                    tone="success"
                  />
                </View>
              </Card>
            </View>

            <AppText variant="heading" style={styles.recentTitle}>
              {t('home.recent')}
            </AppText>
            {expenses.isError ? (
              <Card style={styles.stateCard}>
                <ErrorState body={t('home.loadError')} onRetry={() => void expenses.refetch()} />
              </Card>
            ) : !expenses.data?.length ? (
              <Card style={styles.stateCard}>
                <EmptyState
                  title={t('home.emptyTitle')}
                  body={t('home.emptyBody')}
                  action={
                    <AppButton
                      title={t('home.emptyAction')}
                      onPress={() => router.push('/expense/new')}
                    />
                  }
                />
              </Card>
            ) : (
              <Card style={styles.recentCard}>
                {expenses.data.slice(0, 3).map((expense, index, visibleExpenses) => {
                  const expenseClaims = (claims.data ?? []).filter(
                    (claim) => claim.expense_id === expense.id,
                  );
                  const recoverable = sumCents(expenseClaims.map((claim) => claim.amount_cents));
                  const participants = expenseClaims
                    .map((claim) => claim.debtor)
                    .filter((person): person is NonNullable<typeof person> => Boolean(person));
                  const participantNames = [
                    ...new Set(participants.map((person) => person.display_name)),
                  ]
                    .slice(0, 3)
                    .join(', ');
                  const merchantName = expense.merchant_name?.trim() || null;
                  const supportingText = merchantName
                    ? participantNames
                      ? `${merchantName} · ${participantNames}`
                      : merchantName
                    : participantNames || formatDate(expense.occurred_at);
                  const state = recentStatus(expense, expenseClaims);
                  const status =
                    state === 'paid'
                      ? { label: t('home.statusPaid'), color: palette.success }
                      : state === 'disputed'
                        ? { label: t('home.statusDisputed'), color: palette.danger }
                        : state === 'reminded'
                          ? { label: t('home.statusReminded'), color: palette.primary }
                          : state === 'pending'
                            ? { label: t('home.statusPending'), color: palette.warning }
                            : { label: t('home.statusDraft'), color: palette.textSecondary };
                  const amount = recoverable || expense.recoverable_cents || expense.total_cents;

                  return (
                    <Pressable
                      key={expense.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${expense.title}${merchantName ? `, ${merchantName}` : ''}, ${formatMoney(amount, expense.currency)}, ${status.label}`}
                      onPress={() => router.push(`/expense/${expense.id}/status`)}
                      style={({ pressed }) => [
                        styles.recentRow,
                        index < visibleExpenses.length - 1 && {
                          borderBottomColor: palette.border,
                          borderBottomWidth: StyleSheet.hairlineWidth,
                        },
                        pressed && { backgroundColor: palette.primarySoft },
                      ]}
                    >
                      <View style={styles.avatarSlot}>
                        {merchantName ? (
                          <MerchantLogo
                            merchantName={merchantName}
                            fallbackLabel={expense.title}
                            size={46}
                          />
                        ) : participants.length ? (
                          <AvatarGroup
                            max={2}
                            people={participants.map((person) => ({
                              name: person.display_name,
                              uri: person.avatar_path,
                            }))}
                          />
                        ) : (
                          <MerchantLogo fallbackLabel={expense.title} size={42} />
                        )}
                      </View>
                      <View style={styles.recentCopy}>
                        <AppText numberOfLines={1} style={styles.recentName}>
                          {expense.title}
                        </AppText>
                        <AppText numberOfLines={1} variant="caption" color={palette.textSecondary}>
                          {supportingText}
                        </AppText>
                      </View>
                      <View style={styles.recentAmount}>
                        <AppText numberOfLines={1} style={styles.amountText}>
                          {formatMoney(amount, expense.currency)}
                        </AppText>
                        <AppText numberOfLines={2} color={status.color} style={styles.recentStatus}>
                          {status.label}
                        </AppText>
                      </View>
                      <ChevronRight color={palette.textSecondary} size={20} strokeWidth={1.8} />
                    </Pressable>
                  );
                })}
              </Card>
            )}
          </Animated.View>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  home: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    gap: spacing.lg,
  },
  homeData: { gap: spacing.lg },
  top: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  identityMark: {
    width: 56,
    height: 56,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 28,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.09,
    shadowRadius: 10,
    elevation: 2,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  greeting: {
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '600',
  },
  brand: {
    marginTop: 2,
  },
  bellButton: {
    position: 'relative',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  notificationBadge: {
    position: 'absolute',
    top: 0,
    right: -3,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '800',
  },
  hero: {
    position: 'relative',
    minHeight: 292,
    padding: spacing.xl,
    borderWidth: 0,
    borderRadius: radii.xl,
    overflow: 'hidden',
    gap: spacing.lg,
  },
  heroCopy: {
    maxWidth: '48%',
    zIndex: 2,
    gap: 7,
  },
  heroTitle: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  heroSubtitle: {
    maxWidth: 260,
    fontSize: 15,
    lineHeight: 21,
    opacity: 0.94,
  },
  heroActions: {
    marginTop: 'auto',
    zIndex: 2,
    gap: spacing.sm,
  },
  scanButton: {
    minHeight: 58,
    paddingHorizontal: spacing.lg,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  scanButtonLabel: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  manualButton: {
    minHeight: 50,
    alignSelf: 'stretch',
    paddingHorizontal: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.52)',
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  manualButtonLabel: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  heroArtwork: {
    position: 'absolute',
    top: 12,
    right: -10,
    width: 164,
    height: 164,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 1,
  },
  heroArtworkIcon: { transform: [{ rotate: '3deg' }] },
  heroGlow: {
    position: 'absolute',
    width: 168,
    height: 168,
    borderRadius: 84,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  sectionHeader: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  sectionAction: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  metrics: {
    minHeight: 166,
    flexDirection: 'row',
    alignItems: 'stretch',
    padding: 8,
    borderWidth: 1,
    borderRadius: 24,
    gap: 8,
    overflow: 'hidden',
  },
  walletStage: {
    position: 'relative',
    paddingTop: 8,
  },
  walletBack: {
    position: 'absolute',
    top: 0,
    left: 18,
    right: 18,
    height: 40,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  featuredMetric: {
    minWidth: 0,
    flex: 0.92,
    paddingHorizontal: 14,
    paddingVertical: 14,
    justifyContent: 'space-between',
    borderRadius: 18,
    overflow: 'hidden',
  },
  featuredMetricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    zIndex: 2,
  },
  featuredWalletIcon: {
    position: 'absolute',
    top: '50%',
    right: -1,
    marginTop: -34,
    transform: [{ rotate: '-4deg' }],
    opacity: 0.98,
    zIndex: 1,
  },
  featuredMetricStitch: {
    position: 'absolute',
    left: 9,
    right: 9,
    bottom: 8,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.30)',
  },
  featuredMetricLabel: {
    maxWidth: '64%',
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    opacity: 0.92,
  },
  featuredMetricAmount: {
    fontSize: 23,
    lineHeight: 29,
    fontWeight: '800',
    letterSpacing: -0.6,
    zIndex: 2,
  },
  featuredMetricCount: {
    alignSelf: 'flex-start',
    minHeight: 24,
    paddingHorizontal: 9,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    zIndex: 2,
  },
  metricCountTextFeatured: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    opacity: 0.9,
  },
  metricStack: {
    minWidth: 0,
    flex: 1.18,
    justifyContent: 'space-between',
    gap: 7,
  },
  compactMetric: {
    minHeight: 70,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 7,
    borderRadius: 15,
    gap: 4,
  },
  compactMetricIcon: {
    width: 36,
    height: 36,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactMetricCopy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  compactMetricHeader: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  compactMetricLabel: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  compactMetricAmount: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    letterSpacing: -0.35,
  },
  metricCountText: {
    flexShrink: 1,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
  },
  recentTitle: {
    marginTop: spacing.xs,
  },
  recentCard: {
    padding: 0,
    borderWidth: 0,
    borderRadius: 18,
    overflow: 'hidden',
    gap: 0,
  },
  recentRow: {
    minHeight: 78,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarSlot: {
    width: 58,
    alignItems: 'flex-start',
  },
  recentCopy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  recentName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  recentAmount: {
    maxWidth: 116,
    alignItems: 'flex-end',
    gap: 2,
  },
  amountText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  recentStatus: {
    maxWidth: 106,
    textAlign: 'right',
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '600',
  },
  stateCard: {
    padding: 0,
    borderWidth: 0,
  },
  pressed: {
    opacity: 0.7,
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
});
