import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MailCheck, ShieldCheck } from 'lucide-react-native';
import { AppButton, AppText, Card, ScreenContainer } from '@/components/ui';
import { getSafeInviteRedirect } from '@/lib/navigation';
import { getSupabase } from '@/lib/supabase/client';
import { useAppColors } from '@/providers/app-providers';
import { useAuth } from '@/providers/auth-provider';
import { useI18n } from '@/i18n';
import { spacing } from '@/theme';

type ConfirmationType = 'email' | 'recovery';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function ConfirmAuthEmailScreen() {
  const auth = useAuth();
  const { completePasswordRecovery } = auth;
  const palette = useAppColors();
  const { t } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{
    token_hash?: string | string[];
    type?: string | string[];
  }>();
  const tokenHash = first(params.token_hash);
  const rawType = first(params.type);
  const type: ConfirmationType | undefined =
    rawType === 'email' || rawType === 'recovery' ? rawType : undefined;
  const invalidLink = !tokenHash || tokenHash.length > 512 || !type;
  const [verificationError, setVerificationError] = useState<string>();
  const error = invalidLink ? t('auth.callbackInvalid') : verificationError;

  useEffect(() => {
    let active = true;

    if (!tokenHash || tokenHash.length > 512 || !type) return;

    void (async () => {
      try {
        if (type === 'recovery') {
          await completePasswordRecovery({ tokenHash });
          if (active) router.replace('/(auth)/reset-password');
          return;
        }

        const { data, error: authError } = await getSupabase().auth.verifyOtp({
          token_hash: tokenHash,
          type,
        });
        if (!active) return;
        if (authError || !data.session) {
          setVerificationError(t('auth.callbackExpired'));
          return;
        }

        const next = getSafeInviteRedirect(data.user?.user_metadata?.pending_next);
        router.replace(
          next ? { pathname: '/(auth)/onboarding', params: { next } } : '/(auth)/onboarding',
        );
      } catch {
        if (active) {
          setVerificationError(t('auth.callbackFailed'));
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [completePasswordRecovery, router, t, tokenHash, type]);

  return (
    <ScreenContainer publicPage contentContainerStyle={styles.screen}>
      <Card padding="spacious" style={styles.card}>
        <View
          accessible={false}
          style={[
            styles.icon,
            { backgroundColor: error ? palette.dangerLight : palette.primaryLight },
          ]}
        >
          {error ? (
            <MailCheck color={palette.dangerInk} size={34} strokeWidth={2} />
          ) : (
            <ShieldCheck color={palette.primary} size={34} strokeWidth={2} />
          )}
        </View>

        <View style={styles.copy}>
          <AppText accessibilityRole="header" variant="screenTitle" style={styles.center}>
            {t(error ? 'auth.callbackErrorTitle' : 'auth.callbackCheckingTitle')}
          </AppText>
          <AppText
            accessibilityRole={error ? 'alert' : undefined}
            accessibilityLiveRegion={error ? 'assertive' : 'polite'}
            color={error ? palette.dangerInk : palette.textSecondary}
            style={styles.center}
          >
            {error ?? t('auth.callbackCheckingBody')}
          </AppText>
        </View>

        {error ? (
          <AppButton
            title={t(type === 'recovery' ? 'auth.requestNewLink' : 'auth.backToLogin')}
            size="lg"
            fullWidth
            onPress={() =>
              router.replace(type === 'recovery' ? '/(auth)/forgot-password' : '/(auth)/login')
            }
          />
        ) : (
          <ActivityIndicator
            accessibilityLabel={t('auth.callbackCheckingA11y')}
            color={palette.primary}
            size="large"
          />
        )}
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'center' },
  card: { alignItems: 'center', gap: spacing.xl },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { gap: spacing.sm },
  center: { textAlign: 'center' },
});
