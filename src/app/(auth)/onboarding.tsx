import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, TextInput, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Check, LockKeyhole, UserRound } from 'lucide-react-native';
import { AppButton, AppInput, AppText, Card, ScreenContainer } from '@/components/ui';
import { BrandLogo } from '@/components/brand-logo';
import { ThreeDIcon, type ThreeDAsset } from '@/components/three-d-icon';
import { AuthScreenSkeleton } from '@/components/loading-skeletons';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { createAuthValidationSchemas } from '@/lib/auth-validation';
import { getSafeInviteRedirect } from '@/lib/navigation';
import { useI18n } from '@/i18n';
import { radii, spacing } from '@/theme';

const guideDefinition = [
  {
    icon: 'receiptScan' as ThreeDAsset,
    title: 'auth.guideExpenseTitle',
    body: 'auth.guideExpenseBody',
    note: 'auth.guideExpenseNote',
  },
  {
    icon: 'groupPeople' as ThreeDAsset,
    title: 'auth.guideSplitTitle',
    body: 'auth.guideSplitBody',
    note: 'auth.guideSplitNote',
  },
  {
    icon: 'paidCheck' as ThreeDAsset,
    title: 'auth.guideCollectTitle',
    body: 'auth.guideCollectBody',
    note: 'auth.guideCollectNote',
  },
] as const;

const TOTAL_STEPS = guideDefinition.length + 1;

