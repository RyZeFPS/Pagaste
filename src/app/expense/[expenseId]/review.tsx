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
import { calculateSettlementTransfers } from '@/domain/contributions';
import { useI18n } from '@/i18n';

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
  const { t } = useI18n();
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
  const paidByParticipant = useMemo(() => {
    const paid = new Map<string, number>();
    for (const contribution of query.data?.contributions ?? []) {
      paid.set(
        contribution.participant_id,
        sumCents([paid.get(contribution.participant_id) ?? 0, contribution.amount_cents]),
      );
    }
    if (!paid.size && query.data) {
      const payer = query.data.participants.find((participant) => participant.is_payer);
      if (payer) paid.set(payer.id, query.data.total_cents);
    }
    return paid;
  }, [query.data]);
  const settlements = useMemo(() => {
    if (!query.data) return [];
    try {
      return calculateSettlementTransfers(
        query.data.participants.map((participant) => ({
          participantId: participant.id,
          shareCents: totals.get(participant.id) ?? 0,
          paidCents: paidByParticipant.get(participant.id) ?? 0,
          sortOrder: participant.sort_order,
        })),
      );
    } catch {
      return [];
    }
  }, [paidByParticipant, query.data, totals]);

  const send = useMutation({
    mutationFn: async () => {
      if (!query.data) throw new Error(t('review.noDataError'));
      const links = await repository.createClaimLinks(expenseId);
      await saveSmallJson(`claim-links:${expenseId}`, links.claims);
      return links;
    },
    onSuccess: async (links) => {
      await successHaptic();
      if (links.claims.length) {
        router.replace(`/expense/${expenseId}/share`);
      } else {
        router.replace('/(tabs)/activity');
      }
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : t('review.createError')),
  });

  if (query.isPending && !query.data) return <ScreenLoadingSkeleton variant="review" />;
  if (query.isError || !query.data)
    return (
      <ScreenContainer>
        <ErrorState body={t('review.loadError')} onRetry={() => void query.refetch()} />
      </ScreenContainer>
    );

  const payer = query.data.participants.find((participant) => participant.is_payer);
  const assigned = sumCents([...totals.values()]);
  const ownShare = payer ? (totals.get(payer.id) ?? 0) : 0;
  const contributed = sumCents([...paidByParticipant.values()]);
  const recoverable = sumCents(settlements.map((settlement) => settlement.amountCents));
  const debtorCount = new Set(settlements.map((settlement) => settlement.debtorParticipantId)).size;
  const valid = assigned === query.data.total_cents && contributed === query.data.total_cents;

  return (
    <ScreenContainer contentContainerStyle={styles.screenContent}>
      <PageHeader title={t('review.title')} />

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
            <AppText variant="heading">{t('review.readyTitle')}</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {t('review.readyBody')}
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
              {t('review.total')}
            </AppText>
            <CurrencyAmount
              cents={query.data.total_cents}
              currency={query.data.currency}
              variant="label"
            />
          </View>
          <View style={[styles.metricBlock, styles.metricBorder, { borderColor: palette.divider }]}>
            <AppText variant="caption" color={palette.textSecondary}>
              {t('review.yourShare')}
            </AppText>
            <CurrencyAmount cents={ownShare} currency={query.data.currency} variant="label" />
          </View>
          <View style={styles.metricBlock}>
            <AppText variant="caption" color={palette.textSecondary}>
              {t('review.toRecover')}
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
            {t('review.invalid')}
          </AppText>
        ) : null}
      </Card>

      <View style={styles.sectionHeading}>
        <AppText variant="heading">{t('review.requests')}</AppText>
        <AppText variant="bodySmall" color={palette.textSecondary}>
          {debtorCount === 1
            ? t('review.peopleOne')
            : t('review.peopleMany', { count: debtorCount })}
        </AppText>
      </View>

      <Card variant="grouped">
        {!settlements.length ? (
          <View style={styles.emptyTransfers}>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {t('review.noTransfers')}
            </AppText>
          </View>
        ) : null}
        {settlements.map((settlement, index) => {
          const participant = query.data.participants.find(
            (person) => person.id === settlement.debtorParticipantId,
          );
          const creditor = query.data.participants.find(
            (person) => person.id === settlement.creditorParticipantId,
          );
          if (!participant || !creditor) return null;
          const participantItems = query.data.items.filter((item) =>
            query.data.allocations.some(
              (allocation) =>
                allocation.item_id === item.id &&
                allocation.participant_id === participant.id &&
                allocation.amount_cents !== 0,
            ),
          );
          return (
            <View key={`${participant.id}:${creditor.id}`}>
              <View style={styles.personRow}>
                <Avatar name={participant.display_name} uri={participant.avatar_path} size={48} />
                <View style={styles.flex}>
                  <AppText variant="label">{participant.display_name}</AppText>
                  <AppText variant="bodySmall" color={palette.textSecondary} numberOfLines={1}>
                    {t('review.owesTo', { name: creditor.display_name })}
                    {participantItems.length
                      ? ` · ${participantItems.map((item) => item.name).join(', ')}`
                      : ''}
                  </AppText>
                </View>
                <CurrencyAmount
                  cents={settlement.amountCents}
                  currency={query.data.currency}
                  variant="heading"
                />
              </View>
              {index < settlements.length - 1 ? (
                <View style={[styles.personDivider, { backgroundColor: palette.divider }]} />
              ) : null}
            </View>
          );
        })}
      </Card>

      {error ? <AppText color={palette.dangerInk}>{error}</AppText> : null}
      <AppButton
        testID="send-claims"
        title={settlements.length ? t('review.create') : t('review.finish')}
        variant="success"
        size="lg"
        leftIcon={<Send color={palette.white} size={21} />}
        disabled={!valid}
        loading={send.isPending}
        onPress={() => send.mutate()}
      />
      <AppText variant="caption" color={palette.textSecondary} style={styles.legalText}>
        {t('review.legal')}
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
  emptyTransfers: { padding: spacing.lg },
  legalText: { textAlign: 'center', paddingHorizontal: spacing.lg },
});
