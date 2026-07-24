import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown, FadeInLeft, ReduceMotion } from 'react-native-reanimated';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  MailCheck,
  SearchCheck,
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
import { useAuth } from '@/providers/auth-provider';
import { useI18n } from '@/i18n';
import { radii, spacing } from '@/theme';

const headerEnter = FadeInDown.duration(320).reduceMotion(ReduceMotion.System);
const activityEnter = (index: number) =>
  FadeInLeft.duration(330)
    .delay(55 + Math.min(index, 5) * 34)
    .reduceMotion(ReduceMotion.System);
const PAYMENT_CHECK_DELAY_MS = 10 * 60 * 1000;
const PAYMENT_CHECK_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function paymentCheckAvailability(
  sentAt: string | null,
  events: { event_type: string; created_at: string }[] | undefined,
) {
  const now = Date.now();
  const sentTime = sentAt ? new Date(sentAt).getTime() : now;
  const readyAt = sentTime + PAYMENT_CHECK_DELAY_MS;
  const lastRequest = events
    ?.filter((event) => event.event_type === 'payment_check_requested')
    .reduce((latest, event) => Math.max(latest, new Date(event.created_at).getTime()), 0);
  if (readyAt > now) {
    return {
      enabled: false,
      label: `Disponible en ${Math.max(1, Math.ceil((readyAt - now) / 60_000))} min`,
    };
  }
  if (lastRequest && lastRequest + PAYMENT_CHECK_COOLDOWN_MS > now) {
    return { enabled: false, label: 'Aviso enviado' };
  }
  return { enabled: true, label: 'Pedir que revise el ingreso' };
}

export default function ActivityScreen() {
  const router = useRouter();
  const palette = useAppColors();
  const auth = useAuth();
  const { formatMoney } = useI18n();
  const cache = useQueryClient();
  const [feedback, setFeedback] = useState<string>();
  const query = useQuery({ queryKey: ['claims'], queryFn: () => repository.listClaims() });
  const paymentCheck = useMutation({
    mutationFn: repository.requestPaymentCheck,
    onSuccess: async () => {
      setFeedback('Aviso enviado. El cobro sigue pendiente hasta que la otra persona lo confirme.');
      await cache.invalidateQueries({ queryKey: ['claims'] });
    },
    onError: (error: Error) => setFeedback(error.message),
  });

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

        {feedback ? (
          <Card variant="flat" style={{ backgroundColor: palette.primaryLight }}>
            <AppText variant="bodySmall" color={palette.primary}>
              {feedback}
            </AppText>
          </Card>
        ) : null}

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
                body="Cuando envíes o recibas una solicitud, aquí verás pagos, recordatorios y revisiones."
                action={
                  <AppButton title="Crear un gasto" onPress={() => router.push('/expense/new')} />
                }
              />
            </Card>
          </Animated.View>
        ) : (
          <Card variant="grouped">
            {query.data.map((claim, index) => {
              const incoming = claim.debtor?.user_id === auth.user?.id;
              const name = incoming
                ? (claim.creditor?.display_name ?? 'Una persona del grupo')
                : (claim.debtor?.display_name ?? 'Participante');
              const merchantName = claim.expense?.merchant_name?.trim() || null;
              const presentation =
                claim.status === 'received'
                  ? {
                      label: 'Recibido',
                      message: incoming
                        ? `${name} ha marcado el cobro como recibido.`
                        : `Has marcado como recibido el cobro de ${name}.`,
                      color: palette.successInk,
                      Icon: CheckCircle2,
                    }
                  : claim.status === 'disputed'
                    ? {
                        label: 'En revisión',
                        message: incoming
                          ? `Has pedido a ${name} revisar este cobro.`
                          : `${name} ha pedido revisar el cobro.`,
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
                            message: incoming
                              ? `${name} te ha enviado un recordatorio.`
                              : `${name} tiene un recordatorio reciente.`,
                            color: palette.primary,
                            Icon: MailCheck,
                          }
                        : {
                            label: 'Pendiente',
                            message: incoming
                              ? `${name} te ha solicitado este pago.`
                              : `Esperando el pago de ${name}.`,
                            color: palette.warningInk,
                            Icon: Clock3,
                          };
              const activityDetail = merchantName
                ? `${presentation.message} · ${merchantName}`
                : presentation.message;

              const canRequestCheck =
                incoming && ['pending', 'reminder_sent'].includes(claim.status);
              const checkAvailability = paymentCheckAvailability(claim.sent_at, claim.events);

              return (
                <Animated.View key={claim.id} entering={activityEnter(index)}>
                  <Pressable
                    accessibilityRole={incoming ? undefined : 'button'}
                    accessibilityLabel={`${presentation.label} de ${name}${merchantName ? ` en ${merchantName}` : ''}, ${formatMoney(claim.amount_cents)}`}
                    disabled={incoming}
                    onPress={
                      incoming
                        ? undefined
                        : () => router.push(`/expense/${claim.expense_id}/status`)
                    }
                    style={({ pressed }) => [
                      styles.activityRow,
                      pressed && { backgroundColor: palette.primaryLight },
                    ]}
                  >
                    <View style={styles.avatarWithMerchant}>
                      <Avatar
                        name={name}
                        uri={incoming ? claim.creditor?.avatar_path : claim.debtor?.avatar_path}
                        size={46}
                      />
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
                    {!incoming ? (
                      <ChevronRight color={palette.textMuted} size={19} strokeWidth={1.8} />
                    ) : null}
                  </Pressable>
                  {canRequestCheck ? (
                    <View
                      style={[
                        styles.paymentCheck,
                        { borderTopColor: palette.divider, backgroundColor: palette.background },
                      ]}
                    >
                      <View style={styles.paymentCheckCopy}>
                        <SearchCheck color={palette.primary} size={18} />
                        <AppText
                          variant="caption"
                          color={palette.textSecondary}
                          style={styles.flex}
                        >
                          Si ya hiciste el Bizum, avisa para que revise su banco. No confirma el
                          pago ni cambia su estado.
                        </AppText>
                      </View>
                      <AppButton
                        title={checkAvailability.label}
                        size="sm"
                        variant="outline"
                        disabled={!checkAvailability.enabled}
                        loading={paymentCheck.isPending && paymentCheck.variables === claim.id}
                        onPress={() => paymentCheck.mutate(claim.id)}
                      />
                    </View>
                  ) : null}
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
  paymentCheck: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  paymentCheckCopy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
