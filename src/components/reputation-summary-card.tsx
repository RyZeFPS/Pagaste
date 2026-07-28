import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { BellRing, CheckCircle2, Clock3, ReceiptText, Sparkles } from 'lucide-react-native';
import { ThreeDIcon } from '@/components/three-d-icon';
import { AppButton, AppText, Card, LoadingSkeleton, ProgressBar } from '@/components/ui';
import type { ReputationCard as ReputationData } from '@/lib/models';
import { useAppColors } from '@/providers/app-providers';
import { useI18n } from '@/i18n';
import { radii, spacing } from '@/theme';

function percentage(value: number | null, intlLocale: string) {
  if (value === null) return '—';
  const normalized = value <= 1 ? value * 100 : value;
  return new Intl.NumberFormat(intlLocale, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(Math.min(100, Math.max(0, normalized)) / 100);
}

function hours(value: number | null, translate: ReturnType<typeof useI18n>['t']) {
  if (value === null) return '—';
  if (value < 1) {
    return translate('reputation.minutes', { value: Math.max(1, Math.round(value * 60)) });
  }
  return translate('reputation.hours', { value: Math.round(value) });
}

function reminders(value: number | null, intlLocale: string) {
  if (value === null) return '—';
  return new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 1 }).format(value);
}

export function ReputationSummarySkeleton() {
  const { t } = useI18n();
  return (
    <Card
      accessibilityRole="progressbar"
      accessibilityLabel={t('reputation.loading')}
      accessibilityState={{ busy: true }}
      padding="spacious"
      style={styles.card}
    >
      <View style={styles.header}>
        <LoadingSkeleton height={46} width={46} circle />
        <View style={styles.flex}>
          <LoadingSkeleton height={18} width="42%" borderRadius={8} />
          <LoadingSkeleton height={13} width="65%" borderRadius={7} />
        </View>
        <LoadingSkeleton height={30} width={86} borderRadius={15} />
      </View>
      <View style={styles.scoreRow}>
        <LoadingSkeleton height={62} width={108} borderRadius={14} />
        <LoadingSkeleton height={58} width={112} borderRadius={14} />
      </View>
      <LoadingSkeleton height={8} borderRadius={4} />
      <View style={styles.metrics}>
        <LoadingSkeleton height={82} style={styles.metricSkeleton} />
        <LoadingSkeleton height={82} style={styles.metricSkeleton} />
        <LoadingSkeleton height={82} style={styles.metricSkeleton} />
      </View>
    </Card>
  );
}

