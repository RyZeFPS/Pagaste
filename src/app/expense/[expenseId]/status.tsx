import { useState } from 'react';
import { Linking, Share, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CheckCircle2,
  CircleAlert,
  Clock3,
  EllipsisVertical,
  Mail,
  XCircle,
} from 'lucide-react-native';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { ScreenLoadingSkeleton } from '@/components/loading-skeletons';
import { MerchantLogo } from '@/components/merchant-logo';
import {
  AppButton,
  AppText,
  Avatar,
  BottomSheet,
  Card,
  CurrencyAmount,
  Divider,
  EmptyState,
  ErrorState,
  IconButton,
  ListCard,
  ProgressBar,
  ScreenContainer,
  StatusLabel,
} from '@/components/ui';
import { sumCents } from '@/domain/money';
import { useI18n } from '@/i18n';
import { repository } from '@/lib/repository';
import type { ClaimStatus } from '@/lib/models';
import { useAppColors } from '@/providers/app-providers';
import { radii, spacing } from '@/theme';

const labels: Record<ClaimStatus, string> = {
  pending: 'Pendiente',
  received: 'Recibido',
  reminder_sent: 'Recordatorio enviado',
  disputed: 'En revisión',
  cancelled: 'Cancelado',
};

const disputeLabels: Record<string, string> = {
  did_not_consume: 'No consumió este producto',
  incorrect_amount: 'El importe no cuadra',
  already_paid: 'Indica que ya había pagado',
  unknown_expense: 'No reconoce el gasto',
  other: 'Otro motivo',
};

function reminderWaitHours(sentAt: string | null, lastRemindedAt: string | null): number {
  const base = Date.parse(lastRemindedAt ?? sentAt ?? '');
  if (!Number.isFinite(base)) return 24;
  return Math.max(0, Math.ceil((base + 86_400_000 - Date.now()) / 3_600_000));
}

export default function StatusScreen() {
  return (
    <RequireAuth>
      <StatusContent />
    </RequireAuth>
  );
}

