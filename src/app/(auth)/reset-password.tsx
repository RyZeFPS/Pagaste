import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Check, CheckCircle2, Circle, KeyRound, ShieldCheck } from 'lucide-react-native';
import { PageHeader } from '@/components/app-shell';
import { AppButton, AppText, Card, EmptyState, ScreenContainer } from '@/components/ui';
import { PasswordField } from '@/components/password-field';
import { AuthScreenSkeleton } from '@/components/loading-skeletons';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import {
  AUTH_PASSWORD_MIN_LENGTH,
  authErrorMessage,
  passwordChecks,
  resetPasswordSchema,
} from '@/lib/auth-validation';
import { radii, spacing } from '@/theme';

type Form = { password: string; passwordConfirmation: string };

export default function ResetPasswordScreen() {
  const auth = useAuth();
  const { completePasswordRecovery } = auth;
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  const invalidCode = Boolean(code && code.length > 1_024);
  const palette = useAppColors();
  const [serverError, setServerError] = useState<string>();
  const [completed, setCompleted] = useState(false);
  const [callbackState, setCallbackState] = useState<'idle' | 'loading' | 'error'>(
    invalidCode ? 'error' : code ? 'loading' : 'idle',
  );
  const {
    control,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    defaultValues: { password: '', passwordConfirmation: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });
  const checks = passwordChecks(useWatch({ control, name: 'password' }));

  useEffect(() => {
    let active = true;

    if (!code || invalidCode) return;

    void completePasswordRecovery({ code })
      .then(() => {
        if (!active) return;
        setCallbackState('idle');
        router.replace('/(auth)/reset-password');
      })
      .catch(() => {
        if (active) setCallbackState('error');
      });

    return () => {
      active = false;
    };
  }, [code, completePasswordRecovery, invalidCode, router]);

  if (auth.loading || callbackState === 'loading') return <AuthScreenSkeleton />;
  if (callbackState === 'error') {
    return (
      <ScreenContainer publicPage contentContainerStyle={styles.screen}>
        <EmptyState
          title="Este enlace no es válido"
          body="El enlace ha caducado, ya se ha utilizado o se abrió en otro dispositivo. Solicita uno nuevo desde este navegador."
          action={
            <AppButton
              title="Solicitar otro enlace"
              onPress={() => router.replace('/(auth)/forgot-password')}
            />
          }
        />
      </ScreenContainer>
    );
  }
  if (!auth.session) return <Redirect href="/(auth)/login" />;

  const submit = handleSubmit(async (values) => {
    const parsed = resetPasswordSchema.safeParse(values);
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
      await auth.updatePassword(parsed.data.password);
      setCompleted(true);
    } catch (error) {
      setServerError(authErrorMessage(error, 'password-update'));
    }
  });

  if (completed) {
    return (
      <ScreenContainer publicPage contentContainerStyle={styles.screen}>
        <Card padding="spacious" style={styles.successCard}>
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            style={[styles.successIcon, { backgroundColor: palette.successLight }]}
          >
            <Check color={palette.successInk} size={34} strokeWidth={3} />
          </View>
          <AppText accessibilityRole="header" variant="screenTitle" style={styles.center}>
            Contraseña actualizada
          </AppText>
          <AppText color={palette.textSecondary} style={styles.center}>
            Ya puedes acceder a Pagaste con tu correo y esta contraseña.
          </AppText>
          <AppButton
            title="Continuar"
            size="lg"
            fullWidth
            onPress={() =>
              router.replace(auth.profile?.onboarding_completed ? '/(tabs)' : '/(auth)/onboarding')
            }
          />
        </Card>
      </ScreenContainer>
    );
  }

  if (!auth.passwordRecovery) {
    return (
      <ScreenContainer publicPage contentContainerStyle={styles.screen}>
        <EmptyState
          title="Este enlace no es válido"
          body="Solicita un enlace nuevo para cambiar tu contraseña de forma segura."
          action={
            <AppButton
              title="Solicitar otro enlace"
              onPress={() => router.replace('/(auth)/forgot-password')}
            />
          }
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer publicPage contentContainerStyle={styles.screen}>
      <View style={styles.content}>
        <PageHeader title="Nueva contraseña" />
        <View
          accessible={false}
          importantForAccessibility="no"
          style={[styles.illustration, { backgroundColor: palette.primaryLight }]}
        >
          <View style={[styles.keyCircle, { backgroundColor: palette.surface }]}>
            <KeyRound color={palette.primary} size={44} strokeWidth={1.8} />
          </View>
          <View style={[styles.shieldBubble, { backgroundColor: palette.success }]}>
            <ShieldCheck color={palette.white} size={18} strokeWidth={2.5} />
          </View>
        </View>

        <Card padding="spacious" style={styles.card}>
          <View style={styles.heading}>
            <AppText accessibilityRole="header" variant="screenTitle">
              Protege tu cuenta
            </AppText>
            <AppText color={palette.textSecondary}>
              Crea una contraseña única que no utilices en otros servicios.
            </AppText>
          </View>

          <Controller
            control={control}
            name="password"
            render={({ field: { ref, value, onChange, onBlur } }) => (
              <PasswordField
                ref={ref}
                testID="reset-password"
                label="Contraseña nueva"
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
            <Requirement
              passed={checks.length}
              label={`${AUTH_PASSWORD_MIN_LENGTH} caracteres como mínimo`}
            />
            <Requirement passed={checks.lowercase} label="Una letra minúscula" />
            <Requirement passed={checks.uppercase} label="Una letra mayúscula" />
            <Requirement passed={checks.number} label="Un número" />
          </View>

          <Controller
            control={control}
            name="passwordConfirmation"
            render={({ field: { ref, value, onChange, onBlur } }) => (
              <PasswordField
                ref={ref}
                testID="reset-password-confirmation"
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
            testID="reset-submit"
            title="Guardar contraseña"
            size="lg"
            fullWidth
            loading={isSubmitting}
            onPress={submit}
          />
        </Card>
      </View>
    </ScreenContainer>
  );
}

function Requirement({ passed, label }: { passed: boolean; label: string }) {
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
      <AppText variant="caption" color={passed ? palette.successInk : palette.textSecondary}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'center' },
  content: { width: '100%', gap: spacing.lg },
  center: { textAlign: 'center' },
  illustration: {
    height: 136,
    borderRadius: radii.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shieldBubble: {
    position: 'absolute',
    right: '33%',
    bottom: 22,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { gap: spacing.md },
  heading: { gap: spacing.sm, marginBottom: spacing.xs },
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
  successCard: { gap: spacing.lg, alignItems: 'center' },
  successIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
