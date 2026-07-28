import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AlertTriangle, FileText, Scale } from 'lucide-react-native';
import { AppButton, AppText, Card, Divider, ListCard, ScreenContainer } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { useAppColors } from '@/providers/app-providers';
import { useI18n } from '@/i18n';
import { radii, spacing } from '@/theme';

function LegalSection({
  number,
  title,
  children,
  action,
}: {
  number: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const palette = useAppColors();
  return (
    <View style={styles.legalSection}>
      <View style={[styles.number, { backgroundColor: palette.primaryLight }]}>
        <AppText variant="caption" color={palette.primary} tabular>
          {number}
        </AppText>
      </View>
      <View style={styles.legalCopy}>
        <AppText variant="sectionTitle">{title}</AppText>
        <AppText color={palette.textSecondary}>{children}</AppText>
        {action}
      </View>
    </View>
  );
}

export default function TermsScreen() {
  const router = useRouter();
  const palette = useAppColors();
  const { t } = useI18n();

  return (
    <ScreenContainer publicPage>
      <PageHeader title={t('terms.title')} subtitle={t('terms.subtitle')} />

      <Card
        variant="outlined"
        padding="spacious"
        style={[
          styles.notice,
          { borderColor: palette.warning, backgroundColor: palette.warningLight },
        ]}
      >
        <View style={[styles.noticeIcon, { backgroundColor: palette.surface }]}>
          <FileText color={palette.warningInk} size={24} />
        </View>
        <View style={styles.flex}>
          <AppText variant="sectionTitle" color={palette.warningInk}>
            {t('terms.provisionalTitle')}
          </AppText>
          <AppText color={palette.textPrimary}>{t('terms.provisionalBody')}</AppText>
        </View>
      </Card>

      <ListCard>
        <LegalSection number="01" title={t('terms.whatTitle')}>
          {t('terms.whatBody')}
        </LegalSection>
        <Divider inset={68} />
        <LegalSection number="02" title={t('terms.externalPaymentTitle')}>
          {t('terms.externalPaymentBody')}
        </LegalSection>
        <Divider inset={68} />
        <LegalSection number="03" title={t('terms.privateLinksTitle')}>
          {t('terms.privateLinksBody')}
        </LegalSection>
        <Divider inset={68} />
        <LegalSection number="04" title={t('terms.acceptableUseTitle')}>
          {t('terms.acceptableUseBody')}
        </LegalSection>
        <Divider inset={68} />
        <LegalSection number="05" title={t('terms.liabilityTitle')}>
          {t('terms.liabilityBody')}
        </LegalSection>
        <Divider inset={68} />
        <LegalSection
          number="06"
          title={t('terms.privacyTitle')}
          action={
            <AppButton
              title={t('terms.readPrivacy')}
              variant="outline"
              size="lg"
              fullWidth
              onPress={() => router.push('/settings/privacy')}
            />
          }
        >
          {t('terms.privacyBody')}
        </LegalSection>
      </ListCard>

      <Card
        variant="outlined"
        padding="spacious"
        style={[
          styles.notice,
          { borderColor: palette.warning, backgroundColor: palette.warningLight },
        ]}
      >
        <View style={[styles.noticeIcon, { backgroundColor: palette.surface }]}>
          <AlertTriangle color={palette.warningInk} size={24} />
        </View>
        <View style={styles.flex}>
          <View style={styles.contactHeading}>
            <Scale color={palette.warningInk} size={19} />
            <AppText variant="sectionTitle" color={palette.warningInk}>
              {t('terms.legalContact')}
            </AppText>
          </View>
          <AppText color={palette.textSecondary}>{t('terms.legalContactBody')}</AppText>
        </View>
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: spacing.xs },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  noticeIcon: {
    width: 46,
    height: 46,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legalSection: {
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  number: {
    width: 40,
    height: 32,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legalCopy: { flex: 1, gap: spacing.md },
  contactHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