function StatusContent() {
  const { expenseId = '' } = useLocalSearchParams<{ expenseId: string }>();
  const router = useRouter();
  const palette = useAppColors();
  const { formatDate, formatMoney } = useI18n();
  const cache = useQueryClient();
  const [feedback, setFeedback] = useState<string>();
  const [showMenu, setShowMenu] = useState(false);
  const query = useQuery({
    queryKey: ['expense', expenseId],
    queryFn: () => repository.expense(expenseId),
    refetchInterval: 20_000,
  });
  const refresh = () => cache.invalidateQueries({ queryKey: ['expense', expenseId] });

  const markReceived = useMutation({
    mutationFn: repository.markClaimReceived,
    onSuccess: async () => {
      setFeedback('Cobro marcado como recibido.');
      await refresh();
      await cache.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: () => setFeedback('No se ha podido registrar el cobro.'),
  });
  const resolveDispute = useMutation({
    mutationFn: ({ claimId, outcome }: { claimId: string; outcome: 'reopen' | 'cancel' }) =>
      repository.resolveDispute(claimId, outcome),
    onSuccess: async (result) => {
      setFeedback(
        result.status === 'cancelled'
          ? 'Revisión resuelta y solicitud cancelada.'
          : 'Revisión resuelta; la solicitud vuelve a estar pendiente.',
      );
      await refresh();
    },
    onError: () => setFeedback('No se ha podido resolver la revisión.'),
  });
  const remind = useMutation({
    mutationFn: repository.sendReminder,
    onSuccess: async (result) => {
      setFeedback('Recordatorio preparado para compartir.');
      await refresh();
      await Share.share({ message: `${result.message}\n${result.shareUrl}` });
    },
    onError: () => setFeedback('No se puede recordar ahora. Comprueba el límite de 24 horas.'),
  });

  if (query.isPending && !query.data) return <ScreenLoadingSkeleton variant="status" />;
  if (query.isError || !query.data) {
    return (
      <ScreenContainer>
        <ErrorState body="No hemos podido cargar el estado." onRetry={() => void query.refetch()} />
      </ScreenContainer>
    );
  }

  const active = query.data.claims.filter((claim) => claim.status !== 'cancelled');
  const total = sumCents(active.map((claim) => claim.amount_cents));
  const received = sumCents(
    active.filter((claim) => claim.status === 'received').map((claim) => claim.amount_cents),
  );
  const disputed = sumCents(
    active.filter((claim) => claim.status === 'disputed').map((claim) => claim.amount_cents),
  );
  const pendingClaims = active.filter(
    (claim) => claim.status === 'pending' || claim.status === 'reminder_sent',
  );
  const pending = sumCents(pendingClaims.map((claim) => claim.amount_cents));
  const eligiblePending = pendingClaims.filter(
    (claim) => reminderWaitHours(claim.sent_at, claim.last_reminded_at) === 0,
  );
  const nextReminderHours = pendingClaims.length
    ? Math.min(
        ...pendingClaims.map((claim) => reminderWaitHours(claim.sent_at, claim.last_reminded_at)),
      )
    : 0;
  const completed = total > 0 && received === total;

  const remindAll = async () => {
    const messages: string[] = [];
    for (const claim of eligiblePending) {
      try {
        const result = await repository.sendReminder(claim.id);
        messages.push(`${result.message}\n${result.shareUrl}`);
      } catch {
        // Continue so one unavailable reminder does not block the rest.
      }
    }
    await refresh();
    if (messages.length) {
      setFeedback(`${messages.length} recordatorio(s) preparado(s).`);
      await Share.share({ message: messages.join('\n\n') });
    } else {
      setFeedback('No hay recordatorios disponibles todavía.');
    }
  };

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      <ScreenContainer>
        <PageHeader
          title="Cobros enviados"
          action={
            <IconButton
              label="Más opciones"
              variant="plain"
              icon={<EllipsisVertical color={palette.textPrimary} size={22} />}
              onPress={() => setShowMenu(true)}
            />
          }
        />

        <Card style={styles.progressCard}>
          <View style={styles.progressHeading}>
            <AppText variant="label">Progreso general</AppText>
            <View style={styles.inline}>
              <AppText variant="label" color={palette.success}>
                {formatMoney(received, query.data.currency)}
              </AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                recibidos
              </AppText>
            </View>
          </View>
          <ProgressBar value={total ? received / total : 0} color={palette.success} />
          <View style={styles.inlineWrap}>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              Has registrado
            </AppText>
            <AppText variant="label" color={palette.success}>
              {formatMoney(received, query.data.currency)}
            </AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              de {formatMoney(total, query.data.currency)}
            </AppText>
          </View>
          {pending || disputed ? (
            <View style={styles.inlineWrap}>
              {pending ? (
                <AppText variant="caption" color={palette.warningInk}>
                  Pendiente {formatMoney(pending, query.data.currency)}
                </AppText>
              ) : null}
              {disputed ? (
                <AppText variant="caption" color={palette.dangerInk}>
                  En revisión {formatMoney(disputed, query.data.currency)}
                </AppText>
              ) : null}
            </View>
          ) : null}
        </Card>

        {feedback ? (
          <Card variant="flat" style={{ backgroundColor: palette.primaryLight }}>
            <AppText variant="bodySmall" color={palette.primary}>
              {feedback}
            </AppText>
          </Card>
        ) : null}

        {query.data.claims.length ? (
          <ListCard>
            {query.data.claims.map((claim, index) => {
              const openDispute = claim.disputes?.find((entry) => entry.status === 'open');
              const waitHours = reminderWaitHours(claim.sent_at, claim.last_reminded_at);
              const statusIcon =
                claim.status === 'received' ? (
                  <CheckCircle2 color={palette.success} size={20} />
                ) : claim.status === 'disputed' ? (
                  <CircleAlert color={palette.danger} size={20} />
                ) : claim.status === 'cancelled' ? (
                  <XCircle color={palette.textMuted} size={20} />
                ) : claim.status === 'reminder_sent' ? (
                  <Mail color={palette.primary} size={20} />
                ) : (
                  <Clock3 color={palette.warning} size={20} />
                );
              return (
                <View key={claim.id}>
                  {index > 0 ? <Divider inset={68} /> : null}
                  <View style={styles.claimBlock}>
                    <View style={styles.claimRow}>
                      <Avatar
                        name={claim.debtor?.display_name ?? 'Participante'}
                        uri={claim.debtor?.avatar_path}
                        size={44}
                      />
                      <View style={styles.grow}>
                        <AppText variant="sectionTitle">
                          {claim.debtor?.display_name ?? 'Participante'}
                        </AppText>
                        <CurrencyAmount
                          cents={claim.amount_cents}
                          currency={query.data.currency}
                          variant="body"
                          color={palette.textSecondary}
                        />
                      </View>
                      <StatusLabel
                        status={claim.status}
                        label={labels[claim.status]}
                        icon={statusIcon}
                      />
                    </View>

                    {claim.status === 'pending' || claim.status === 'reminder_sent' ? (
                      <View style={styles.actions}>
                        <AppButton
                          testID="mark-claim-received"
                          title="Marcar como recibido"
                          variant="success"
                          size="sm"
                          loading={markReceived.isPending}
                          onPress={() => markReceived.mutate(claim.id)}
                        />
                        <AppButton
                          title={waitHours ? `Recordar en ${waitHours} h` : 'Recordar'}
                          variant="outline"
                          size="sm"
                          disabled={waitHours > 0}
                          loading={remind.isPending}
                          onPress={() => remind.mutate(claim.id)}
                        />
                      </View>
                    ) : claim.status === 'disputed' ? (
                      <View style={[styles.disputePanel, { backgroundColor: palette.dangerLight }]}>
                        <AppText variant="bodySmall" color={palette.textSecondary}>
                          {openDispute ? disputeLabels[openDispute.reason] : 'Revisión solicitada'}
                          {openDispute?.message ? ` · ${openDispute.message}` : ''}
                        </AppText>
                        <View style={styles.actions}>
                          <AppButton
                            title="Mantener solicitud"
                            variant="outline"
                            size="sm"
                            loading={resolveDispute.isPending}
                            onPress={() =>
                              resolveDispute.mutate({ claimId: claim.id, outcome: 'reopen' })
                            }
                          />
                          <AppButton
                            title="Cancelar solicitud"
                            variant="danger"
                            size="sm"
                            loading={resolveDispute.isPending}
                            onPress={() =>
                              resolveDispute.mutate({ claimId: claim.id, outcome: 'cancel' })
                            }
                          />
                        </View>
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </ListCard>
        ) : (
          <Card>
            <EmptyState
              title="Todavía no hay solicitudes"
              body="Cuando envíes los cobros podrás seguir aquí cada importe."
            />
          </Card>
        )}

        <Card style={styles.detailCard}>
          <AppText variant="sectionTitle">Detalles del gasto</AppText>
          <View style={styles.claimRow}>
            <MerchantLogo
              merchantName={query.data.merchant_name}
              fallbackLabel={query.data.title}
              size={44}
            />
            <View style={styles.grow}>
              <AppText variant="label" numberOfLines={1}>
                {query.data.title}
              </AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                {query.data.merchant_name ? `${query.data.merchant_name} · ` : ''}
                {formatDate(query.data.occurred_at)} · {query.data.items.length}{' '}
                {query.data.items.length === 1 ? 'producto' : 'productos'}
              </AppText>
            </View>
            <CurrencyAmount cents={query.data.total_cents} currency={query.data.currency} />
          </View>
        </Card>

        {completed ? (
          <Card
            variant="flat"
            style={[styles.completedCard, { backgroundColor: palette.successLight }]}
          >
            <CheckCircle2 color={palette.success} size={22} />
            <AppText variant="label" color={palette.successInk}>
              Todo recibido
            </AppText>
          </Card>
        ) : null}

        {pendingClaims.length ? (
          <AppButton
            title={
              eligiblePending.length
                ? 'Recordar a pendientes'
                : `Podrás recordar en ${nextReminderHours} h`
            }
            variant="outline"
            size="md"
            fullWidth
            leftIcon={<Bell color={palette.primary} size={21} />}
            disabled={!eligiblePending.length}
            onPress={() => void remindAll()}
          />
        ) : null}
      </ScreenContainer>

      <BottomSheet visible={showMenu} onClose={() => setShowMenu(false)} title="Opciones del gasto">
        {query.data.receipt_path ? (
          <AppButton
            title="Ver ticket"
            variant="secondary"
            onPress={async () => {
              try {
                await Linking.openURL(await repository.receiptUrl(query.data.receipt_path!));
                setShowMenu(false);
              } catch {
                setFeedback('No se ha podido abrir el ticket.');
              }
            }}
          />
        ) : null}
        <AppButton
          title="Exportar resumen"
          variant="secondary"
          onPress={() =>
            void Share.share({
              message: `${query.data.title}\nTotal: ${formatMoney(query.data.total_cents, query.data.currency)}\nRecibido: ${formatMoney(received, query.data.currency)}\nPendiente: ${formatMoney(pending, query.data.currency)}`,
            })
          }
        />
        <AppButton
          title="Archivar gasto"
          variant="ghost"
          onPress={async () => {
            try {
              await repository.archiveExpense(expenseId);
              await cache.invalidateQueries({ queryKey: ['expenses'] });
              setShowMenu(false);
              router.replace('/(tabs)');
            } catch {
              setFeedback('No se ha podido archivar el gasto.');
            }
          }}
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  progressCard: { gap: spacing.md },
  progressHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  inlineWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  claimBlock: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  claimRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1, minWidth: 0, gap: spacing.xxs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginLeft: 60 },
  disputePanel: { marginLeft: 60, padding: spacing.md, borderRadius: radii.md, gap: spacing.sm },
  detailCard: { gap: spacing.lg },
  completedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
});
