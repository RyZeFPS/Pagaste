import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { BellRing, ChevronRight, Settings2 } from 'lucide-react-native';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import {
  AppText,
  Avatar,
  Card,
  EmptyState,
  IconButton,
  LoadingSkeleton,
  ScreenContainer,
} from '@/components/ui';
import {
  formatNotificationMoney,
  getNotificationPresentation,
} from '@/lib/notification-presentation';
import { useNotificationCenter } from '@/providers/notification-center-provider';
import { useAppColors } from '@/providers/app-providers';
import { radii, spacing } from '@/theme';

export default function NotificationsScreen() {
  return (
    <RequireAuth>
      <NotificationsContent />
    </RequireAuth>
  );
}

function NotificationsContent() {
  const palette = useAppColors();
  const { notifications, isLoading, markAllSeen } = useNotificationCenter();

  useEffect(() => {
    markAllSeen();
  }, [markAllSeen]);

  return (
    <ScreenContainer>
      <PageHeader
        title="Notificaciones"
        action={
          <IconButton
            label="Ajustes de notificaciones"
            variant="plain"
            icon={<Settings2 color={palette.textPrimary} size={22} />}
            onPress={() => router.push('/settings/notification-preferences' as Href)}
          />
        }
      />

      {isLoading ? (
        <Card>
          <LoadingSkeleton height={84} />
          <LoadingSkeleton height={84} />
          <LoadingSkeleton height={84} />
        </Card>
      ) : !notifications.length ? (
        <Card padding="spacious" style={styles.emptyCard}>
          <View style={[styles.emptyIcon, { backgroundColor: palette.primaryLight }]}>
            <BellRing color={palette.primary} size={26} />
          </View>
          <EmptyState
            title="No tienes notificaciones"
            body="Las solicitudes de pago y los avisos para revisar ingresos aparecerán aquí."
          />
        </Card>
      ) : (
        <View style={styles.list}>
          {notifications.map((item) => {
            const presentation = getNotificationPresentation(item);
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`${presentation.title}. ${presentation.body}`}
                onPress={() => router.push(presentation.detailRoute as Href)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: palette.surface,
                    borderColor: item.read_at ? palette.border : palette.primary,
                  },
                  pressed && { backgroundColor: palette.primaryLight },
                ]}
              >
                {!item.read_at ? (
                  <View
                    accessibilityLabel="Sin ver"
                    style={[styles.unreadDot, { backgroundColor: palette.danger }]}
                  />
                ) : null}
                <Avatar name={presentation.person} uri={presentation.avatar} size={48} />
                <View style={styles.copy}>
                  <AppText style={styles.title}>{presentation.title}</AppText>
                  <AppText variant="bodySmall" color={palette.textSecondary} numberOfLines={2}>
                    {presentation.body}
                  </AppText>
                  <AppText color={palette.primary} style={styles.amount}>
                    {formatNotificationMoney(item)}
                  </AppText>
                </View>
                <ChevronRight color={palette.textMuted} size={20} />
              </Pressable>
            );
          })}
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.md,
  },
  row: {
    position: 'relative',
    minHeight: 94,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  unreadDot: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    paddingRight: spacing.md,
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
  emptyCard: {
    alignItems: 'center',
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