export default function OnboardingScreen() {
  const auth = useAuth();
  const router = useRouter();
  const palette = useAppColors();
  const { locale, t } = useI18n();
  const { displayNameSchema } = useMemo(() => createAuthValidationSchemas(locale), [locale]);
  const guide = useMemo(
    () =>
      guideDefinition.map((item) => ({
        icon: item.icon,
        title: t(item.title),
        body: t(item.body),
        note: t(item.note),
      })),
    [t],
  );
  const params = useLocalSearchParams<{ next?: string | string[] }>();
  const next = getSafeInviteRedirect(params.next);
  const [name, setName] = useState(
    auth.profile?.display_name ?? auth.user?.user_metadata?.display_name ?? '',
  );
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [transition] = useState(() => new Animated.Value(1));
  const nameRef = useRef<TextInput>(null);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(
      step === 0
        ? t('auth.guideProfileAnnouncement', { total: TOTAL_STEPS })
        : t('auth.guideStepAnnouncement', {
            step: step + 1,
            total: TOTAL_STEPS,
            title: guide[step - 1]?.title ?? '',
          }),
    );
    transition.stopAnimation();
    if (reduceMotion) {
      transition.setValue(1);
      return;
    }
    transition.setValue(0);
    Animated.timing(transition, {
      toValue: 1,
      duration: 340,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [direction, guide, reduceMotion, step, t, transition]);

  if (auth.loading) return <AuthScreenSkeleton />;
  if (!auth.session) return <Redirect href="/(auth)/login" />;
  if (auth.profile?.onboarding_completed) return <Redirect href={next ?? '/(tabs)'} />;

  const goTo = (target: number) => {
    setDirection(target > step ? 1 : -1);
    setStep(target);
  };

  const validateName = () => {
    const parsed = displayNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      nameRef.current?.focus();
      return undefined;
    }
    setError(undefined);
    setName(parsed.data);
    return parsed.data;
  };

  const finish = async () => {
    const displayName = validateName();
    if (!displayName) return;
    setLoading(true);
    setError(undefined);
    try {
      await auth.completeOnboarding(displayName);
      router.replace(next ?? '/(tabs)');
    } catch {
      setError(t('auth.onboardingSaveError'));
    } finally {
      setLoading(false);
    }
  };

  const nextStep = () => {
    if (step === 0 && !validateName()) return;
    if (step < TOTAL_STEPS - 1) goTo(step + 1);
    else void finish();
  };

  const currentGuide = step > 0 ? guide[step - 1] : undefined;
  return (
    <ScreenContainer publicPage contentContainerStyle={styles.screen}>
      <View style={styles.content}>
        <View style={styles.topBar}>
          <View style={styles.brand} accessibilityRole="header">
            <BrandLogo variant="horizontal" width={154} testID="pagaste-brand-logo" />
            <AppText variant="caption" color={palette.textSecondary}>
              {t('auth.onboardingHint')}
            </AppText>
          </View>
          {step > 0 ? (
            <AppButton
              title={t('auth.skipGuide')}
              variant="ghost"
              size="sm"
              loading={loading}
              onPress={() => void finish()}
            />
          ) : null}
        </View>

        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t('auth.guideProgress', {
            step: step + 1,
            total: TOTAL_STEPS,
          })}
          accessibilityValue={{ min: 1, max: TOTAL_STEPS, now: step + 1 }}
          style={styles.progress}
        >
          {Array.from({ length: TOTAL_STEPS }, (_, index) => (
            <View
              key={index}
              accessible={false}
              style={[
                styles.progressSegment,
                {
                  backgroundColor: index <= step ? palette.primary : palette.divider,
                },
              ]}
            />
          ))}
        </View>

        <Animated.View
          style={[
            styles.animatedContent,
            {
              opacity: transition,
              transform: [
                {
                  translateX: transition.interpolate({
                    inputRange: [0, 1],
                    outputRange: [reduceMotion ? 0 : direction * 34, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {step === 0 ? (
            <ProfileStep
              name={name}
              error={error}
              inputRef={nameRef}
              onChange={(value) => {
                setError(undefined);
                setName(value);
              }}
              onSubmit={nextStep}
            />
          ) : currentGuide ? (
            <GuideStep {...currentGuide} />
          ) : null}
        </Animated.View>

        {error && step > 0 ? (
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            style={[styles.errorMessage, { backgroundColor: palette.dangerLight }]}
          >
            <AppText variant="bodySmall" color={palette.dangerInk}>
              {error}
            </AppText>
          </View>
        ) : null}

        <View style={styles.actions}>
          {step > 0 ? (
            <AppButton
              title={t('auth.previous')}
              variant="secondary"
              size="lg"
              leftIcon={<ArrowLeft color={palette.textPrimary} size={19} />}
              disabled={loading}
              style={styles.secondaryAction}
              onPress={() => goTo(step - 1)}
            />
          ) : null}
          <AppButton
            testID={step === TOTAL_STEPS - 1 ? 'onboarding-finish' : 'onboarding-next'}
            title={t(step === TOTAL_STEPS - 1 ? 'auth.startUsing' : 'auth.next')}
            size="lg"
            loading={loading}
            style={styles.primaryAction}
            onPress={nextStep}
          />
        </View>
      </View>
    </ScreenContainer>
  );
}

function ProfileStep({
  name,
  error,
  inputRef,
  onChange,
  onSubmit,
}: {
  name: string;
  error?: string;
  inputRef: RefObject<TextInput | null>;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const palette = useAppColors();
  const { t } = useI18n();
  return (
    <>
      <View
        accessible={false}
        importantForAccessibility="no"
        style={[styles.profileIllustration, { backgroundColor: palette.primaryLight }]}
      >
        <View style={[styles.profileHalo, { borderColor: palette.primary }]} />
        <View style={[styles.profileCircle, { backgroundColor: palette.surface }]}>
          <UserRound color={palette.primary} size={44} strokeWidth={1.8} />
        </View>
        <View style={[styles.checkCircle, { backgroundColor: palette.success }]}>
          <Check color={palette.white} size={18} strokeWidth={3} />
        </View>
      </View>
      <Card padding="spacious" style={styles.card}>
        <View style={styles.heading}>
          <AppText accessibilityRole="header" variant="screenTitle">
            {t('auth.onboardingTitle')}
          </AppText>
          <AppText color={palette.textSecondary}>{t('auth.onboardingProfileBody')}</AppText>
        </View>
        <AppInput
          ref={inputRef}
          testID="onboarding-name"
          label={t('auth.displayName')}
          placeholder={t('auth.namePlaceholder')}
          value={name}
          onChangeText={onChange}
          autoFocus
          autoCapitalize="words"
          autoComplete="name"
          enterKeyHint="next"
          maxLength={60}
          onSubmitEditing={onSubmit}
          error={error}
        />
        <View style={styles.privacy}>
          <LockKeyhole color={palette.textMuted} size={16} />
          <AppText variant="caption" color={palette.textSecondary} style={styles.flex}>
            {t('auth.onboardingPrivacy')}
          </AppText>
        </View>
      </Card>
    </>
  );
}

function GuideStep({
  icon,
  title,
  body,
  note,
}: {
  icon: ThreeDAsset;
  title: string;
  body: string;
  note: string;
}) {
  const palette = useAppColors();
  return (
    <Card padding="spacious" style={styles.guideCard}>
      <View style={[styles.guideArtwork, { backgroundColor: palette.primaryLight }]}>
        <ThreeDIcon name={icon} size={150} />
      </View>
      <View style={styles.guideCopy} accessibilityLiveRegion="polite">
        <AppText accessibilityRole="header" variant="screenTitle" style={styles.center}>
          {title}
        </AppText>
        <AppText color={palette.textSecondary} style={styles.center}>
          {body}
        </AppText>
      </View>
      <View style={[styles.guideNote, { backgroundColor: palette.successLight }]}>
        <Check color={palette.successInk} size={18} strokeWidth={2.7} />
        <AppText variant="bodySmall" color={palette.successInk} style={styles.flex}>
          {note}
        </AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'center' },
  content: { width: '100%', gap: spacing.lg },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  topBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  brand: { alignItems: 'flex-start', gap: spacing.xxs },
  progress: { flexDirection: 'row', gap: spacing.sm },
  progressSegment: { flex: 1, height: 5, borderRadius: radii.pill },
  animatedContent: { gap: spacing.lg },
  profileIllustration: {
    height: 144,
    borderRadius: radii.card,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileHalo: {
    position: 'absolute',
    width: 116,
    height: 116,
    borderRadius: 58,
    borderWidth: 1,
    opacity: 0.15,
  },
  profileCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircle: {
    position: 'absolute',
    top: 28,
    right: '34%',
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { gap: spacing.lg },
  heading: { gap: spacing.sm },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  guideCard: { gap: spacing.xl, alignItems: 'stretch' },
  guideArtwork: {
    height: 220,
    borderRadius: radii.card,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  guideCopy: { gap: spacing.md },
  guideNote: {
    minHeight: 54,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  errorMessage: {
    minHeight: 44,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  secondaryAction: { flex: 0.9 },
  primaryAction: { flex: 1.35 },
});
