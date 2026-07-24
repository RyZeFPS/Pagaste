import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { CheckCircle2, Circle, ShieldCheck, UserPlus } from 'lucide-react-native';
import { AppButton, AppInput, AppText, Card, ScreenContainer } from '@/components/ui';
import { BrandLogo } from '@/components/brand-logo';
import { PasswordField } from '@/components/password-field';
import { AuthScreenSkeleton } from '@/components/loading-skeletons';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import {
  AUTH_PASSWORD_MIN_LENGTH,
  authErrorMessage,
  passwordChecks,
  signUpSchema,
} from '@/lib/auth-validation';
import { getSafeInviteRedirect } from '@/lib/navigation';
import { radii, spacing } from '@/theme';

type Form = {
  email: string;
  password: string;
  passwordConfirmation: string;
};

export default function SignUpScreen() {
  const auth = useAuth();
  const router = useRouter();
  const palette = useAppColors();
  const { next: requestedNext } = useLocalSearchParams<{ next?: string | string[] }>();
  const next = getSafeInviteRedirect(requestedNext);
  const [serverError, setServerError] = useState<string>();
  const {
    control,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    defaultValues: { email: '', password: '', passwordConfirmation: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });
  const checks = passwordChecks(useWatch({ control, name: 'password' }));

  if (auth.loading) return <AuthScreenSkeleton />;
  if (auth.session) {
    return (
      <Redirect
        href={next ? { pathname: '/(auth)/onboarding', params: { next } } : '/(auth)/onboarding'}
      />
    );
  }

  const submit = handleSubmit(async (values) => {
    const parsed = signUpSchema.safeParse(values);
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
      const result = await auth.signUpWithPassword(parsed.data.email, parsed.data.password, {
        next,
      });
      if (result.confirmationRequired) {
        router.replace({
          pathname: '/(auth)/verify',
          params: {
            email: parsed.data.email,
            mode: 'signup',
            ...(next ? { next } : {}),
          },
        });
        return;
      }
      router.replace(
        next ? { pathname: '/(auth)/onboarding', params: { next } } : '/(auth)/onboarding',
      );
    } catch (error) {
      setServerError(authErrorMessage(error, 'signup'));
    }
  });

  return (
    <ScreenContainer publicPage contentContainerStyle={styles.screen}>
      <View style={styles.content}>
        <View style={styles.brand} accessibilityRole="header">
          <BrandLogo variant="horizontal" width={200} testID="pagaste-brand-logo" />
          <AppText variant="caption" color={palette.textSecondary}>
            Escanea, reparte y cobra.
          </AppText>
        </View>

        <Card padding="spacious" style={styles.formCard}>
          <View style={styles.heading}>
            <View style={[styles.headingIcon, { backgroundColor: palette.primaryLight }]}>
              <UserPlus color={palette.primary} size={24} />
            </View>
            <View style={styles.headingCopy}>
              <AppText accessibilityRole="header" variant="screenTitle">
                Crea tu cuenta
              </AppText>
              <AppText color={palette.textSecondary}>
                Utiliza un correo al que tengas acceso y una contraseña única.
              </AppText>
            </View>
          </View>

          <Controller
            control={control}
            name="email"
            render={({ field: { ref, value, onChange, onBlur } }) => (
              <AppInput
                ref={ref}
                testID="signup-email"
                label="Correo electrónico"
                placeholder="tu@correo.com"
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
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
                testID="signup-password"
                label="Contraseña"
                placeholder="Crea una contraseña"
                textContentType="newPassword"
                autoComplete="new-password"
                enterKeyHint="next"
                value={value}
                onChangeText={(text) => {
                  setServerError(undefined);
                  onChange(text);
                }}
                onBlur={onBlur}
                onSubmitEditing={() => setFocus('passwordConfirmation')}
                error={errors.password?.message}
              />
            )}
          />

          <View
            accessibilityLabel={`Requisitos de contraseña: ${Object.values(checks).filter(Boolean).length} de 4 cumplidos`}
            style={[styles.requirements, { backgroundColor: palette.background }]}
          >
            <PasswordRequirement
              passed={checks.length}
              label={`${AUTH_PASSWORD_MIN_LENGTH} caracteres como mínimo`}
            />
            <PasswordRequirement passed={checks.lowercase} label="Una letra minúscula" />
            <PasswordRequirement passed={checks.uppercase} label="Una letra mayúscula" />
            <PasswordRequirement passed={checks.number} label="Un número" />
          </View>

          <Controller
            control={control}
            name="passwordConfirmation"
            render={({ field: { ref, value, onChange, onBlur } }) => (
              <PasswordField
                ref={ref}
                testID="signup-password-confirmation"
                label="Repite la contraseña"
                placeholder="Repite tu contraseña"
                textContentType="newPassword"
                autoComplete="new-password"
                enterKeyHint="done"
                value={value}
                onChangeText={(text) => {
                  setServerError(undefined);
                  onChange(text);
                }}
                onBlur={onBlur}
                onSubmitEditing={() => void submit()}
                error={errors.passwordConfirmation?.message}
              />
            )}
          />

          {serverError ? (
            <View
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={[styles.errorMessage, { backgroundColor: palette.dangerLight }]}
            >
              <AppText variant="bodySmall" color={palette.dangerInk}>
                {serverError}
              </AppText>
            </View>
          ) : null}

          <AppButton
            testID="signup-submit"
            title="Crear cuenta"
            size="lg"
            fullWidth
            loading={isSubmitting}
            leftIcon={<UserPlus color={palette.white} size={20} />}
            onPress={submit}
          />

          <View style={styles.legalCopy}>
            <ShieldCheck color={palette.textMuted} size={17} />
            <AppText variant="caption" color={palette.textSecondary} style={styles.flex}>
              Al crear la cuenta aceptas las condiciones de uso y la política de privacidad.
            </AppText>
          </View>
          <View style={styles.legalLinks}>
            <AppButton
              title="Condiciones"
              variant="ghost"
              size="sm"
              onPress={() => router.push('/settings/terms')}
            />
            <AppButton
              title="Privacidad"
              variant="ghost"
              size="sm"
              onPress={() => router.push('/settings/privacy')}
            />
          </View>
        </Card>

        <View style={styles.signInRow}>
          <AppText color={palette.textSecondary}>¿Ya tienes cuenta?</AppText>
          <AppButton
            title="Iniciar sesión"
            variant="outline"
            size="sm"
            onPress={() =>
              router.replace(
                next ? { pathname: '/(auth)/login', params: { next } } : '/(auth)/login',
              )
            }
          />
        </View>
      </View>
    </ScreenContainer>
  );
}

function PasswordRequirement({ passed, label }: { passed: boolean; label: string }) {
  const palette = useAppColors();
  return (
    <View
      accessible
      accessibilityLabel={`${passed ? 'Cumplido' : 'Pendiente'}: ${label}`}
      style={styles.requirement}
    >
      {passed ? (
        <CheckCircle2 accessible={false} color={palette.successInk} size={16} />
      ) : (
        <Circle accessible={false} color={palette.textMuted} size={16} />
      )}
      <AppText
        variant="caption"
        color={passed ? palette.successInk : palette.textSecondary}
        style={styles.flex}
      >
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'center' },
  content: { width: '100%', gap: spacing.lg },
  flex: { flex: 1 },
  brand: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  formCard: { gap: spacing.md },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  headingIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingCopy: { flex: 1, gap: spacing.xs },
  requirements: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  requirement: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  errorMessage: {
    minHeight: 44,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  legalCopy: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  legalLinks: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  signInRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
});
