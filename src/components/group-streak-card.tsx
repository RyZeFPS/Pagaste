import { StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { Clock3, RotateCcw, Trophy } from 'lucide-react-native';
import { ThreeDIcon } from '@/components/three-d-icon';
import { AppButton, AppText, Card, LoadingSkeleton, ProgressBar } from '@/components/ui';
import type { GroupStreakCard as GroupStreakData } from '@/lib/models';
import { useAppColors } from '@/providers/app-providers';
import { useI18n } from '@/i18n';
import { radii, spacing } from '@/theme';

function deadlineLabel(value: string, intlLocale: string, todayLabel: string) {
  const deadline = new Date(value);
  if (Number.isNaN(deadline.valueOf())) return null;
  const now = new Date();
  const sameDay =
    deadline.getFullYear() === now.getFullYear() &&
    deadline.getMonth() === now.getMonth() &&
    deadline.getDate() === now.getDate();
  const formatted = new Intl.DateTimeFormat(intlLocale, {
    ...(sameDay ? {} : { day: 'numeric', month: 'short' as const }),
    hour: '2-digit',
    minute: '2-digit',
  }).format(deadline);
  return sameDay ? `${todayLabel}, ${formatted}` : formatted;
}

export function GroupStreakSkeleton() {
  const { t } = useI18n();
  return (
    <Card
      accessibilityRole="progressbar"
      accessibilityLabel={t('groups.streakLoading')}
      accessibilityState={{ busy: true }}
      padding="spacious"
      style={styles.card}
    >
      <View style={styles.header}>
        <LoadingSkeleton width={74} height={74} circle />
        <View style={styles.flex}>
          <LoadingSkeleton width="48%" height={14} borderRadius={7} />
          <LoadingSkeleton width="72%" height={26} borderRadius={9} />
          <LoadingSkeleton width="82%" height={13} borderRadius={7} />
        </View>
      </View>
      <View style={styles.metrics}>
        <LoadingSkeleton height={70} style={styles.metricSkeleton} />
        <LoadingSkeleton height={70} style={styles.metricSkeleton} />
        <LoadingSkeleton height={70} style={styles.metricSkeleton} />
      </View>
    </Card>
  );
}

export function GroupStreakCard({
  streak,
  error = false,
  onRetry,
}: {
  streak: GroupStreakData | null | undefined;
  error?: boolean;
  onRetry?: () => void;
}) {
  const palette = useAppColors();
  const { intlLocale, t } = useI18n();

  if (error || !streak) {
    return (
      <Card variant="outlined" padding="spacious" style={styles.card}>
        <View style={styles.header}>
          <ThreeDIcon name="groupStreak" size={70} accessibilityLabel={t('groups.streakIcon')} />
          <View style={styles.flex}>
            <AppText variant="sectionTitle">{t('groups.streakTitle')}</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {t('groups.streakError')}
            </AppText>
          </View>
        </View>
        {onRetry ? (
          <AppButton
            title={t('groups.streakRetry')}
            size="sm"
            variant="outline"
            onPress={onRetry}
          />
        ) : null}
      </Card>
    );
  }

  const isNew = streak.completedRounds === 0;
  const rate = streak.within24Rate ?? 0;
  const formattedRate = new Intl.NumberFormat(intlLocale, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(rate / 100);
  const deadline = streak.nextDeadline
    ? deadlineLabel(streak.nextDeadline, intlLocale, t('common.today'))
    : null;
  const heading = streak.hasOverdue
    ? t('groups.streakRestart')
    : streak.currentStreak > 0
      ? t(streak.currentStreak === 1 ? 'groups.streakRoundSingular' : 'groups.streakRoundPlural', {
          count: streak.currentStreak,
        })
      : isNew
        ? t('groups.streakFirst')
        : t('groups.streakReady');
  const body = streak.hasOverdue
    ? t('groups.streakOverdueBody')
    : isNew
      ? t('groups.streakFirstBody')
      : t('groups.streakBody');

  return (
    <Card
      accessibilityLabel={t('groups.streakAccessibility', {
        current: streak.currentStreak,
        longest: streak.longestStreak,
      })}
      padding="spacious"
      style={[styles.card, { borderColor: palette.warning, borderWidth: StyleSheet.hairlineWidth }]}
    >
      <View style={styles.header}>
        <View style={[styles.artwork, { backgroundColor: palette.warningLight }]}>
          <ThreeDIcon name="groupStreak" size={82} accessibilityLabel={t('groups.streakIcon')} />
        </View>
        <View style={styles.flex}>
          <View style={[styles.eyebrow, { backgroundColor: palette.warningLight }]}>
            <AppText color={palette.warningInk} style={styles.eyebrowText}>
              {t('groups.streakEyebrow')}
            </AppText>
          </View>
          <AppText variant="screenTitle" numberOfLines={2}>
            {heading}
          </AppText>
          <AppText variant="caption" color={palette.textSecondary}>
            {body}
          </AppText>
        </View>
      </View>

      {streak.hasOverdue ? (
        <View style={[styles.notice, { backgroundColor: palette.warningLight }]}>
          <RotateCcw color={palette.warningInk} size={18} strokeWidth={2} />
          <AppText variant="bodySmall" color={palette.warningInk} style={styles.flex}>
            {t('groups.streakReactivate')}
          </AppText>
        </View>
      ) : deadline ? (
        <View style={[styles.notice, { backgroundColor: palette.primaryLight }]}>
          <Clock3 color={palette.primary} size={18} strokeWidth={2} />
          <AppText variant="bodySmall" color={palette.primary} style={styles.flex}>
            {t('groups.streakDeadline', { deadline })}
          </AppText>
        </View>
      ) : null}

      <View style={styles.metrics}>
        <Metric
          label={t('groups.streakCurrent')}
          value={String(streak.currentStreak)}
          accent={palette.warningInk}
        />
        <Metric
          label={t('groups.streakRecord')}
          value={String(streak.longestStreak)}
          accent={palette.primary}
          icon={<Trophy color={palette.primary} size={14} strokeWidth={2} />}
        />
        <Metric
          label={t('groups.streakWithin24')}
          value={streak.within24Rate === null ? '—' : formattedRate}
          accent={palette.successInk}
        />
      </View>

      {streak.completedRounds > 0 ? (
        <View style={styles.progress}>
          <ProgressBar value={rate / 100} color={palette.success} />
          <AppText variant="caption" color={palette.textMuted}>
            {t(
              streak.completedRounds === 1
                ? 'groups.streakProgressSingular'
                : 'groups.streakProgressPlural',
              {
                successful: streak.successfulRounds,
                total: streak.completedRounds,
              },
            )}
          </AppText>
        </View>
      ) : null}
    </Card>
  );
}

function Metric({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent: string;
  icon?: ReactNode;
}) {
  const palette = useAppColors();
  return (
    <View style={[styles.metric, { backgroundColor: palette.background }]}>
      <View style={styles.metricValueRow}>
        {icon}
        <AppText color={accent} style={styles.metricValue} tabular>
          {value}
        </AppText>
      </View>
      <AppText variant="caption" color={palette.textSecondary} style={styles.metricLabel}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { minWidth: 0, flex: 1 },
  card: { gap: spacing.lg, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  artwork: {
    width: 86,
    height: 86,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  eyebrow: {
    alignSelf: 'flex-start',
    minHeight: 24,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrowText: { fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 0.5 },
  notice: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metrics: { flexDirection: 'row', gap: spacing.sm },
  metric: {
    minWidth: 0,
    flex: 1,
    minHeight: 70,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  metricValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metricValue: { fontSize: 19, lineHeight: 23, fontWeight: '800' },
  metricLabel: { textAlign: 'center', fontSize: 10, lineHeight: 13, fontWeight: '600' },
  metricSkeleton: { minWidth: 0, flex: 1 },
  progress: { gap: spacing.sm },
});
