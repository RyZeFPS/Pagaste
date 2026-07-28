import { StyleSheet, View, type ViewStyle } from 'react-native';
import { AppText, Card, LoadingSkeleton, ScreenContainer } from '@/components/ui';
import { useAppColors } from '@/providers/app-providers';
import { useI18n } from '@/i18n';
import { layout, radii, shadows, spacing } from '@/theme';

type LoadingRegionProps = {
  children: React.ReactNode;
  label?: string;
  style?: ViewStyle;
  testID?: string;
};

export function LoadingRegion({ children, label, style, testID }: LoadingRegionProps) {
  const { t } = useI18n();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t('common.loading')}
      accessibilityState={{ busy: true }}
      testID={testID}
      style={style}
    >
      {children}
    </View>
  );
}

function SkeletonLine({
  width = '100%',
  height = 12,
}: {
  width?: `${number}%` | number;
  height?: number;
}) {
  return <LoadingSkeleton width={width} height={height} borderRadius={radii.pill} />;
}

function SkeletonHeader() {
  return (
    <View style={styles.header}>
      <LoadingSkeleton width={44} height={44} circle />
      <View style={styles.headerCopy}>
        <SkeletonLine width="54%" height={18} />
      </View>
      <LoadingSkeleton width={44} height={44} circle />
    </View>
  );
}

function SkeletonRow({ height = 76, avatar = 44 }: { height?: number; avatar?: number }) {
  return (
    <View style={[styles.row, { minHeight: height }]}>
      <LoadingSkeleton width={avatar} height={avatar} circle />
      <View style={styles.rowCopy}>
        <SkeletonLine width="72%" height={13} />
        <SkeletonLine width="48%" height={10} />
      </View>
      <View style={styles.rowEnd}>
        <SkeletonLine width={58} height={13} />
        <SkeletonLine width={44} height={9} />
      </View>
    </View>
  );
}

function SkeletonList({ count = 3, rowHeight = 76 }: { count?: number; rowHeight?: number }) {
  const palette = useAppColors();
  return (
    <Card padding="none" style={styles.listCard}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index}>
          <SkeletonRow height={rowHeight} />
          {index < count - 1 ? (
            <View style={[styles.divider, { backgroundColor: palette.divider }]} />
          ) : null}
        </View>
      ))}
    </Card>
  );
}

function SkeletonPanel({ height = 132 }: { height?: number }) {
  return (
    <Card style={[styles.panel, { minHeight: height }]}>
      <View style={styles.panelTop}>
        <LoadingSkeleton width={42} height={42} circle />
        <View style={styles.panelCopy}>
          <SkeletonLine width="64%" height={14} />
          <SkeletonLine width="42%" height={10} />
        </View>
      </View>
      <SkeletonLine width="100%" height={10} />
      <SkeletonLine width="74%" height={10} />
    </Card>
  );
}

function MetricsSkeleton() {
  const palette = useAppColors();
  return (
    <View style={styles.walletSkeletonStage}>
      <View
        style={[
          styles.walletSkeletonBack,
          { backgroundColor: palette.primaryLight, borderColor: palette.border },
        ]}
      />
      <Card padding="none" style={[styles.metricsCard, { borderColor: palette.border }]}>
        <View style={[styles.metricFeatured, { backgroundColor: palette.primaryLight }]}>
          <View style={styles.metricTitle}>
            <LoadingSkeleton width={50} height={50} borderRadius={16} />
            <SkeletonLine width={58} height={10} />
          </View>
          <SkeletonLine width="78%" height={24} />
          <SkeletonLine width={66} height={20} />
        </View>
        <View style={styles.metricStack}>
          <View style={[styles.metricCompact, { backgroundColor: palette.warningLight }]}>
            <LoadingSkeleton width={36} height={36} borderRadius={13} />
            <View style={styles.metricCopy}>
              <SkeletonLine width="70%" height={10} />
              <SkeletonLine width="56%" height={18} />
            </View>
          </View>
          <View style={[styles.metricCompact, { backgroundColor: palette.successLight }]}>
            <LoadingSkeleton width={36} height={36} borderRadius={13} />
            <View style={styles.metricCopy}>
              <SkeletonLine width="66%" height={10} />
              <SkeletonLine width="52%" height={18} />
            </View>
          </View>
        </View>
      </Card>
    </View>
  );
}

