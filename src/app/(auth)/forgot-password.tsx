import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { KeyRound, Mail } from 'lucide-react-native';
import { PageHeader } from '@/components/app-shell';
import { AppButton, AppInput, AppText, Card, ScreenContainer } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { authErrorMessage, emailSchema } from '@/lib/auth-validation';
import { radii, spacing } from '@/theme';

type Form = { email: string };

export default function ForgotPasswordScreen() {
  const auth = useAuth();
  const router = useRouter();
  const palette = useAppColors();
  const params = useLocalSearchParams<{ email?: string | string[] }>();
  const initialEmail = typeof params.email === 'string' ? params.email : '';
  const [serverError, setServerError] = useState<string>();
  const {
    control,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ defaultValues: { email: initialEmail }, mode: 'onBlur' });

  const submit = handleSubmit(async (values) => {
    const parsed = emailSchema.safeParse(values);
    if (!parsed.success) {
      setError('email', { message: parsed.error.issues[0]?.message });
      setFocus('email');
      return;
    }
    setServerError(undefined);
    try {
      await auth.requestPasswordReset(parsed.data.email);
      router.replace({
        pathname: '/(auth)/verify',
        params: { email: parsed.data.email, mode: 'reset' },
      });
    } catch (error) {
      setServerError(authErrorMessage(error, 'password-reset'));
    }
  });

  return (
    <ScreenContainer publicPage contentContainerStyle={styles.screen}>
      <View style={styles.content}>
        <PageHeader title="Recuperar contraseña" />
        <View
          accessible={false}
          importantForAccessibility="no"
          style={[styles.illustration, { backgroundColor: palette.primaryLight }]}
        >
          <View style={[styles.mailCircle, { backgroundColor: palette.surface }]}>
            <Mail color={palette.primary} size={40} strokeWidth={1.8} />
          </View>
          <View style={[styles.keyBubble, { backgroundColor: palette.success }]}>
            <KeyRound color={palette.white} size={17} strokeWidth={2.6} />
          </View>
        </View>

        <Card padding="spacious" style={styles.card}>
          <View style={styles.heading}>
            <AppText accessibilityRole="header" variant="screenTitle">
              Crea una contraseña nueva
            </AppText>
            <AppText color={palette.textSecondary}>
              Te enviaremos un enlace seguro. Si tu cuenta venía del acceso por código, úsalo una
              vez para establecer tu contraseña.
            </AppText>
          </View>

          <Controller
            control={control}
            name="email"
            render={({ field: { ref, value, onChange, onBlur } }) => (
              <AppInput
                ref={ref}
                testID="forgot-email"
                label="Correo electrónico"
                placeholder="tu@correo.com"
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                enterKeyHint="send"
                maxLength={254}
                value={value}
                onChangeText={(text) => {
                  setServerError(undefined);
                  onChange(text);
                }}
                onBlur={onBlur}
                onSubmitEditing={() => void submit()}
                error={errors.email?.message}
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
            testID="forgot-submit"
            title="Enviar enlace seguro"
            size="lg"
            fullWidth
            loading={isSubmitting}
            leftIcon={<Mail color={palette.white} size={20} />}
            onPress={submit}
          />
        </Card>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'center' },
  content: { width: '100%', gap: spacing.lg },
  illustration: {
    height: 136,
    borderRadius: radii.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mailCircle: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyBubble: {
    position: 'absolute',
    right: '34%',
    top: 24,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { gap: spacing.lg },
  heading: { gap: spacing.sm },
  errorMessage: {
    minHeight: 44,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
});
