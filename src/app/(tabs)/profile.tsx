import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import {
  AtSign,
  BadgeEuro,
  CalendarDays,
  Camera,
  Languages,
  Pencil,
  Settings,
  Trash2,
} from 'lucide-react-native';
import { AppButton, AppText, Card, ScreenContainer } from '@/components/ui';
import {
  ReputationSummaryCard,
  ReputationSummarySkeleton,
} from '@/components/reputation-summary-card';
import { pickProcessedProfileAvatar } from '@/lib/profile-avatar-image';
import { repository } from '@/lib/repository';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { useI18n, type Locale } from '@/i18n';
import { radii, spacing } from '@/theme';

const enter = (delay: number) =>
  FadeInDown.duration(360).delay(delay).reduceMotion(ReduceMotion.System);

function joinedLabel(
  createdAt: string | undefined,
  intlLocale: string,
  translate: ReturnType<typeof useI18n>['t'],
) {
  if (!createdAt) return translate('profile.recentlyJoined');
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return translate('profile.recentlyJoined');
  return translate('profile.joined', {
    date: new Intl.DateTimeFormat(intlLocale, {
      month: 'long',
      year: 'numeric',
    }).format(date),
  });
}

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}

export default function ProfileScreen() {
  const auth = useAuth();
  const router = useRouter();
  const palette = useAppColors();
  const { intlLocale, locale, t } = useI18n();
  const localeLabels: Record<Locale, string> = {
    es: t('language.spanish'),
    en: t('language.english'),
  };
  const displayName = auth.profile?.display_name || t('profile.title');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string>();
  const reputation = useQuery({
    queryKey: ['reputation', auth.user?.id],
    queryFn: () => repository.reputation(auth.user!.id),
    enabled: Boolean(auth.user?.id),
  });

  const chooseAvatar = async () => {
    setAvatarError(undefined);
    try {
      const uri = await pickProcessedProfileAvatar();
      if (!uri) return;
      setAvatarBusy(true);
      await auth.uploadProfileAvatar(uri);
    } catch {
      setAvatarError(t('profile.photoSaveError'));
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarError(undefined);
    setAvatarBusy(true);
    try {
      await auth.removeProfileAvatar();
    } catch {
      setAvatarError(t('profile.photoRemoveError'));
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <ScreenContainer floatingTabs>
      <View style={styles.screen}>
        <Animated.View entering={enter(0)} style={styles.pageHeader}>
          <View style={styles.pageHeaderCopy}>
            <AppText variant="display" style={styles.pageTitle}>
              {t('tabs.profile')}
            </AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {t('profile.subtitle')}
            </AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('profile.openSettings')}
            hitSlop={6}
            onPress={() => router.push('/settings' as never)}
            style={({ pressed }) => [
              styles.settingsButton,
              { backgroundColor: palette.surface, borderColor: palette.border },
              pressed && styles.pressed,
            ]}
          >
            <Settings color={palette.textPrimary} size={22} strokeWidth={1.9} />
          </Pressable>
        </Animated.View>

        <Animated.View entering={enter(55)}>
          <Card variant="elevated" padding="none" style={styles.heroCard}>
            <View style={[styles.heroVisual, { backgroundColor: palette.primaryLight }]}>
              <View
                pointerEvents="none"
                style={[styles.heroOrbLarge, { borderColor: palette.surface }]}
              />
              <View
                pointerEvents="none"
                style={[styles.heroOrbSmall, { backgroundColor: palette.surface }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  auth.profile?.avatar_path ? t('profile.changePhoto') : t('profile.addPhoto')
                }
                disabled={avatarBusy}
                onPress={() => void chooseAvatar()}
                style={({ pressed }) => [styles.avatarAction, pressed && styles.avatarPressed]}
              >
                <ProfileAvatar name={displayName} uri={auth.profile?.avatar_url} size={124} />
                <View
                  style={[
                    styles.cameraBadge,
                    { backgroundColor: palette.primary, borderColor: palette.surface },
                  ]}
                >
                  {avatarBusy ? (
                    <ActivityIndicator color={palette.white} size="small" />
                  ) : (
                    <Camera color={palette.white} size={18} strokeWidth={2.2} />
                  )}
                </View>
              </Pressable>
            </View>

            <View style={styles.heroBody}>
              <AppText numberOfLines={2} style={styles.profileName}>
                {displayName}
              </AppText>
              <View style={styles.emailRow}>
                <AtSign color={palette.textMuted} size={16} strokeWidth={2} />
                <AppText numberOfLines={1} variant="bodySmall" color={palette.textSecondary}>
                  {auth.user?.email}
                </AppText>
              </View>

              <View style={styles.profileChips}>
                <ProfileChip
                  icon={<CalendarDays color={palette.primary} size={16} strokeWidth={1.9} />}
                  label={joinedLabel(auth.profile?.created_at, intlLocale, t)}
                />
                <ProfileChip
                  icon={<BadgeEuro color={palette.primary} size={16} strokeWidth={1.9} />}
                  label={auth.profile?.default_currency || 'EUR'}
                />
                <ProfileChip
                  icon={<Languages color={palette.primary} size={16} strokeWidth={1.9} />}
                  label={localeLabels[locale]}
                />
              </View>

              {auth.profile?.avatar_path ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('profile.removePhoto')}
                  disabled={avatarBusy}
                  onPress={() => void removeAvatar()}
                  style={({ pressed }) => [
                    styles.removePhotoButton,
                    { backgroundColor: palette.dangerLight },
                    pressed && styles.pressed,
                  ]}
                >
                  <Trash2 color={palette.danger} size={17} strokeWidth={2} />
                </Pressable>
              ) : null}
              {avatarError ? (
                <AppText variant="caption" color={palette.danger} style={styles.avatarError}>
                  {avatarError}
                </AppText>
              ) : null}

              <AppButton
                title={t('profile.edit')}
                accessibilityLabel={t('profile.editA11y')}
                size="md"
                leftIcon={<Pencil color={palette.white} size={18} strokeWidth={2} />}
                style={styles.editButton}
                onPress={() => router.push('/settings/account')}
              />
            </View>
          </Card>
        </Animated.View>

        <Animated.View entering={enter(130)} style={styles.section}>
          <View style={styles.sectionHeading}>
            <View>
              <AppText variant="sectionTitle">{t('profile.reliability')}</AppText>
              <AppText variant="caption" color={palette.textSecondary}>
                {t('profile.reliabilityBody')}
              </AppText>
            </View>
          </View>
          {reputation.isPending && reputation.data === undefined ? (
            <ReputationSummarySkeleton />
          ) : (
            <ReputationSummaryCard
              reputation={reputation.data}
              error={reputation.isError}
              onRetry={() => void reputation.refetch()}
            />
          )}
        </Animated.View>
      </View>
    </ScreenContainer>
  );
}

