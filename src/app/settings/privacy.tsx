import { useState, type ReactNode } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  FileCheck2,
  FileText,
  Link2,
  Phone,
  ScanText,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react-native';
import { AppButton, AppText, Card, Divider, ListCard, ScreenContainer } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { useAppColors } from '@/providers/app-providers';
import { useI18n } from '@/i18n';
import { useAuth } from '@/providers/auth-provider';
import { repository } from '@/lib/repository';
import { radii, spacing } from '@/theme';

function PrivacySection({
  icon,
  title,
  children,
  primaryText,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  primaryText?: boolean;
}) {
  const palette = useAppColors();
  return (
    <View style={styles.section}>
      <View style={[styles.iconBubble, { backgroundColor: palette.primaryLight }]}>{icon}</View>
      <View style={styles.sectionCopy}>
        <AppText variant="sectionTitle">{title}</AppText>
        <AppText color={primaryText ? palette.textPrimary : palette.textSecondary}>
          {children}
        </AppText>
      </View>
    </View>
  );
}

export default function PrivacyScreen() {
  const router = useRouter();
  const palette = useAppColors();
  const { t } = useI18n();
  const { profile, refreshProfile, user } = useAuth();
  const [pendingOcrConsent, setPendingOcrConsent] = useState<boolean>();
  const [savingConsent, setSavingConsent] = useState(false);
  const [consentMessage, setConsentMessage] = useState<string>();
  const ocrConsent = pendingOcrConsent ?? profile?.ocr_learning_consent ?? false;

  const changeOcrConsent = async (nextValue: boolean) => {
    if (!user || savingConsent) return;
    setPendingOcrConsent(nextValue);
    setSavingConsent(true);
    setConsentMessage(undefined);
    try {
      await repository.saveProfile(user.id, { ocr_learning_consent: nextValue });
      await refreshProfile();
      setPendingOcrConsent(undefined);
      setConsentMessage(
        t(nextValue ? 'privacy.ocrLearningEnabled' : 'privacy.ocrLearningDisabled'),
      );
    } catch {
      setPendingOcrConsent(undefined);
      setConsentMessage(t('privacy.ocrLearningError'));
    } finally {
      setSavingConsent(false);
    }
  };

  return (
    <ScreenContainer publicPage>
      <PageHeader title={t('privacy.title')} />

      <View style={[styles.hero, { backgroundColor: palette.primaryLight }]}>
        <View style={[styles.heroIcon, { backgroundColor: palette.surface }]}>
          <ShieldCheck color={palette.primary} size={30} strokeWidth={2} />
        </View>
        <View style={styles.flex}>
          <AppText variant="sectionTitle">{t('privacy.heroTitle')}</AppText>
          <AppText variant="bodySmall" color={palette.textSecondary}>
            {t('privacy.heroBody')}
          </AppText>
        </View>
      </View>

      <ListCard>
        <PrivacySection
          title={t('privacy.receiptsTitle')}
          icon={<FileCheck2 color={palette.primary} size={22} />}
        >
          {t('privacy.receiptsBody')}
        </PrivacySection>
        <Divider inset={76} />
        <PrivacySection
          title={t('privacy.linksTitle')}
          icon={<Link2 color={palette.primary} size={22} />}
        >
          {t('privacy.linksBody')}
        </PrivacySection>
        <Divider inset={76} />
        <PrivacySection
          title={t('privacy.phoneTitle')}
          icon={<Phone color={palette.primary} size={22} />}
        >
          {t('privacy.phoneBody')}
        </PrivacySection>
        <Divider inset={76} />
        <PrivacySection
          title={t('privacy.ocrTitle')}
          icon={<ScanText color={palette.primary} size={22} />}
        >
          {t('privacy.ocrBody')}
        </PrivacySection>
        <Divider inset={76} />
        <PrivacySection
          title={t('privacy.rightsTitle')}
          icon={<UserRoundCheck color={palette.primary} size={22} />}
          primaryText
        >
          {t('privacy.rightsBody')}
        </PrivacySection>
      </ListCard>

      {user ? (
        <Card padding="spacious" style={styles.learningCard}>
          <View style={styles.learningRow}>
            <View style={[styles.iconBubble, { backgroundColor: palette.successLight }]}>
              <ScanText color={palette.successInk} size={22} />
            </View>
            <View style={styles.flex}>
              <AppText variant="sectionTitle">{t('privacy.ocrLearningTitle')}</AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                {t('privacy.ocrLearningBody')}
              </AppText>
            </View>
            <Switch
              accessibilityLabel={t('privacy.ocrLearningA11y')}
              disabled={savingConsent}
              value={ocrConsent}
              onValueChange={(value) => void changeOcrConsent(value)}
              ios_backgroundColor={palette.divider}
              thumbColor={palette.surface}
              trackColor={{ false: palette.disabled, true: palette.success }}
            />
          </View>
          {consentMessage ? (
            <AppText
              variant="caption"
              color={
                consentMessage === t('privacy.ocrLearningError')
                  ? palette.danger
                  : palette.successInk
              }
            >
              {consentMessage}
            </AppText>
          ) : null}
        </Card>
      ) : null}

      <Card padding="spacious" style={styles.actionsCard}>
        <View style={styles.actionHeading}>
          <View style={[styles.iconBubble, { backgroundColor: palette.successLight }]}>
            <FileText color={palette.successInk} size={22} />
          </View>
          <View style={styles.flex}>
            <AppText variant="sectionTitle">{t('privacy.controlsTitle')}</AppText>
            <AppText color={palette.textSecondary}>{t('privacy.controlsBody')}</AppText>
          </View>
        </View>
        <AppButton
          title={t('privacy.termsAction')}
          variant="outline"
          size="lg"
          fullWidth
          onPress={() => router.push('./terms')}
        />
        <AppButton
          title={t('privacy.accountAction')}
          variant="secondary"
          size="lg"
          fullWidth
          onPress={() => router.push('/settings/account')}
        />
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: {
    borderRadius: radii.card,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  heroIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  iconBubble: {
    width: 44,
    height: 44,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionCopy: { flex: 1, gap: spacing.xs },
  actionsCard: { gap: spacing.md },
  actionHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  learningCard: { gap: spacing.sm },
  learningRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