function HomeDataShapes() {
  const { t } = useI18n();
  return (
    <View style={styles.homeData}>
      <MetricsSkeleton />
      <AppText variant="heading">{t('home.recent')}</AppText>
      <SkeletonList count={2} rowHeight={78} />
    </View>
  );
}

export function HomeDataSkeleton() {
  const { t } = useI18n();
  return (
    <LoadingRegion label={t('common.loading')} testID="home-data-skeleton" style={styles.homeData}>
      <MetricsSkeleton />
      <AppText variant="heading">{t('home.recent')}</AppText>
      <SkeletonList count={2} rowHeight={78} />
    </LoadingRegion>
  );
}

function BootHomeShapes() {
  const palette = useAppColors();
  return (
    <>
      <View style={styles.bootHeader}>
        <View style={styles.bootIdentity}>
          <SkeletonLine width={112} height={16} />
          <SkeletonLine width={142} height={29} />
        </View>
        <LoadingSkeleton width={44} height={44} circle />
      </View>
      <View style={[styles.bootHero, { backgroundColor: palette.primaryLight }]}>
        <SkeletonLine width="58%" height={20} />
        <SkeletonLine width="72%" height={13} />
        <SkeletonLine width="52%" height={13} />
        <LoadingSkeleton height={58} borderRadius={radii.lg} style={styles.bootHeroButton} />
      </View>
      <View style={styles.sectionHeading}>
        <SkeletonLine width={84} height={18} />
        <SkeletonLine width={54} height={12} />
      </View>
      <HomeDataShapes />
    </>
  );
}

