import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MailCheck, ShieldCheck } from 'lucide-react-native';
import { AppButton, AppText, Card, ScreenContainer } from '@/components/ui';
import { getSafeInviteRedirect } from '@/lib/navigation';
import { getSupabase } from '@/lib/supabase/client';
import { useAppColors } from '@/providers/app-providers';
import { spacing } from '@/theme';

type ConfirmationType = 'email' | 'recovery';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function ConfirmAuthEmailScreen() {
  const palette = useAppColors();
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
  const error = invalidLink ? 'El enlace no es válido o está incompleto.' : verificationError;

  useEffect(() => {
    let active = true;

    if (!tokenHash || tokenHash.length > 512 || !type) return;

    void (async () => {
      try {
        const { data, error: authError } = await getSupabase().auth.verifyOtp({
          token_hash: tokenHash,
          type,
        });
        if (!active) return;
        if (authError || !data.session) {
          setVerificationError('El enlace ha caducado o ya se ha utilizado. Solicita uno nuevo.');
          return;
        }

        if (type === 'recovery') {
          router.replace('/(auth)/reset-password');
          return;
        }

        const next = getSafeInviteRedirect(data.user?.user_metadata?.pending_next);
        router.replace(
          next ? { pathname: '/(auth)/onboarding', params: { next } } : '/(auth)/onboarding',
        );
      } catch {
        if (active) {
          setVerificationError('No hemos podido comprobar el enlace. Inténtalo de nuevo.');
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [router, tokenHash, type]);

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
            {error ? 'No se pudo abrir el enlace' : 'Comprobando tu correo'}
          </AppText>
          <AppText
            accessibilityRole={error ? 'alert' : undefined}
            accessibilityLiveRegion={error ? 'assertive' : 'polite'}
            color={error ? palette.dangerInk : palette.textSecondary}
            style={styles.center}
          >
            {error ?? 'Estamos verificando este enlace seguro de un solo uso.'}
          </AppText>
        </View>

        {error ? (
          <AppButton
            title={type === 'recovery' ? 'Solicitar otro enlace' : 'Volver a iniciar sesión'}
            size="lg"
            fullWidth
            onPress={() =>
              router.replace(type === 'recovery' ? '/(auth)/forgot-password' : '/(auth)/login')
            }
          />
        ) : (
          <ActivityIndicator
            accessibilityLabel="Verificando enlace"
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
