import { Check, ReceiptText, Sparkles } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { AppButton, AppText, Card, Divider, ScreenContainer } from '@/components/ui';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { useAppColors } from '@/providers/app-providers';
import { useI18n } from '@/i18n';
import { radii, spacing } from '@/theme';

export default function SubscriptionScreen() {
  const palette = useAppColors();
  const { t } = useI18n();
  const features = [
    t('subscription.moreScans'),
    t('subscription.reminders'),
    t('subscription.exports'),
  ];
  return (
    <RequireAuth>
      <ScreenContainer>
        <PageHeader title={t('settings.subscriptionTitle')} />

        <Card
          variant="flat"
          padding="spacious"
          style={[styles.currentPlan, { backgroundColor: palette.primaryLight }]}
        >
          <View style={styles.planHeading}>
            <View style={[styles.planIcon, { backgroundColor: palette.surface }]}>
              <ReceiptText color={palette.primary} size={28} strokeWidth={2} />
            </View>
            <View style={styles.flex}>
              <View style={styles.planTitleRow}>
                <AppText variant="screenTitle" color={palette.primary}>
                  {t('subscription.freePlan')}
                </AppText>
                <View style={[styles.badge, { backgroundColor: palette.surface }]}>
                  <AppText variant="caption" color={palette.primary}>
                    {t('subscription.current')}
                  </AppText>
                </View>
              </View>
              <AppText color={palette.textPrimary}>{t('subscription.freeBody')}</AppText>
            </View>
          </View>
          <View style={[styles.allowance, { backgroundColor: palette.surface }]}>
            <AppText variant="metric" color={palette.primary} tabular>
              3
            </AppText>
            <View style={styles.flex}>
              <AppText variant="label">{t('subscription.scans')}</AppText>
              <AppText variant="caption" color={palette.textSecondary}>
                {t('subscription.included')}
              </AppText>
            </View>
          </View>
        </Card>

        <Card padding="spacious" style={styles.plusCard}>
          <View style={styles.plusHeading}>
            <View style={[styles.planIcon, { backgroundColor: palette.successLight }]}>
              <Sparkles color={palette.successInk} size={26} strokeWidth={2} />
            </View>
            <View style={styles.flex}>
              <AppText variant="screenTitle">{t('subscription.plusTitle')}</AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                {t('subscription.plusBody')}
              </AppText>
            </View>
          </View>
          <View style={styles.features}>
            {features.map((item, index) => (
              <View key={item}>
                <View style={styles.row}>
                  <View style={[styles.check, { backgroundColor: palette.successLight }]}>
                    <Check color={palette.successInk} size={17} strokeWidth={2.6} />
                  </View>
                  <AppText style={styles.flex}>{item}</AppText>
                </View>
                {index < features.length - 1 ? <Divider inset={42} /> : null}
              </View>
            ))}
          </View>
          <AppButton title={t('subscription.notifyMe')} size="lg" fullWidth disabled />
        </Card>
      </ScreenContainer>
    </RequireAuth>
  );
}
const styles = StyleSheet.create({
  flex: { flex: 1 },
  currentPlan: { gap: spacing.lg },
  planHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  planIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  badge: { borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  allowance: {
    borderRadius: radii.control,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  plusCard: { gap: spacing.xl },
  plusHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  features: { gap: 0 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  check: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
