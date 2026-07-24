import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CheckCheck, ChevronRight, Info } from 'lucide-react-native';
import {
  AppButton,
  AppText,
  Avatar,
  BottomSheet,
  EmptyState,
  LoadingSkeleton,
} from '@/components/ui';
import type { AppNotification } from '@/lib/models';
import {
  formatNotificationMoney,
  getNotificationPresentation,
} from '@/lib/notification-presentation';
import { repository } from '@/lib/repository';
import { supabase } from '@/lib/supabase/client';
import type { AppColors } from '@/theme';
import { radii, spacing } from '@/theme';

type NotificationCenterValue = {
  unreadCount: number;
  notifications: AppNotification[];
  isLoading: boolean;
  markAllSeen: () => void;
};

const NotificationCenterContext = createContext<NotificationCenterValue>({
  unreadCount: 0,
  notifications: [],
  isLoading: false,
  markAllSeen: () => undefined,
});

export function NotificationCenterProvider({
  children,
  userId,
  palette,
}: PropsWithChildren<{ userId?: string; palette: AppColors }>) {
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState(false);
  const [previewIds, setPreviewIds] = useState<string[]>([]);
  const notificationsKey = useMemo(() => ['app-notifications', userId] as const, [userId]);
  const countKey = useMemo(() => ['app-notifications-unread', userId] as const, [userId]);
  const notifications = useQuery({
    queryKey: notificationsKey,
    queryFn: () => repository.listAppNotifications(userId!),
    enabled: Boolean(userId),
  });
  const unread = useQuery({
    queryKey: countKey,
    queryFn: () => repository.unreadNotificationCount(userId!),
    enabled: Boolean(userId),
  });
  const previewNotifications = useMemo(
    () => (notifications.data ?? []).filter((item) => previewIds.includes(item.id)),
    [notifications.data, previewIds],
  );

  const markSeen = useCallback(
    (ids: string[]) => {
      if (!userId || !ids.length) return;
      const unreadIds = (notifications.data ?? [])
        .filter((item) => !item.read_at && ids.includes(item.id))
        .map((item) => item.id);
      if (!unreadIds.length) return;
      const seenAt = new Date().toISOString();
      queryClient.setQueryData<number>(countKey, (current) =>
        Math.max(0, (current ?? unreadIds.length) - unreadIds.length),
      );
      queryClient.setQueryData<AppNotification[]>(notificationsKey, (current) =>
        current?.map((item) => (unreadIds.includes(item.id) ? { ...item, read_at: seenAt } : item)),
      );
      void repository.markNotificationsRead(unreadIds).catch(() => {
        void queryClient.invalidateQueries({ queryKey: notificationsKey });
        void queryClient.invalidateQueries({ queryKey: countKey });
      });
    },
    [countKey, notifications.data, notificationsKey, queryClient, userId],
  );

  const markAllSeen = useCallback(() => {
    markSeen((notifications.data ?? []).map((item) => item.id));
  }, [markSeen, notifications.data]);

  const closePreview = useCallback(() => {
    setVisible(false);
    setPreviewIds([]);
  }, []);

  useEffect(() => {
    if (!userId || !supabase) return;
    const channel = supabase
      .channel(`pagaste-notification-center-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'app_notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          void queryClient.invalidateQueries({ queryKey: notificationsKey });
          void queryClient.invalidateQueries({ queryKey: countKey });
          if (
            payload.eventType === 'INSERT' &&
            typeof (payload.new as Partial<AppNotification>).id === 'string'
          ) {
            setPreviewIds([(payload.new as Partial<AppNotification>).id!]);
            setVisible(true);
          }
        },
      )
      .subscribe();
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [countKey, notificationsKey, queryClient, userId]);

  useEffect(() => {
    if (!visible) return;
    markSeen(previewNotifications.map((item) => item.id));
  }, [markSeen, previewNotifications, visible]);

  const value = useMemo(
    () => ({
      unreadCount: unread.data ?? 0,
      notifications: notifications.data ?? [],
      isLoading: notifications.isPending,
      markAllSeen,
    }),
    [markAllSeen, notifications.data, notifications.isPending, unread.data],
  );

  return (
    <NotificationCenterContext.Provider value={value}>
      {children}
      <BottomSheet
        visible={Boolean(userId) && visible}
        onClose={closePreview}
        title="Notificaciones"
      >
        <View style={styles.sheetIntro}>
          <View style={styles.introCopy}>
            <Info color={palette.primary} size={18} />
            <AppText variant="bodySmall" color={palette.textSecondary} style={styles.flex}>
              Aquí ves qué ha ocurrido. Abre el historial para consultar todas tus notificaciones.
            </AppText>
          </View>
          <AppButton
            title="Ver todas las notificaciones"
            variant="secondary"
            size="sm"
            leftIcon={<BellRing color={palette.primary} size={17} />}
            onPress={() => {
              closePreview();
              router.push('/settings/notifications');
            }}
          />
        </View>

        {!previewNotifications.length && previewIds.length ? (
          <LoadingSkeleton height={84} />
        ) : !previewNotifications.length ? (
          <EmptyState
            title="No tienes notificaciones"
            body="Las nuevas solicitudes y avisos aparecerán aquí."
          />
        ) : (
          <View style={[styles.list, { borderColor: palette.border }]}>
            {previewNotifications.map((item, index) => {
              const presentation = getNotificationPresentation(item);
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${presentation.title}. ${presentation.body}`}
                  onPress={() => {
                    closePreview();
                    router.push('/settings/notifications');
                  }}
                  style={({ pressed }) => [
                    styles.notificationRow,
                    index > 0 && { borderTopColor: palette.divider, borderTopWidth: 1 },
                    pressed && { backgroundColor: palette.primaryLight },
                  ]}
                >
                  <Avatar name={presentation.person} uri={presentation.avatar} size={44} />
                  <View style={styles.flex}>
                    <AppText style={styles.notificationTitle}>{presentation.title}</AppText>
                    <AppText variant="bodySmall" color={palette.textSecondary} numberOfLines={2}>
                      {presentation.body}
                    </AppText>
                    <AppText color={palette.primary} style={styles.amount}>
                      {formatNotificationMoney(item)}
                    </AppText>
                  </View>
                  <ChevronRight color={palette.textMuted} size={19} />
                </Pressable>
              );
            })}
          </View>
        )}

        {previewNotifications.length ? (
          <View style={styles.seen}>
            <CheckCheck color={palette.success} size={17} />
            <AppText variant="bodySmall" color={palette.textSecondary}>
              Estas notificaciones ya quedan marcadas como vistas.
            </AppText>
          </View>
        ) : null}
      </BottomSheet>
    </NotificationCenterContext.Provider>
  );
}

export const useNotificationCenter = () => useContext(NotificationCenterContext);

const styles = StyleSheet.create({
  sheetIntro: {
    gap: spacing.md,
  },
  introCopy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  list: {
    borderWidth: 1,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  notificationRow: {
    minHeight: 84,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  notificationTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  amount: {
    marginTop: 3,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  seen: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
});
