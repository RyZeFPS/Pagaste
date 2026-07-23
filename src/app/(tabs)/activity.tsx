import { Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown, FadeInLeft, ReduceMotion } from 'react-native-reanimated';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  MailCheck,
  WalletCards,
  XCircle,
} from 'lucide-react-native';
import {
  AppButton,
  AppText,
  Avatar,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  ScreenContainer,
} from '@/components/ui';
import { ListRowsSkeleton } from '@/components/loading-skeletons';
import { MerchantLogo } from '@/components/merchant-logo';
import { repository } from '@/lib/repository';
import { useAppColors } from '@/providers/app-providers';
import { useI18n } from '@/i18n';
import { radii, spacing } from '@/theme';

const headerEnter = FadeInDown.duration(320).reduceMotion(ReduceMotion.System);
const activityEnter = (index: number) =>
  FadeInLeft.duration(330)
    .delay(55 + Math.min(index, 5) * 34)
    .reduceMotion(ReduceMotion.System);

export default function ActivityScreen() {
  const router = useRouter();
  const palette = useAppColors();
  const { formatMoney } = useI18n();
  const query = useQuery({ queryKey: ['claims'], queryFn: () => repository.listClaims() });

  return (
    <ScreenContainer floatingTabs>
      <View style={styles.screen}>
        <Animated.View entering={headerEnter} style={styles.header}>
          <AppText variant="display" style={styles.title}>
            Actividad
          </AppText>
          <AppText variant="bodySmall" color={palette.textSecondary}>
            Sigue cada cobro sin perderte ningún movimiento.
          </AppText>
        </Animated.View>

        {query.isPending && query.data === undefined ? (
          <Animated.View entering={activityEnter(0)}>
            <ListRowsSkeleton count={3} rowHeight={82} />
          </Animated.View>
        ) : query.isError ? (
          <Animated.View entering={activityEnter(0)}>
            <Card variant="grouped">
              <ErrorState
                body="No hemos podido cargar la actividad."
                onRetry={() => void query.refetch()}
              />
            </Card>
          </Animated.View>
        ) : !query.data?.length ? (
          <Animated.View entering={activityEnter(0)}>
            <Card variant="grouped" style={styles.emptyCard}>
              <View style={[styles.emptyIcon, { backgroundColor: palette.primaryLight }]}>
                <WalletCards color={palette.primary} size={28} strokeWidth={1.8} />
              </View>
              <EmptyState
                title="Todo tranquilo por aquí"
                body="Cuando envíes un cobro, aquí verás pagos, recordatorios y revisiones."
                action={
                  <AppButton title="Crear un gasto" onPress={() => router.push('/expense/new')} />
                }
              />
            </Card>
          </Animated.View>
        ) : (
          <Card variant="grouped">
            {query.data.map((claim, index) => {
              const name = claim.debtor?.display_name ?? 'Participante';
              const merchantName = claim.expense?.merchant_name?.trim() || null;
              const presentation =
                claim.status === 'received'
                  ? {
                      label: 'Recibido',
                      message: `Has marcado como recibido el cobro de ${name}.`,
                      color: palette.successInk,
                      Icon: CheckCircle2,
                    }
                  : claim.status === 'disputed'
                    ? {
                        label: 'En revisión',
                        message: `${name} ha pedido revisar el cobro.`,
                        color: palette.dangerInk,
                        Icon: AlertCircle,
                      }
                    : claim.status === 'cancelled'
                      ? {
                          label: 'Cancelado',
                          message: 'La solicitud se ha cancelado.',
                          color: palette.textMuted,
                          Icon: XCircle,
                        }
                      : claim.status === 'reminder_sent'
                        ? {
                            label: 'Recordatorio enviado',
                            message: `${name} tiene un recordatorio reciente.`,
                            color: palette.primary,
                            Icon: MailCheck,
                          }
                        : {
                            label: 'Pendiente',
                            message: `Esperando el pago de ${name}.`,
                            color: palette.warningInk,
                            Icon: Clock3,
                          };
              const activityDetail = merchantName
                ? `${presentation.message} · ${merchantName}`
                : presentation.message;

              return (
                <Animated.View key={claim.id} entering={activityEnter(index)}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${presentation.label} de ${name}${merchantName ? ` en ${merchantName}` : ''}, ${formatMoney(claim.amount_cents)}`}
                    onPress={() => router.push(`/expense/${claim.expense_id}/status`)}
                    style={({ pressed }) => [
                      styles.activityRow,
                      pressed && { backgroundColor: palette.primaryLight },
                    ]}
                  >
                    <View style={styles.avatarWithMerchant}>
                      <Avatar name={name} uri={claim.debtor?.avatar_path} size={46} />
                      {merchantName ? (
                        <MerchantLogo
                          merchantName={merchantName}
                          fallbackLabel={claim.expense?.title || 'Comercio'}
                          size={22}
                          style={[styles.merchantBadge, { borderColor: palette.surface }]}
                        />
                      ) : null}
                    </View>
                    <View style={styles.activityCopy}>
                      <AppText numberOfLines={1} style={styles.personName}>
                        {name}
                      </AppText>
                      <AppText numberOfLines={2} variant="bodySmall" color={palette.textSecondary}>
                        {activityDetail}
                      </AppText>
                    </View>
                    <View style={styles.activityMeta}>
                      <AppText numberOfLines={1} tabular style={styles.amount}>
                        {formatMoney(claim.amount_cents)}
                      </AppText>
                      <View style={styles.status}>
                        <presentation.Icon color={presentation.color} size={15} strokeWidth={2} />
                        <AppText
                          numberOfLines={2}
                          color={presentation.color}
                          style={styles.statusText}
                        >
                          {presentation.label}
                        </AppText>
                      </View>
                    </View>
                    <ChevronRight color={palette.textMuted} size={19} strokeWidth={1.8} />
                  </Pressable>
                  {index < query.data.length - 1 ? <Divider inset={74} /> : null}
                </Animated.View>
              );
            })}
          </Card>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: {
    width: '100%',
    gap: spacing.xl,
  },
  header: {
    minHeight: 68,
    justifyContent: 'center',
    gap: spacing.xs,
  },
  title: {
    letterSpacing: -0.7,
  },
  emptyCard: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
    alignItems: 'center',
    gap: 0,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityRow: {
    minHeight: 82,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  activityCopy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  avatarWithMerchant: {
    width: 48,
    height: 48,
    justifyContent: 'center',
  },
  merchantBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    borderWidth: 2,
  },
  personName: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  activityMeta: {
    maxWidth: 126,
    alignItems: 'flex-end',
    gap: 4,
  },
  amount: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
  },
  statusText: {
    maxWidth: 100,
    textAlign: 'right',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
});
