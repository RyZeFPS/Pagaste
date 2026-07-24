import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { BellRing, Clock3, Info, Smartphone } from 'lucide-react-native';
import {
  AppText,
  Card,
  Divider,
  ListCard,
  LoadingSkeleton,
  ScreenContainer,
} from '@/components/ui';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { repository } from '@/lib/repository';
import {
  isExpoGo,
  loadNativeNotifications,
  nativeNotificationsAvailable,
} from '@/lib/native-notifications';
import { readSmallJson, saveSmallJson, sessionStorage } from '@/lib/storage';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { radii, spacing } from '@/theme';

const pushTokenKey = (userId: string) => `push-token:${userId}`;

function expoProjectId(): string | undefined {
  const configured = Constants.expoConfig?.extra?.eas?.projectId;
  return (
    Constants.easConfig?.projectId ??
    (typeof configured === 'string' && configured.trim() ? configured : undefined)
  );
}

export default function NotificationPreferencesScreen() {
  return (
    <RequireAuth>
      <NotificationsContent />
    </RequireAuth>
  );
}

function NotificationsContent() {
  const auth = useAuth();
  const palette = useAppColors();
  const [enabled, setEnabled] = useState(false);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [isError, setIsError] = useState(false);
  const available = nativeNotificationsAvailable;

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!auth.user || !available) {
        if (mounted) setChecking(false);
        return;
      }
      try {
        const storedToken = await readSmallJson<string>(pushTokenKey(auth.user.id));
        if (mounted) {
          setEnabled(Boolean(storedToken) && Boolean(auth.profile?.notifications_enabled));
        }
      } catch {
        if (mounted) {
          setEnabled(false);
          setIsError(true);
          setMessage('No se ha podido comprobar el registro de avisos de este dispositivo.');
        }
      } finally {
        if (mounted) setChecking(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [auth.profile?.notifications_enabled, auth.user, available]);

  const enablePush = async () => {
    if (!auth.user) return;
    setMessage(undefined);
    setIsError(false);

    if (Platform.OS === 'web') {
      setIsError(true);
      setMessage('Los avisos push están disponibles en las aplicaciones de iOS y Android.');
      return;
    }
    if (isExpoGo) {
      setIsError(true);
      setMessage(
        'Expo Go no admite los avisos push de Pagaste. Usa una development build para activarlos.',
      );
      return;
    }
    if (!Device.isDevice) {
      setIsError(true);
      setMessage(
        'Para activar avisos push, abre Pagaste en un dispositivo físico. El simulador no recibe tokens push.',
      );
      return;
    }
    const projectId = expoProjectId();
    if (!projectId) {
      setIsError(true);
      setMessage(
        'Falta vincular esta compilación con un proyecto EAS. Añade el projectId antes de activar los avisos.',
      );
      return;
    }

    setSaving(true);
    let registeredToken: string | undefined;
    try {
      const Notifications = await loadNativeNotifications();
      if (!Notifications) throw new Error('NOTIFICATIONS_UNAVAILABLE');
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('pagaste', {
          name: 'Pagaste',
          description: 'Cambios importantes en cobros y revisiones.',
          importance: Notifications.AndroidImportance.DEFAULT,
          vibrationPattern: [0, 180],
        });
      }
      const currentPermission = await Notifications.getPermissionsAsync();
      const permission = currentPermission.granted
        ? currentPermission
        : await Notifications.requestPermissionsAsync({
            ios: { allowAlert: true, allowBadge: true, allowSound: true },
          });
      if (!permission.granted) {
        throw new Error('PERMISSION_DENIED');
      }

      const expoToken = await Notifications.getExpoPushTokenAsync({ projectId });
      registeredToken = expoToken.data;
      await repository.savePushToken({
        userId: auth.user.id,
        token: registeredToken,
        platform: Platform.OS,
        deviceName: Device.deviceName ?? undefined,
      });
      await saveSmallJson(pushTokenKey(auth.user.id), registeredToken);
      await repository.saveProfile(auth.user.id, { notifications_enabled: true });
      await auth.refreshProfile();
      setEnabled(true);
      setMessage('Avisos activados en este dispositivo.');
    } catch (cause) {
      if (registeredToken) {
        await repository.deletePushToken(registeredToken).catch(() => undefined);
        await sessionStorage.removeItem(pushTokenKey(auth.user.id)).catch(() => undefined);
      }
      setEnabled(false);
      setIsError(true);
      setMessage(
        cause instanceof Error && cause.message === 'PERMISSION_DENIED'
          ? 'No has concedido permiso. Puedes habilitar las notificaciones desde los ajustes del sistema.'
          : 'No se han podido activar los avisos. Comprueba la conexión e inténtalo de nuevo.',
      );
    } finally {
      setSaving(false);
    }
  };

  const disablePush = async () => {
    if (!auth.user) return;
    const previous = enabled;
    let preferenceDisabled = false;
    setSaving(true);
    setMessage(undefined);
    setIsError(false);
    try {
      // Disable delivery first. Token cleanup follows so a partial failure stays private.
      await repository.saveProfile(auth.user.id, { notifications_enabled: false });
      preferenceDisabled = true;
      setEnabled(false);
      await repository.deletePushTokens(auth.user.id);
      await sessionStorage.removeItem(pushTokenKey(auth.user.id));
      await auth.refreshProfile();
      setMessage('Avisos desactivados y tokens eliminados.');
    } catch {
      setEnabled(preferenceDisabled ? false : previous);
      setIsError(true);
      setMessage(
        preferenceDisabled
          ? 'Los avisos están desactivados. No hemos podido terminar de limpiar el token; inténtalo de nuevo más tarde.'
          : 'No se han podido actualizar los avisos. Inténtalo de nuevo.',
      );
    } finally {
      setSaving(false);
    }
  };

  const change = (value: boolean) => {
    if (saving) return;
    if (value) void enablePush();
    else void disablePush();
  };

  return (
    <ScreenContainer>
      <PageHeader title="Avisos y recordatorios" />
      <ListCard>
        <View style={styles.settingRow}>
          <View style={[styles.iconBubble, { backgroundColor: palette.primaryLight }]}>
            <BellRing color={palette.primary} size={22} />
          </View>
          <View style={styles.flex}>
            <AppText variant="sectionTitle">Avisos de pagos</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              Recibe avisos cuando alguien marque un pago, abra una revisión o se confirme una
              solicitud.
            </AppText>
          </View>
          <View style={styles.switchSlot}>
            {checking ? (
              <LoadingSkeleton height={32} />
            ) : (
              <Switch
                accessibilityLabel="Avisos de pagos en este dispositivo"
                accessibilityState={{ busy: saving }}
                disabled={saving || !available}
                value={enabled}
                onValueChange={change}
                ios_backgroundColor={palette.divider}
                thumbColor={palette.surface}
                trackColor={{ false: palette.disabled, true: palette.primary }}
              />
            )}
          </View>
        </View>
        <Divider inset={76} />
        <View style={styles.supportingRow}>
          <Smartphone color={palette.textMuted} size={18} />
          {Platform.OS === 'web' ? (
            <AppText variant="caption" color={palette.textSecondary} style={styles.flex}>
              La versión web no registra tokens push. Usa Pagaste en iOS o Android para activarlos.
            </AppText>
          ) : isExpoGo ? (
            <AppText variant="caption" color={palette.textSecondary} style={styles.flex}>
              Expo Go no incluye los avisos push remotos. Instala una development build de Pagaste
              para activarlos.
            </AppText>
          ) : (
            <AppText variant="caption" color={palette.textSecondary} style={styles.flex}>
              El permiso del sistema solo se solicita al activar este interruptor. Puedes revocarlo
              cuando quieras.
            </AppText>
          )}
        </View>
      </ListCard>

      <Card padding="spacious" style={styles.reminderCard}>
        <View style={[styles.iconBubble, { backgroundColor: palette.warningLight }]}>
          <Clock3 color={palette.warningInk} size={22} />
        </View>
        <View style={styles.flex}>
          <AppText variant="sectionTitle">Recordatorios</AppText>
          <AppText color={palette.textSecondary}>
            Los recordatorios son manuales y privados. No enviamos más de uno cada 24 horas ni
            recordamos cobros disputados, confirmados o cancelados.
          </AppText>
        </View>
      </Card>
      {message ? (
        <View
          style={[
            styles.message,
            { backgroundColor: isError ? palette.dangerLight : palette.successLight },
          ]}
        >
          <Info color={isError ? palette.dangerInk : palette.successInk} size={18} />
          <AppText
            variant="bodySmall"
            color={isError ? palette.dangerInk : palette.successInk}
            style={styles.flex}
          >
            {message}
          </AppText>
        </View>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  settingRow: {
    minHeight: 104,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconBubble: {
    width: 48,
    height: 48,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchSlot: { width: 52, minHeight: 36, justifyContent: 'center' },
  supportingRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  reminderCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  message: {
    borderRadius: radii.control,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