export function ReputationSummaryCard({
  reputation,
  error = false,
  onRetry,
}: {
  reputation: ReputationData | null | undefined;
  error?: boolean;
  onRetry?: () => void;
}) {
  const palette = useAppColors();
  const { intlLocale, t } = useI18n();
  const reputationLabels: Record<ReputationData['level'], string> = {
    new: t('reputation.levelNew'),
    very_reliable: t('reputation.levelVeryReliable'),
    reliable: t('reputation.levelReliable'),
    building: t('reputation.levelBuilding'),
    improving: t('reputation.levelImproving'),
  };

  if (error || !reputation) {
    return (
      <Card variant="outlined" padding="spacious" style={styles.card}>
        <View style={styles.header}>
          <ThreeDIcon name="reputationShield" size={48} accessibilityLabel={t('reputation.icon')} />
          <View style={styles.flex}>
            <AppText variant="sectionTitle">{t('reputation.title')}</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {t('reputation.loadError')}
            </AppText>
          </View>
        </View>
        {onRetry ? (
          <AppButton title={t('reputation.retry')} variant="outline" size="sm" onPress={onRetry} />
        ) : null}
      </Card>
    );
  }

  const isNew = reputation.score === null;
  const levelColor =
    reputation.level === 'very_reliable'
      ? palette.successInk
      : reputation.level === 'reliable' || reputation.level === 'new'
        ? palette.primary
        : palette.warningInk;
  const levelBackground =
    reputation.level === 'very_reliable'
      ? palette.successLight
      : reputation.level === 'reliable' || reputation.level === 'new'
        ? palette.primaryLight
        : palette.warningLight;

  return (
    <Card
      accessibilityLabel={
        isNew
          ? t('reputation.a11yNew', { payments: reputation.completedPayments })
          : t('reputation.a11yScore', {
              level: reputationLabels[reputation.level],
              score: reputation.score ?? 0,
              payments: reputation.completedPayments,
            })
      }
      padding="spacious"
      style={styles.card}
    >
      <View style={styles.header}>
        <ThreeDIcon name="reputationShield" size={50} accessibilityLabel={t('reputation.icon')} />
        <View style={styles.flex}>
          <AppText variant="sectionTitle">{t('reputation.title')}</AppText>
          <AppText variant="bodySmall" color={palette.textSecondary}>
            {t('reputation.summary')}
          </AppText>
        </View>
        <View style={[styles.levelBadge, { backgroundColor: levelBackground }]}>
          <AppText color={levelColor} style={styles.levelLabel}>
            {reputationLabels[reputation.level]}
          </AppText>
        </View>
      </View>

      {isNew ? (
        <View style={[styles.newState, { backgroundColor: palette.primaryLight }]}>
          <View style={styles.newHeading}>
            <Sparkles color={palette.primary} size={25} strokeWidth={1.9} />
            <View style={styles.flex}>
              <AppText variant="label">{t('reputation.buildingTitle')}</AppText>
              <AppText variant="caption" color={palette.textSecondary}>
                {t('reputation.buildingBody')}
              </AppText>
            </View>
          </View>
          <ProgressBar
            value={Math.min(reputation.completedPayments / 3, 1)}
            color={palette.primary}
          />
          <AppText variant="caption" color={palette.textSecondary}>
            {t('reputation.firstRating', {
              payments: Math.min(reputation.completedPayments, 3),
            })}
          </AppText>
        </View>
      ) : (
        <>
          <View style={styles.scoreRow}>
            <View style={styles.scoreCopy}>
              <View style={styles.scoreValueRow}>
                <AppText color={levelColor} style={styles.scoreValue} tabular>
                  {reputation.score}
                </AppText>
                <AppText color={palette.textMuted} style={styles.scoreScale}>
                  /100
                </AppText>
              </View>
              <AppText variant="caption" color={palette.textSecondary}>
                {t('reputation.index')}
              </AppText>
            </View>
            <View style={[styles.paymentHighlight, { backgroundColor: palette.primaryLight }]}>
              <ReceiptText color={palette.primary} size={23} strokeWidth={1.9} />
              <View>
                <AppText color={palette.primary} style={styles.paymentValue} tabular>
                  {reputation.completedPayments}
                </AppText>
                <AppText color={palette.textSecondary} style={styles.paymentLabel}>
                  {t('reputation.payments')}
                </AppText>
              </View>
            </View>
          </View>
          <ProgressBar value={(reputation.score ?? 0) / 100} color={levelColor} />
        </>
      )}

      <View style={styles.metrics}>
        <Metric
          icon={<CheckCircle2 color={palette.successInk} size={18} strokeWidth={2} />}
          label={t('reputation.within24')}
          value={percentage(reputation.within24Rate, intlLocale)}
          backgroundColor={palette.successLight}
          color={palette.successInk}
        />
        <Metric
          icon={<Clock3 color={palette.warningInk} size={18} strokeWidth={2} />}
          label={t('reputation.usualTime')}
          value={hours(reputation.medianPaymentHours, t)}
          backgroundColor={palette.warningLight}
          color={palette.warningInk}
        />
        <Metric
          icon={<BellRing color={palette.primary} size={18} strokeWidth={2} />}
          label={t('reputation.remindersPerPayment')}
          value={reminders(reputation.averageReminders, intlLocale)}
          backgroundColor={palette.primaryLight}
          color={palette.primary}
        />
      </View>

      <AppText variant="caption" color={palette.textMuted}>
        {t('reputation.caveat')}
      </AppText>
    </Card>
  );
}

function Metric({
  icon,
  label,
  value,
  backgroundColor,
  color,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  backgroundColor: string;
  color: string;
}) {
  return (
    <View style={[styles.metric, { backgroundColor }]}>
      {icon}
      <AppText
        numberOfLines={1}
        adjustsFontSizeToFit
        color={color}
        style={styles.metricValue}
        tabular
      >
        {value}
      </AppText>
      <AppText numberOfLines={2} color={color} style={styles.metricLabel}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { minWidth: 0, flex: 1 },
  card: { gap: spacing.lg, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  levelBadge: {
    maxWidth: 104,
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelLabel: {
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  scoreCopy: { minWidth: 0, flex: 1, gap: spacing.xs },
  scoreValueRow: { flexDirection: 'row', alignItems: 'baseline' },
  scoreValue: {
    fontSize: 46,
    lineHeight: 50,
    fontWeight: '800',
    letterSpacing: -1.4,
  },
  scoreScale: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  paymentHighlight: {
    minWidth: 108,
    minHeight: 62,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  paymentValue: { fontSize: 21, lineHeight: 23, fontWeight: '800' },
  paymentLabel: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  newState: { padding: spacing.lg, borderRadius: radii.lg, gap: spacing.md },
  newHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  metrics: { flexDirection: 'row', gap: spacing.sm },
  metric: {
    minWidth: 0,
    flex: 1,
    minHeight: 88,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  metricValue: { fontSize: 18, lineHeight: 22, fontWeight: '800' },
  metricLabel: { textAlign: 'center', fontSize: 10, lineHeight: 13, fontWeight: '700' },
  metricSkeleton: { minWidth: 0, flex: 1 },
});
