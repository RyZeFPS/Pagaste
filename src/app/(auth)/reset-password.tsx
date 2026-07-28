import { useEffect, useMemo, useState } from 'react';
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
  createAuthValidationSchemas,
  passwordChecks,
} from '@/lib/auth-validation';
import { useI18n } from '@/i18n';
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
  const { locale, t } = useI18n();
  const { resetPasswordSchema } = useMemo(() => createAuthValidationSchemas(locale), [locale]);
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
          title={t('auth.invalidLinkTitle')}
          body={t('auth.invalidCallbackBody')}
          action={
            <AppButton
              title={t('auth.requestNewLink')}
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
      setServerError(authErrorMessage(error, 'password-update', locale));
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
            {t('auth.passwordUpdatedTitle')}
          </AppText>
          <AppText color={palette.textSecondary} style={styles.center}>
            {t('auth.passwordUpdatedBody')}
          </AppText>
          <AppButton
            title={t('common.continue')}
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
          title={t('auth.invalidLinkTitle')}
          body={t('auth.invalidRecoveryBody')}
          action={
            <AppButton
              title={t('auth.requestNewLink')}
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
        <PageHeader title={t('auth.newPasswordHeader')} />
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
              {t('auth.resetTitle')}
            </AppText>
            <AppText color={palette.textSecondary}>{t('auth.resetBody')}</AppText>
          </View>

          <Controller
            control={control}
            name="password"
            render={({ field: { ref, value, onChange, onBlur } }) => (
              <PasswordField
                ref={ref}
                testID="reset-password"
                label={t('auth.newPassword')}
                placeholder={t('auth.passwordCreatePlaceholder')}
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
            accessibilityLabel={t('auth.passwordRequirements', {
              passed: Object.values(checks).filter(Boolean).length,
              total: 4,
            })}
            style={[styles.requirements, { backgroundColor: palette.background }]}
          >
            <Requirement
              passed={checks.length}
              label={t('auth.passwordRequirementMin', { count: AUTH_PASSWORD_MIN_LENGTH })}
            />
            <Requirement passed={checks.lowercase} label={t('auth.passwordRequirementLowercase')} />
            <Requirement passed={checks.uppercase} label={t('auth.passwordRequirementUppercase')} />
            <Requirement passed={checks.number} label={t('auth.passwordRequirementNumber')} />
          </View>

          <Controller
            control={control}
            name="passwordConfirmation"
            render={({ field: { ref, value, onChange, onBlur } }) => (
              <PasswordField
                ref={ref}
                testID="reset-password-confirmation"
                label={t('auth.passwordRepeat')}
                placeholder={t('auth.passwordRepeatPlaceholder')}
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
            title={t('auth.savePassword')}
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
  const { t } = useI18n();
  return (
    <View
      accessible
      accessibilityLabel={`${t(passed ? 'auth.requirementMet' : 'auth.requirementPending')}: ${label}`}
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