function SkeletonTabBar() {
  const palette = useAppColors();
  return (
    <View style={styles.tabBarDock}>
      <View
        style={[
          styles.tabBar,
          shadows.tabBar,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        {Array.from({ length: 4 }, (_, index) => (
          <View key={index} style={styles.tabItem}>
            <LoadingSkeleton width={24} height={24} borderRadius={7} />
            <SkeletonLine width={index === 0 ? 62 : 44} height={8} />
          </View>
        ))}
      </View>
    </View>
  );
}

export function AppBootSkeleton({ showTabBar = true }: { showTabBar?: boolean }) {
  const palette = useAppColors();
  const { t } = useI18n();
  return (
    <View style={[styles.flex, { backgroundColor: palette.background }]}>
      <ScreenContainer contentContainerStyle={showTabBar ? styles.bootContent : undefined}>
        <LoadingRegion
          label={t('loading.preparingApp')}
          testID="app-boot-skeleton"
          style={styles.bootBody}
        >
          <BootHomeShapes />
        </LoadingRegion>
      </ScreenContainer>
      {showTabBar ? <SkeletonTabBar /> : null}
    </View>
  );
}

export function AuthScreenSkeleton() {
  const { t } = useI18n();
  return (
    <ScreenContainer publicPage>
      <LoadingRegion
        label={t('loading.checkingSession')}
        testID="auth-skeleton"
        style={styles.authPage}
      >
        <View style={styles.authBrand}>
          <LoadingSkeleton width={64} height={64} borderRadius={20} />
          <SkeletonLine width={126} height={27} />
          <SkeletonLine width={184} height={12} />
        </View>
        <Card style={styles.authCard}>
          <SkeletonLine width="68%" height={22} />
          <SkeletonLine width="92%" height={12} />
          <LoadingSkeleton height={52} borderRadius={radii.control} />
          <LoadingSkeleton height={56} borderRadius={radii.control} />
        </Card>
      </LoadingRegion>
    </ScreenContainer>
  );
}

export type ScreenLoadingVariant =
  'items' | 'participants' | 'status' | 'review' | 'share' | 'group' | 'publicClaim';

function AvatarStripSkeleton() {
  return (
    <View style={styles.avatarStrip}>
      {Array.from({ length: 5 }, (_, index) => (
        <View key={index} style={styles.avatarPerson}>
          <LoadingSkeleton width={index === 4 ? 52 : 56} height={index === 4 ? 52 : 56} circle />
          <SkeletonLine width={index === 4 ? 42 : 50} height={9} />
        </View>
      ))}
    </View>
  );
}

function TicketSkeleton() {
  return (
    <>
      <View style={styles.ticketSelectorSkeleton}>
        <LoadingSkeleton width={156} height={62} borderRadius={radii.lg} />
        <LoadingSkeleton width={156} height={62} borderRadius={radii.lg} />
      </View>
      <LoadingSkeleton height={390} borderRadius={radii.card} style={styles.ticket} />
      <View style={styles.centeredChip}>
        <LoadingSkeleton width={148} height={28} borderRadius={radii.pill} />
      </View>
      <SkeletonList count={5} rowHeight={56} />
    </>
  );
}

function ProgressSkeleton() {
  return (
    <Card style={styles.progressCard}>
      <View style={styles.sectionHeading}>
        <SkeletonLine width={112} height={14} />
        <SkeletonLine width={104} height={14} />
      </View>
      <LoadingSkeleton height={10} borderRadius={radii.pill} />
      <SkeletonLine width="74%" height={12} />
    </Card>
  );
}

function PublicClaimSkeleton() {
  return (
    <>
      <View style={styles.publicBrand}>
        <LoadingSkeleton width={44} height={44} borderRadius={14} />
        <SkeletonLine width={104} height={22} />
        <SkeletonLine width={120} height={10} />
      </View>
      <Card style={styles.publicHero}>
        <LoadingSkeleton width={72} height={72} circle />
        <SkeletonLine width="62%" height={18} />
        <SkeletonLine width="38%" height={27} />
        <SkeletonLine width={96} height={24} />
      </Card>
      <SkeletonList count={3} rowHeight={60} />
      <SkeletonPanel height={146} />
    </>
  );
}

function VariantShapes({ variant }: { variant: ScreenLoadingVariant }) {
  if (variant === 'publicClaim') return <PublicClaimSkeleton />;
  if (variant === 'items') return <TicketSkeleton />;
  if (variant === 'participants')
    return (
      <>
        <AvatarStripSkeleton />
        <SkeletonList count={5} rowHeight={62} />
        <SkeletonPanel height={140} />
      </>
    );
  if (variant === 'status')
    return (
      <>
        <ProgressSkeleton />
        <SkeletonList count={3} rowHeight={82} />
        <SkeletonPanel height={132} />
      </>
    );
  if (variant === 'group')
    return (
      <>
        <SkeletonPanel height={164} />
        <SkeletonList count={2} rowHeight={68} />
        <SkeletonPanel height={116} />
        <SkeletonList count={2} rowHeight={76} />
      </>
    );
  if (variant === 'review')
    return (
      <>
        <ProgressSkeleton />
        <SkeletonPanel height={116} />
        <SkeletonList count={2} rowHeight={78} />
      </>
    );
  return (
    <>
      <View style={styles.successHero}>
        <LoadingSkeleton width={76} height={76} circle />
        <SkeletonLine width="62%" height={22} />
        <SkeletonLine width="80%" height={12} />
      </View>
      <SkeletonPanel height={152} />
      <SkeletonPanel height={152} />
    </>
  );
}

function hasFooter(variant: ScreenLoadingVariant) {
  return variant !== 'group' && variant !== 'publicClaim';
}

export function ScreenLoadingSkeleton({ variant }: { variant: ScreenLoadingVariant }) {
  const palette = useAppColors();
  const footer = hasFooter(variant);
  return (
    <View style={[styles.flex, { backgroundColor: palette.background }]}>
      <ScreenContainer
        publicPage={variant === 'publicClaim'}
        contentContainerStyle={footer ? styles.detailContentWithFooter : undefined}
      >
        <LoadingRegion testID={`${variant}-skeleton`} style={styles.detailBody}>
          {variant === 'publicClaim' ? null : <SkeletonHeader />}
          <VariantShapes variant={variant} />
        </LoadingRegion>
        {footer ? <LoadingSkeleton height={56} borderRadius={radii.control} /> : null}
      </ScreenContainer>
    </View>
  );
}

export function ListRowsSkeleton({
  count = 3,
  rowHeight = 76,
}: {
  count?: number;
  rowHeight?: number;
}) {
  return (
    <LoadingRegion style={styles.listLoading}>
      <SkeletonList count={count} rowHeight={rowHeight} />
    </LoadingRegion>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerCopy: { flex: 1, alignItems: 'center' },
  row: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowCopy: { minWidth: 0, flex: 1, gap: spacing.sm },
  rowEnd: { width: 64, alignItems: 'flex-end', gap: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 68 },
  listCard: { borderWidth: 0, borderRadius: radii.card, overflow: 'hidden', gap: 0 },
  panel: { justifyContent: 'center' },
  panelTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  panelCopy: { minWidth: 0, flex: 1, gap: spacing.sm },
  metricsCard: {
    minHeight: 166,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderRadius: 24,
    gap: 8,
  },
  walletSkeletonStage: { position: 'relative', paddingTop: 8 },
  walletSkeletonBack: {
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
  metricFeatured: {
    minWidth: 0,
    flex: 0.92,
    paddingHorizontal: 14,
    paddingVertical: 13,
    justifyContent: 'space-between',
    borderRadius: 17,
  },
  metricTitle: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  metricStack: { minWidth: 0, flex: 1.18, justifyContent: 'space-between', gap: 7 },
  metricCompact: {
    minHeight: 70,
    flex: 1,
    paddingHorizontal: 6,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 15,
    gap: 4,
  },
  metricCopy: { minWidth: 0, flex: 1, gap: spacing.sm },
  homeData: { gap: spacing.lg },
  bootBody: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: spacing.lg },
  bootContent: { paddingBottom: layout.tabBarHeight + spacing.section },
  bootHeader: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bootIdentity: { flex: 1, gap: spacing.sm },
  bootHero: {
    minHeight: 238,
    padding: spacing.xl,
    borderRadius: radii.xl,
    gap: spacing.md,
    overflow: 'hidden',
  },
  bootHeroButton: { marginTop: 'auto' },
  sectionHeading: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  tabBarDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: '4%',
    paddingBottom: spacing.md,
  },
  tabBar: {
    width: '100%',
    maxWidth: 480,
    minHeight: 74,
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    flexDirection: 'row',
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  authPage: { flex: 1, justifyContent: 'center', gap: spacing.xxl },
  authBrand: { alignItems: 'center', gap: spacing.md },
  authCard: { gap: spacing.lg },
  detailBody: { width: '100%', gap: spacing.lg },
  detailContentWithFooter: { paddingBottom: spacing.xxl },
  avatarStrip: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  avatarPerson: { flex: 1, alignItems: 'center', gap: spacing.sm },
  ticket: { width: '100%', maxHeight: 440, aspectRatio: 1.05, alignSelf: 'center' },
  ticketSelectorSkeleton: { flexDirection: 'row', gap: spacing.sm, overflow: 'hidden' },
  centeredChip: { alignItems: 'center' },
  progressCard: { minHeight: 124, justifyContent: 'center' },
  publicBrand: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  publicHero: { minHeight: 220, alignItems: 'center', justifyContent: 'center' },
  successHero: { minHeight: 176, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  listLoading: { gap: spacing.lg },
});
