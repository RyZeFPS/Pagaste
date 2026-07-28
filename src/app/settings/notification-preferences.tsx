import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { BellRing, Clock3, Info, Smartphone } from 'lucide-react-native';
import {
  AppButton,
  AppInput,
  AppText,
  Card,
  Divider,
  ListCard,
  LoadingSkeleton,
  ScreenContainer,
} from '@/components/ui';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { useI18n } from '@/i18n';
import type { ReminderPreferences, ReminderTone } from '@/lib/models';
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

function defaultReminderPreferences(userId = ''): ReminderPreferences {
  return {
    user_id: userId,
    enabled: true,
    first_delay_hours: 24,
    second_delay_days: 3,
    quiet_start: '22:00:00',
    quiet_end: '08:00:00',
    message_tone: 'neutral',
    group_same_debtor: true,
  };
}

function shortTime(value: string | null): string {
  return value?.slice(0, 5) ?? '';
}

function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

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
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reminders, setReminders] = useState<ReminderPreferences>(
    defaultReminderPreferences(auth.user?.id),
  );
  const [checkingReminders, setCheckingReminders] = useState(true);
  const [savingReminders, setSavingReminders] = useState(false);
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('08:00');
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
          setMessage(t('notifications.checkError'));
        }
      } finally {
        if (mounted) setChecking(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [auth.profile?.notifications_enabled, auth.user, available, t]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!auth.user) {
        if (mounted) setCheckingReminders(false);
        return;
      }
      try {
        const next = await repository.reminderPreferences(auth.user.id);
        if (mounted) {
          setReminders(next);
          setQuietStart(shortTime(next.quiet_start));
          setQuietEnd(shortTime(next.quiet_end));
        }
      } catch {
        if (mounted) {
          setIsError(true);
          setMessage(t('reminders.loadError'));
        }
      } finally {
        if (mounted) setCheckingReminders(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [auth.user, t]);

  const changeReminder = <K extends keyof ReminderPreferences>(
    key: K,
    value: ReminderPreferences[K],
  ) => {
    setReminders((current) => ({ ...current, [key]: value }));
  };

  const saveReminders = async () => {
    if (!auth.user) return;
    const quietEnabled = reminders.quiet_start !== null;
    if (
      quietEnabled &&
      (!validTime(quietStart) || !validTime(quietEnd) || quietStart === quietEnd)
    ) {
      setIsError(true);
      setMessage(t('reminders.invalidHours'));
      return;
    }
    setSavingReminders(true);
    setIsError(false);
    setMessage(undefined);
    try {
      const saved = await repository.saveReminderPreferences(auth.user.id, {
        enabled: reminders.enabled,
        first_delay_hours: reminders.first_delay_hours,
        second_delay_days: reminders.second_delay_days,
        quiet_start: quietEnabled ? `${quietStart}:00` : null,
        quiet_end: quietEnabled ? `${quietEnd}:00` : null,
        message_tone: reminders.message_tone,
        group_same_debtor: reminders.group_same_debtor,
      });
      setReminders(saved);
      setQuietStart(shortTime(saved.quiet_start));
      setQuietEnd(shortTime(saved.quiet_end));
      setMessage(t('reminders.saved'));
    } catch {
      setIsError(true);
      setMessage(t('reminders.saveError'));
    } finally {
      setSavingReminders(false);
    }
  };

  const enablePush = async () => {
    if (!auth.user) return;
    setMessage(undefined);
    setIsError(false);

    if (Platform.OS === 'web') {
      setIsError(true);
      setMessage(t('notifications.mobileOnly'));
      return;
    }
    if (isExpoGo) {
      setIsError(true);
      setMessage(t('notifications.expoGoUnsupported'));
      return;
    }
    if (!Device.isDevice) {
      setIsError(true);
      setMessage(t('notifications.physicalDevice'));
      return;
    }
    const projectId = expoProjectId();
    if (!projectId) {
      setIsError(true);
      setMessage(t('notifications.easMissing'));
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
          description: t('notifications.channelDescription'),
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
      setMessage(t('notifications.enabled'));
    } catch (cause) {
      if (registeredToken) {
        await repository.deletePushToken(registeredToken).catch(() => undefined);
        await sessionStorage.removeItem(pushTokenKey(auth.user.id)).catch(() => undefined);
      }
      setEnabled(false);
      setIsError(true);
      setMessage(
        cause instanceof Error && cause.message === 'PERMISSION_DENIED'
          ? t('notifications.permissionDenied')
          : t('notifications.enableError'),
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
      setMessage(t('notifications.disabled'));
    } catch {
      setEnabled(preferenceDisabled ? false : previous);
      setIsError(true);
      setMessage(
        preferenceDisabled ? t('notifications.disabledPartial') : t('notifications.updateError'),
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
      <PageHeader title={t('notifications.pageTitle')} />
      <ListCard>
        <View style={styles.settingRow}>
          <View style={[styles.iconBubble, { backgroundColor: palette.primaryLight }]}>
            <BellRing color={palette.primary} size={22} />
          </View>
          <View style={styles.flex}>
            <AppText variant="sectionTitle">{t('notifications.paymentAlerts')}</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {t('notifications.paymentAlertsBody')}
            </AppText>
          </View>
          <View style={styles.switchSlot}>
            {checking ? (
              <LoadingSkeleton height={32} />
            ) : (
              <Switch
                accessibilityLabel={t('notifications.deviceA11y')}
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
              {t('notifications.webHelp')}
            </AppText>
          ) : isExpoGo ? (
            <AppText variant="caption" color={palette.textSecondary} style={styles.flex}>
              {t('notifications.expoHelp')}
            </AppText>
          ) : (
            <AppText variant="caption" color={palette.textSecondary} style={styles.flex}>
              {t('notifications.permissionHelp')}
            </AppText>
          )}
        </View>
      </ListCard>

      <Card padding="spacious" style={styles.reminderSettingsCard}>
        <View style={styles.settingRowCompact}>
          <View style={[styles.iconBubble, { backgroundColor: palette.warningLight }]}>
            <Clock3 color={palette.warningInk} size={22} />
          </View>
          <View style={styles.flex}>
            <AppText variant="sectionTitle">{t('reminders.title')}</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {t('reminders.configDescription')}
            </AppText>
          </View>
          {checkingReminders ? (
            <View style={styles.switchSlot}>
              <LoadingSkeleton height={32} />
            </View>
          ) : (
            <Switch
              accessibilityLabel={t('reminders.enabled')}
              disabled={savingReminders}
              value={reminders.enabled}
              onValueChange={(value) => changeReminder('enabled', value)}
              ios_backgroundColor={palette.divider}
              thumbColor={palette.surface}
              trackColor={{ false: palette.disabled, true: palette.primary }}
            />
          )}
        </View>

        <Divider />

        <View style={styles.controlGroup}>
          <AppText variant="label">{t('reminders.first')}</AppText>
          <View style={styles.segmented}>
            {([24, 48, 72] as const).map((hours) => (
              <AppButton
                key={hours}
                title={t('reminders.hoursShort', { count: hours })}
                size="sm"
                variant={reminders.first_delay_hours === hours ? 'primary' : 'ghost'}
                style={styles.segmentButton}
                onPress={() => changeReminder('first_delay_hours', hours)}
              />
            ))}
          </View>
        </View>

        <AppInput
          label={t('reminders.second')}
          value={String(reminders.second_delay_days)}
          onChangeText={(value) => {
            const parsed = Number.parseInt(value.replace(/\D/gu, ''), 10);
            changeReminder(
              'second_delay_days',
              Number.isFinite(parsed) ? Math.min(30, Math.max(2, parsed)) : 2,
            );
          }}
          keyboardType="number-pad"
          inputMode="numeric"
          hint={t('notifications.secondDelayHint')}
        />

        <View style={styles.settingRowCompact}>
          <View style={styles.flex}>
            <AppText variant="label">{t('reminders.quietHours')}</AppText>
          </View>
          <Switch
            accessibilityLabel={t('reminders.quietHours')}
            disabled={savingReminders}
            value={reminders.quiet_start !== null}
            onValueChange={(value) => {
              changeReminder('quiet_start', value ? `${quietStart}:00` : null);
              changeReminder('quiet_end', value ? `${quietEnd}:00` : null);
            }}
            ios_backgroundColor={palette.divider}
            thumbColor={palette.surface}
            trackColor={{ false: palette.disabled, true: palette.primary }}
          />
        </View>
        {reminders.quiet_start !== null ? (
          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <AppInput
                label={t('reminders.quietStart')}
                value={quietStart}
                onChangeText={setQuietStart}
                placeholder="22:00"
                inputMode="text"
              />
            </View>
            <View style={styles.timeField}>
              <AppInput
                label={t('reminders.quietEnd')}
                value={quietEnd}
                onChangeText={setQuietEnd}
                placeholder="08:00"
                inputMode="text"
              />
            </View>
          </View>
        ) : null}

        <View style={styles.controlGroup}>
          <AppText variant="label">{t('reminders.toneNeutral')}</AppText>
          <View style={styles.segmented}>
            {(
              [
                ['soft', t('reminders.toneSoft')],
                ['neutral', t('reminders.toneNeutral')],
                ['direct', t('reminders.toneDirect')],
              ] as [ReminderTone, string][]
            ).map(([tone, label]) => (
              <AppButton
                key={tone}
                title={label}
                size="sm"
                variant={reminders.message_tone === tone ? 'primary' : 'ghost'}
                style={styles.segmentButton}
                onPress={() => changeReminder('message_tone', tone)}
              />
            ))}
          </View>
        </View>

        <View style={styles.settingRowCompact}>
          <View style={styles.flex}>
            <AppText variant="label">{t('reminders.groupDebts')}</AppText>
            <AppText variant="caption" color={palette.textSecondary}>
              {t('reminders.groupDebtsDescription')}
            </AppText>
          </View>
          <Switch
            accessibilityLabel={t('reminders.groupDebts')}
            disabled={savingReminders}
            value={reminders.group_same_debtor}
            onValueChange={(value) => changeReminder('group_same_debtor', value)}
            ios_backgroundColor={palette.divider}
            thumbColor={palette.surface}
            trackColor={{ false: palette.disabled, true: palette.primary }}
          />
        </View>

        <AppButton
          title={t('reminders.save')}
          fullWidth
          loading={savingReminders}
          disabled={checkingReminders}
          onPress={() => void saveReminders()}
        />
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
  reminderSettingsCard: { gap: spacing.lg },
  settingRowCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  controlGroup: { gap: spacing.sm },
  segmented: {
    padding: 3,
    borderRadius: radii.control,
    flexDirection: 'row',
    gap: 3,
  },
  segmentButton: { minWidth: 0, flex: 1, borderWidth: 0 },
  timeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  timeField: { minWidth: 0, flex: 1 },
  message: {
    borderRadius: radii.control,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
