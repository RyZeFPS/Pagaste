import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import {
  Bell,
  ChevronRight,
  CreditCard,
  Languages,
  LockKeyhole,
  LogOut,
  UserRound,
} from 'lucide-react-native';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { AppButton, AppText, Card, Divider, ScreenContainer } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { supportedLocales, toIntlLocale, useI18n, type Locale } from '@/i18n';
import { radii, spacing } from '@/theme';

const enter = (delay: number) =>
  FadeInDown.duration(330).delay(delay).reduceMotion(ReduceMotion.System);

export default function SettingsScreen() {
  return (
    <RequireAuth>
      <SettingsContent />
    </RequireAuth>
  );
}

function SettingsContent() {
  const auth = useAuth();
  const router = useRouter();
  const palette = useAppColors();
  const { locale, setLocale, t } = useI18n();
  const [languageSaving, setLanguageSaving] = useState<Locale>();
  const [languageError, setLanguageError] = useState<string>();
  const localeLabels: Record<Locale, string> = {
    es: t('language.spanish'),
    en: t('language.english'),
  };
  const rows = [
    {
      title: t('settings.accountTitle'),
      subtitle: t('settings.accountSubtitle'),
      path: '/settings/account' as const,
      icon: UserRound,
    },
    {
      title: t('settings.notificationsTitle'),
      subtitle: t('settings.notificationsSubtitle'),
      path: '/settings/notification-preferences' as const,
      icon: Bell,
    },
    {
      title: t('settings.privacyTitle'),
      subtitle: t('settings.privacySubtitle'),
      path: '/settings/privacy' as const,
      icon: LockKeyhole,
    },
    {
      title: t('settings.subscriptionMenuTitle'),
      subtitle: t('settings.subscriptionSubtitle'),
      path: '/settings/subscription' as const,
      icon: CreditCard,
    },
  ];
  const changeLocale = async (nextLocale: Locale) => {
    if (nextLocale === locale || languageSaving) return;
    const previousLocale = locale;
    setLanguageError(undefined);
    setLanguageSaving(nextLocale);
    setLocale(nextLocale);
    try {
      if (auth.profile) {
        await auth.saveProfile({
          displayName: auth.profile.display_name,
          locale: toIntlLocale(nextLocale),
        });
      }
    } catch {
      setLocale(previousLocale);
      setLanguageError(t('settings.languageSaveError'));
    } finally {
      setLanguageSaving(undefined);
    }
  };

  return (
    <ScreenContainer>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <Animated.View entering={enter(35)}>
        <Card variant="grouped">
          {rows.map(({ title, subtitle, path, icon: Icon }, index) => (
            <View key={path}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={title}
                onPress={() => router.push(path as Href)}
                style={({ pressed }) => [
                  styles.settingsRow,
                  pressed && { backgroundColor: palette.primaryLight },
                ]}
              >
                <View style={[styles.iconBubble, { backgroundColor: palette.primaryLight }]}>
                  <Icon color={palette.primary} size={20} strokeWidth={1.9} />
                </View>
                <View style={styles.settingsCopy}>
                  <AppText variant="label">{title}</AppText>
                  <AppText variant="caption" color={palette.textSecondary}>
                    {subtitle}
                  </AppText>
                </View>
                <ChevronRight color={palette.textMuted} size={20} strokeWidth={1.8} />
              </Pressable>
              {index < rows.length - 1 ? <Divider inset={68} /> : null}
            </View>
          ))}
        </Card>
      </Animated.View>

      <Animated.View entering={enter(90)} style={styles.section}>
        <View style={styles.sectionHeading}>
          <AppText variant="sectionTitle">{t('settings.languageTitle')}</AppText>
          <AppText variant="caption" color={palette.textSecondary}>
            {t('settings.languageDescription', { language: localeLabels[locale] })}
          </AppText>
        </View>
        <Card padding="spacious" style={styles.languageCard}>
          <View style={styles.languageRow}>
            <View style={[styles.iconBubble, { backgroundColor: palette.primaryLight }]}>
              <Languages color={palette.primary} size={20} strokeWidth={1.9} />
            </View>
            <View style={styles.settingsCopy}>
              <AppText variant="label">{t('settings.appLanguage')}</AppText>
              <AppText variant="caption" color={palette.textSecondary}>
                {localeLabels[locale]}
              </AppText>
            </View>
          </View>
          <View style={[styles.languages, { backgroundColor: palette.background }]}>
            {supportedLocales.map((value) => (
              <AppButton
                key={value}
                title={value.toUpperCase()}
                size="sm"
                variant={locale === value ? 'primary' : 'ghost'}
                style={styles.languageButton}
                accessibilityLabel={t('settings.changeLanguage', {
                  language: localeLabels[value],
                })}
                loading={languageSaving === value}
                disabled={Boolean(languageSaving)}
                onPress={() => void changeLocale(value)}
              />
            ))}
          </View>
          {languageError ? (
            <AppText variant="caption" color={palette.danger}>
              {languageError}
            </AppText>
          ) : null}
        </Card>
      </Animated.View>

      <Animated.View entering={enter(145)}>
        <AppButton
          title={t('auth.logout')}
          variant="danger"
          fullWidth
          leftIcon={<LogOut color={palette.white} size={19} strokeWidth={2} />}
          onPress={() => void auth.signOut()}
        />
      </Animated.View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  settingsRow: {
    minHeight: 68,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsCopy: { minWidth: 0, flex: 1, gap: 1 },
  section: { gap: spacing.md },
  sectionHeading: { paddingHorizontal: spacing.xs, gap: 2 },
  languageCard: { gap: spacing.lg },
  languageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  languages: { padding: 3, borderRadius: radii.control, flexDirection: 'row', gap: 3 },
  languageButton: { minWidth: 0, flex: 1, borderWidth: 0 },
});
