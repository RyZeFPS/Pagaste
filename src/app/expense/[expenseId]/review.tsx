import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check, Send } from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AppButton,
  AppText,
  Avatar,
  Card,
  CurrencyAmount,
  ErrorState,
  ProgressBar,
  ScreenContainer,
} from '@/components/ui';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { ScreenLoadingSkeleton } from '@/components/loading-skeletons';
import { repository } from '@/lib/repository';
import { saveSmallJson } from '@/lib/storage';
import { successHaptic } from '@/lib/haptics';
import { useAppColors } from '@/providers/app-providers';
import { spacing } from '@/theme';
import { sumCents } from '@/domain/money';

export default function ReviewScreen() {
  return (
    <RequireAuth>
      <ReviewContent />
    </RequireAuth>
  );
}

function ReviewContent() {
  const { expenseId } = useLocalSearchParams<{ expenseId: string }>();
  const router = useRouter();
  const palette = useAppColors();
  const [error, setError] = useState<string>();
  const query = useQuery({
    queryKey: ['expense', expenseId],
    queryFn: () => repository.expense(expenseId),
  });
  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const allocation of query.data?.allocations ?? [])
      map.set(
        allocation.participant_id,
        sumCents([map.get(allocation.participant_id) ?? 0, allocation.amount_cents]),
      );
    return map;
  }, [query.data?.allocations]);

  const send = useMutation({
    mutationFn: async () => {
      if (!query.data) throw new Error('No se ha podido cargar el reparto.');
      const payer = query.data.participants.find((participant) => participant.is_payer);
      if (!payer) throw new Error('Falta indicar quién pagó.');
      const requests = query.data.participants
        .filter(
          (participant) => participant.id !== payer.id && (totals.get(participant.id) ?? 0) > 0,
        )
        .map((participant) => ({
          debtorParticipantId: participant.id,
          amountCents: totals.get(participant.id) ?? 0,
        }));
      if (!requests.length) throw new Error('No hay ninguna cantidad a recuperar.');
      const recoverable = sumCents(requests.map((claim) => claim.amountCents));
      await repository.updateExpense(expenseId, {
        recoverable_cents: recoverable,
        own_share_cents: sumCents([query.data.total_cents, -recoverable]),
      });
      const links = await repository.createClaimLinks(expenseId, requests);
      await saveSmallJson(`claim-links:${expenseId}`, links.claims);
      return links;
    },
    onSuccess: async () => {
      await successHaptic();
      router.replace(`/expense/${expenseId}/share`);
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : 'No se han podido crear las solicitudes.'),
  });

  if (query.isPending && !query.data) return <ScreenLoadingSkeleton variant="review" />;
  if (query.isError || !query.data)
    return (
      <ScreenContainer>
        <ErrorState
          body="No hemos podido cargar el reparto."
          onRetry={() => void query.refetch()}
        />
      </ScreenContainer>
    );

  const payer = query.data.participants.find((participant) => participant.is_payer);
  const assigned = sumCents([...totals.values()]);
  const ownShare = payer ? (totals.get(payer.id) ?? 0) : 0;
  const recoverable = sumCents([assigned, -ownShare]);
  const debtors = query.data.participants.filter(
    (participant) => !participant.is_payer && (totals.get(participant.id) ?? 0) > 0,
  );
  const valid = assigned === query.data.total_cents && recoverable > 0;

  return (
    <ScreenContainer contentContainerStyle={styles.screenContent}>
      <PageHeader title="Revisar cobros" />

      <Card style={styles.summaryCard}>
        <View style={styles.summaryHeading}>
          <View
            style={[
              styles.checkCircle,
              { backgroundColor: valid ? palette.successLight : palette.dangerLight },
            ]}
          >
            <Check
              color={valid ? palette.successInk : palette.dangerInk}
              size={24}
              strokeWidth={2.5}
            />
          </View>
          <View style={styles.flex}>
            <AppText variant="heading">Todo listo para enviar</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              Comprueba una última vez quién paga cada parte.
            </AppText>
          </View>
        </View>
        <View
          style={[
            styles.metrics,
            { borderTopColor: palette.divider, borderBottomColor: palette.divider },
          ]}
        >
          <View style={styles.metricBlock}>
            <AppText variant="caption" color={palette.textSecondary}>
              Total
            </AppText>
            <CurrencyAmount
              cents={query.data.total_cents}
              currency={query.data.currency}
              variant="label"
            />
          </View>
          <View style={[styles.metricBlock, styles.metricBorder, { borderColor: palette.divider }]}>
            <AppText variant="caption" color={palette.textSecondary}>
              Tu parte
            </AppText>
            <CurrencyAmount cents={ownShare} currency={query.data.currency} variant="label" />
          </View>
          <View style={styles.metricBlock}>
            <AppText variant="caption" color={palette.textSecondary}>
              A recuperar
            </AppText>
            <CurrencyAmount
              cents={recoverable}
              currency={query.data.currency}
              variant="label"
              color={palette.success}
            />
          </View>
        </View>
        <ProgressBar
          value={query.data.total_cents ? assigned / query.data.total_cents : 0}
          color={valid ? palette.success : palette.danger}
        />
        {!valid ? (
          <AppText variant="bodySmall" color={palette.dangerInk}>
            El reparto no coincide con el total o no hay nada que recuperar.
          </AppText>
        ) : null}
      </Card>

      <View style={styles.sectionHeading}>
        <AppText variant="heading">Solicitudes</AppText>
        <AppText variant="bodySmall" color={palette.textSecondary}>
          {debtors.length} {debtors.length === 1 ? 'persona' : 'personas'}
        </AppText>
      </View>

      <Card variant="grouped">
        {debtors.map((participant, index) => {
          const participantItems = query.data.items.filter((item) =>
            query.data.allocations.some(
              (allocation) =>
                allocation.item_id === item.id &&
                allocation.participant_id === participant.id &&
                allocation.amount_cents !== 0,
            ),
          );
          return (
            <View key={participant.id}>
              <View style={styles.personRow}>
                <Avatar name={participant.display_name} uri={participant.avatar_path} size={48} />
                <View style={styles.flex}>
                  <AppText variant="label">{participant.display_name}</AppText>
                  <AppText variant="bodySmall" color={palette.textSecondary} numberOfLines={1}>
                    {participantItems.map((item) => item.name).join(', ') || 'Parte del gasto'}
                  </AppText>
                </View>
                <CurrencyAmount
                  cents={totals.get(participant.id) ?? 0}
                  currency={query.data.currency}
                  variant="heading"
                />
              </View>
              {index < debtors.length - 1 ? (
                <View style={[styles.personDivider, { backgroundColor: palette.divider }]} />
              ) : null}
            </View>
          );
        })}
      </Card>

      {error ? <AppText color={palette.dangerInk}>{error}</AppText> : null}
      <AppButton
        testID="send-claims"
        title="Crear solicitudes"
        variant="success"
        size="lg"
        leftIcon={<Send color={palette.white} size={21} />}
        disabled={!valid}
        loading={send.isPending}
        onPress={() => send.mutate()}
      />
      <AppText variant="caption" color={palette.textSecondary} style={styles.legalText}>
        Cada persona recibirá un enlace privado distinto. Pagaste no mueve dinero: te ayuda a
        repartir y cobrar.
      </AppText>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screenContent: { gap: spacing.lg },
  summaryCard: { gap: spacing.lg },
  summaryHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  checkCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metrics: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: spacing.md,
  },
  metricBlock: { flex: 1, minWidth: 0, alignItems: 'center', gap: spacing.xs },
  metricBorder: { borderLeftWidth: 1, borderRightWidth: 1 },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  personRow: {
    minHeight: 76,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  personDivider: { height: 1, marginLeft: 80 },
  legalText: { textAlign: 'center', paddingHorizontal: spacing.lg },
});
