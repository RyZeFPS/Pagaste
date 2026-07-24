import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { LockKeyhole, LogIn, ReceiptText, ScanLine, ShieldCheck } from 'lucide-react-native';
import { AppButton, AppInput, AppText, Card, ScreenContainer } from '@/components/ui';
import { BrandLogo } from '@/components/brand-logo';
import { PasswordField } from '@/components/password-field';
import { AuthScreenSkeleton } from '@/components/loading-skeletons';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { authErrorMessage, loginSchema } from '@/lib/auth-validation';
import { getSafeInviteRedirect } from '@/lib/navigation';
import { radii, spacing } from '@/theme';

type Form = {
  email: string;
  password: string;
};

export default function LoginScreen() {
  const auth = useAuth();
  const router = useRouter();
  const { next: requestedNext } = useLocalSearchParams<{ next?: string | string[] }>();
  const next = getSafeInviteRedirect(requestedNext);
  const palette = useAppColors();
  const [serverError, setServerError] = useState<string>();
  const {
    control,
    handleSubmit,
    setError,
    setFocus,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    defaultValues: { email: '', password: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  if (auth.loading) return <AuthScreenSkeleton />;
  if (auth.session) {
    if (!auth.profile?.onboarding_completed) {
      return (
        <Redirect
          href={next ? { pathname: '/(auth)/onboarding', params: { next } } : '/(auth)/onboarding'}
        />
      );
    }
    return <Redirect href={next ?? '/(tabs)'} />;
  }

  const submit = handleSubmit(async (values) => {
    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      const firstField = parsed.error.issues[0]?.path[0] as keyof Form | undefined;
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof Form | undefined;
        if (field) setError(field, { message: issue.message });
      }
      if (firstField) setFocus(firstField);
      return;
    }

    setServerError(undefined);
    try {
      await auth.signInWithPassword(parsed.data.email, parsed.data.password);
      router.replace(
        next ? { pathname: '/(auth)/onboarding', params: { next } } : '/(auth)/onboarding',
      );
    } catch (error) {
      setServerError(authErrorMessage(error, 'login'));
    }
  });

  return (
    <ScreenContainer publicPage contentContainerStyle={styles.screen}>
      <View style={styles.content}>
        <View style={styles.brand} accessibilityRole="header">
          <BrandLogo variant="horizontal" width={226} testID="pagaste-brand-logo" />
          <AppText variant="label" color={palette.textSecondary}>
            Escanea, reparte y cobra.
          </AppText>
        </View>

        <View
          accessible={false}
          importantForAccessibility="no"
          style={[styles.illustration, { backgroundColor: palette.primaryLight }]}
        >
          <View style={[styles.orbit, styles.orbitLeft, { borderColor: palette.primary }]} />
          <View style={[styles.receipt, { backgroundColor: palette.surface }]}>
            <ReceiptText color={palette.primary} size={30} />
            <View style={[styles.receiptLine, { backgroundColor: palette.divider }]} />
            <View style={[styles.receiptLineShort, { backgroundColor: palette.divider }]} />
          </View>
          <ScanLine color={palette.primary} size={88} strokeWidth={1.25} style={styles.scanner} />
          <View style={[styles.lockBubble, { backgroundColor: palette.success }]}>
            <LockKeyhole color={palette.white} size={18} strokeWidth={2.5} />
          </View>
        </View>

        <Card padding="spacious" style={styles.formCard}>
          <View style={styles.formHeading}>
            <AppText accessibilityRole="header" variant="screenTitle">
              Inicia sesión
            </AppText>
            <AppText color={palette.textSecondary}>
              Accede con tu correo y tu contraseña de Pagaste.
            </AppText>
          </View>

          <Controller
            control={control}
            name="email"
            render={({ field: { ref, value, onChange, onBlur } }) => (
              <AppInput
                ref={ref}
                testID="login-email"
                label="Correo electrónico"
                placeholder="tu@correo.com"
                keyboardType="email-address"
                textContentType="emailAddress"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="email"
                enterKeyHint="next"
                maxLength={254}
                value={value}
                onChangeText={(text) => {
                  setServerError(undefined);
                  onChange(text);
                }}
                onBlur={onBlur}
                onSubmitEditing={() => setFocus('password')}
                error={errors.email?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="password"
            render={({ field: { ref, value, onChange, onBlur } }) => (
              <PasswordField
                ref={ref}
                testID="login-password"
                label="Contraseña"
                placeholder="Tu contraseña"
                textContentType="password"
                autoComplete="current-password"
                enterKeyHint="go"
                value={value}
                onChangeText={(text) => {
                  setServerError(undefined);
                  onChange(text);
                }}
                onBlur={onBlur}
                onSubmitEditing={() => void submit()}
                error={errors.password?.message}
              />
            )}
          />

          <AppButton
            title="He olvidado mi contraseña"
            variant="ghost"
            size="sm"
            accessibilityHint="Envía instrucciones para crear una contraseña nueva"
            style={styles.forgotButton}
            onPress={() => {
              const email = getValues('email').trim();
              router.push({
                pathname: '/(auth)/forgot-password',
                params: email ? { email } : undefined,
              });
            }}
          />

          {serverError ? (
            <View
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={[styles.errorMessage, { backgroundColor: palette.dangerLight }]}
            >
              <AppText variant="bodySmall" color={palette.dangerInk} style={styles.flex}>
                {serverError}
              </AppText>
            </View>
          ) : null}

          <AppButton
            testID="login-submit"
            title="Entrar"
            size="lg"
            fullWidth
            leftIcon={<LogIn color={palette.white} size={20} />}
            loading={isSubmitting}
            onPress={submit}
          />

          <View style={[styles.securityNote, { backgroundColor: palette.primaryLight }]}>
            <ShieldCheck color={palette.primary} size={18} />
            <AppText variant="caption" color={palette.textSecondary} style={styles.flex}>
              Tu contraseña se transmite cifrada y nunca se guarda en el dispositivo.
            </AppText>
          </View>

          <View style={styles.createAccount}>
            <AppText color={palette.textSecondary}>¿Aún no tienes cuenta?</AppText>
            <AppButton
              title="Crear cuenta"
              variant="outline"
              size="sm"
              onPress={() =>
                router.push(
                  next ? { pathname: '/(auth)/signup', params: { next } } : '/(auth)/signup',
                )
              }
            />
          </View>
        </Card>

        <View style={styles.legalLinks}>
          <AppButton
            title="Condiciones de uso"
            variant="ghost"
            size="sm"
            onPress={() => router.push('/settings/terms')}
          />
          <View style={[styles.legalDot, { backgroundColor: palette.textMuted }]} />
          <AppButton
            title="Privacidad"
            variant="ghost"
            size="sm"
            onPress={() => router.push('/settings/privacy')}
          />
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'center' },
  content: { width: '100%', gap: spacing.lg },
  flex: { flex: 1 },
  brand: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  illustration: {
    height: 112,
    borderRadius: radii.card,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  orbit: { position: 'absolute', width: 104, height: 104, borderRadius: 52, borderWidth: 1 },
  orbitLeft: { left: -32, bottom: -44, opacity: 0.16 },
  receipt: {
    width: 104,
    height: 76,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
    transform: [{ rotate: '-3deg' }],
  },
  receiptLine: { height: 5, width: '100%', borderRadius: radii.pill },
  receiptLineShort: { height: 5, width: '64%', borderRadius: radii.pill },
  scanner: { position: 'absolute', opacity: 0.25 },
  lockBubble: {
    position: 'absolute',
    right: '31%',
    bottom: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  formCard: { gap: spacing.md },
  formHeading: { gap: spacing.sm, marginBottom: spacing.xs },
  forgotButton: { alignSelf: 'flex-end', marginTop: -spacing.xs },
  errorMessage: {
    minHeight: 44,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  securityNote: {
    minHeight: 44,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  createAccount: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  legalLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  legalDot: { width: 3, height: 3, borderRadius: radii.pill },
});