function ProfileAvatar({ name, uri, size }: { name: string; uri?: string | null; size: number }) {
  const palette = useAppColors();
  return (
    <View
      style={[
        styles.avatarFrame,
        {
          width: size + 10,
          height: size + 10,
          borderRadius: (size + 10) / 2,
          backgroundColor: palette.surface,
        },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          contentFit="cover"
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      ) : (
        <View
          style={[
            styles.avatarFallback,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: palette.primary,
            },
          ]}
        >
          <AppText color={palette.white} style={styles.avatarInitials}>
            {initials(name)}
          </AppText>
        </View>
      )}
    </View>
  );
}

function ProfileChip({ icon, label }: { icon: ReactNode; label: string }) {
  const palette = useAppColors();
  return (
    <View style={[styles.profileChip, { backgroundColor: palette.background }]}>
      {icon}
      <AppText numberOfLines={1} variant="caption" color={palette.textPrimary}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { width: '100%', gap: spacing.xl },
  pageHeader: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pageHeaderCopy: { minWidth: 0, flex: 1, gap: spacing.xs },
  pageTitle: { letterSpacing: -0.7 },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.68 },
  heroCard: { overflow: 'hidden' },
  heroVisual: {
    position: 'relative',
    minHeight: 174,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroOrbLarge: {
    position: 'absolute',
    width: 206,
    height: 206,
    borderRadius: 103,
    borderWidth: 38,
    opacity: 0.52,
  },
  heroOrbSmall: {
    position: 'absolute',
    width: 72,
    height: 72,
    right: -18,
    top: -18,
    borderRadius: 36,
    opacity: 0.54,
  },
  avatarFrame: { zIndex: 1, alignItems: 'center', justifyContent: 'center' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 36, lineHeight: 42, fontWeight: '800', letterSpacing: -1 },
  avatarAction: {
    position: 'relative',
    zIndex: 2,
    overflow: 'visible',
  },
  avatarPressed: { transform: [{ scale: 0.98 }] },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 3,
    zIndex: 5,
    elevation: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBody: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  profileName: {
    maxWidth: '100%',
    textAlign: 'center',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  emailRow: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  profileChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  profileChip: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  removePhotoButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarError: { textAlign: 'center' },
  editButton: { minWidth: 164, marginTop: spacing.xs },
  section: { gap: spacing.md },
  sectionHeading: {
    minHeight: 44,
    paddingHorizontal: spacing.xs,
    justifyContent: 'center',
  },
});
