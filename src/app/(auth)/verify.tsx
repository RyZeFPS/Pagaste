import { StyleSheet, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { MailCheck, ReceiptText, ShieldCheck } from 'lucide-react-native';
import { AppButton, AppText, Card, ScreenContainer } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { getSafeInviteRedirect } from '@/lib/navigation';
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
          <View style={[styles.brandMark, { backgroundColor: palette.primary }]}>
            <ReceiptText color={palette.white} size={22} strokeWidth={2.2} />
          </View>
          <View>
            <AppText variant="screenTitle" color={palette.primary}>
              Pagaste
            </AppText>
            <AppText variant="caption" color={palette.textSecondary}>
              Escanea, reparte y cobra.
            </AppText>
          </View>
        </View>

        <View
          accessibilityRole="image"
          accessibilityLabel="Correo enviado correctamente"
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
              {isReset ? 'Revisa tu correo' : 'Confirma tu correo'}
            </AppText>
            <AppText color={palette.textSecondary} style={styles.center}>
              {isReset
                ? 'Si existe una cuenta con ese correo, recibirás un enlace para crear una contraseña nueva.'
                : 'Te hemos enviado un enlace para confirmar que el correo te pertenece.'}
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
              El enlace es personal. No lo compartas con nadie y ábrelo en este dispositivo.
            </AppText>
          </View>

          <AppText variant="caption" color={palette.textSecondary} style={styles.center}>
            Puede tardar unos minutos. Revisa también la carpeta de correo no deseado.
          </AppText>

          <AppButton
            title="Volver a iniciar sesión"
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
  brand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  brandMark: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-3deg' }],
  },
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
