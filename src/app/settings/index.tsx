import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
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
import { useI18n } from '@/i18n';
import { radii, spacing } from '@/theme';

const localeLabels = {
  es: 'Español',
  ca: 'Català',
  en: 'English',
} as const;

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
  const { locale, setLocale } = useI18n();
  const rows = [
    {
      title: 'Cuenta y datos',
      subtitle: 'Nombre, correo y exportación',
      path: '/settings/account' as const,
      icon: UserRound,
    },
    {
      title: 'Notificaciones',
      subtitle: 'Avisos y recordatorios',
      path: '/settings/notifications' as const,
      icon: Bell,
    },
    {
      title: 'Privacidad',
      subtitle: 'Tus datos y seguridad',
      path: '/settings/privacy' as const,
      icon: LockKeyhole,
    },
    {
      title: 'Plan de Pagaste',
      subtitle: 'Suscripción y funciones',
      path: '/settings/subscription' as const,
      icon: CreditCard,
    },
  ];

  return (
    <ScreenContainer>
      <PageHeader title="Ajustes" subtitle="Cuenta, preferencias y privacidad" />

      <Animated.View entering={enter(35)}>
        <Card variant="grouped">
          {rows.map(({ title, subtitle, path, icon: Icon }, index) => (
            <View key={path}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={title}
                onPress={() => router.push(path)}
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
          <AppText variant="sectionTitle">Idioma</AppText>
          <AppText variant="caption" color={palette.textSecondary}>
            La aplicación está en {localeLabels[locale]}.
          </AppText>
        </View>
        <Card padding="spacious" style={styles.languageCard}>
          <View style={styles.languageRow}>
            <View style={[styles.iconBubble, { backgroundColor: palette.primaryLight }]}>
              <Languages color={palette.primary} size={20} strokeWidth={1.9} />
            </View>
            <View style={styles.settingsCopy}>
              <AppText variant="label">Idioma de Pagaste</AppText>
              <AppText variant="caption" color={palette.textSecondary}>
                {localeLabels[locale]}
              </AppText>
            </View>
          </View>
          <View style={[styles.languages, { backgroundColor: palette.background }]}>
            {(['es', 'ca', 'en'] as const).map((value) => (
              <AppButton
                key={value}
                title={value.toUpperCase()}
                size="sm"
                variant={locale === value ? 'primary' : 'ghost'}
                style={styles.languageButton}
                accessibilityLabel={`Cambiar idioma a ${localeLabels[value]}`}
                onPress={() => setLocale(value)}
              />
            ))}
          </View>
        </Card>
      </Animated.View>

      <Animated.View entering={enter(145)}>
        <AppButton
          title="Cerrar sesión"
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
