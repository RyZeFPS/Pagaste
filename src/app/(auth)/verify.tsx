import { StyleSheet, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { MailCheck, ShieldCheck } from 'lucide-react-native';
import { AppButton, AppText, Card, ScreenContainer } from '@/components/ui';
import { BrandLogo } from '@/components/brand-logo';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { getSafeInviteRedirect } from '@/lib/navigation';
import { useI18n } from '@/i18n';
import { radii, spacing } from '@/theme';

export default function VerifyScreen() {
  const params = useLocalSearchParams<{
    email?: string | string[];
    mode?: string | string[];
    next?: string | string[];
  }>();
  const email = typeof params.email === 'string' ? params.email : '';
  const mode = params.mode === 'reset' ? 'reset' : 'signup';
  const next = getSafeInviteRedirect(params.next);
  const auth = useAuth();
  const router = useRouter();
  const palette = useAppColors();
  const { t } = useI18n();

  if (mode === 'reset' && auth.session && auth.passwordRecovery) {
    return <Redirect href="/(auth)/reset-password" />;
  }
  if (mode === 'signup' && auth.session) {
    return (
      <Redirect
        href={next ? { pathname: '/(auth)/onboarding', params: { next } } : '/(auth)/onboarding'}
      />
    );
  }

  const isReset = mode === 'reset';
  return (
    <ScreenContainer publicPage contentContainerStyle={styles.screen}>
      <View style={styles.content}>
        <View style={styles.brand} accessibilityRole="header">
          <BrandLogo variant="horizontal" width={200} testID="pagaste-brand-logo" />
          <AppText variant="caption" color={palette.textSecondary}>
            {t('app.tagline')}
          </AppText>
        </View>

        <View
          accessibilityRole="image"
          accessibilityLabel={t('auth.emailSentA11y')}
          style={[styles.illustration, { backgroundColor: palette.primaryLight }]}
        >
          <View style={[styles.mailHalo, { borderColor: palette.primary }]} />
          <View style={[styles.mailCircle, { backgroundColor: palette.surface }]}>
            <MailCheck color={palette.primary} size={48} strokeWidth={1.8} />
          </View>
        </View>

        <Card padding="spacious" style={styles.card}>
          <View accessibilityLiveRegion="polite" style={styles.heading}>
            <AppText accessibilityRole="header" variant="screenTitle" style={styles.center}>
              {t(isReset ? 'auth.resetCheckTitle' : 'auth.confirmEmailTitle')}
            </AppText>
            <AppText color={palette.textSecondary} style={styles.center}>
              {t(isReset ? 'auth.resetNeutralBody' : 'auth.confirmEmailBody')}
            </AppText>
            {email ? (
              <AppText variant="label" color={palette.primary} style={styles.center}>
                {email}
              </AppText>
            ) : null}
          </View>

          <View style={[styles.securityNote, { backgroundColor: palette.successLight }]}>
            <ShieldCheck color={palette.successInk} size={18} />
            <AppText variant="caption" color={palette.successInk} style={styles.flex}>
              {t('auth.personalLink')}
            </AppText>
          </View>

          <AppText variant="caption" color={palette.textSecondary} style={styles.center}>
            {t('auth.emailDelay')}
          </AppText>

          <AppButton
            title={t('auth.backToLogin')}
            variant="outline"
            size="lg"
            fullWidth
            onPress={() =>
              router.replace(
                next ? { pathname: '/(auth)/login', params: { next } } : '/(auth)/login',
              )
            }
          />
        </Card>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'center' },
  content: { width: '100%', gap: spacing.xl },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  brand: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  illustration: {
    height: 154,
    borderRadius: radii.card,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  mailHalo: {
    position: 'absolute',
    width: 126,
    height: 126,
    borderRadius: 63,
    borderWidth: 1,
    opacity: 0.16,
  },
  mailCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { gap: spacing.lg },
  heading: { gap: spacing.sm },
  securityNote: {
    minHeight: 52,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
