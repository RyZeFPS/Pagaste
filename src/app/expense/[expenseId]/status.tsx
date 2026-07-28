import { useState } from 'react';
import { Linking, Share, StyleSheet, Switch, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CheckCircle2,
  CircleAlert,
  Clock3,
  EllipsisVertical,
  Eye,
  Link2,
  Mail,
  RefreshCw,
  Scale,
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
import { useI18n, type TranslationKey } from '@/i18n';
import { repository } from '@/lib/repository';
import type { ClaimStatus, ReminderPreview } from '@/lib/models';
import { useAppColors } from '@/providers/app-providers';
import { radii, spacing } from '@/theme';

const labelKeys: Record<ClaimStatus, TranslationKey> = {
  pending: 'status.pending',
  received: 'status.received',
  reminder_sent: 'status.reminder_sent',
  disputed: 'status.disputed',
  cancelled: 'status.cancelled',
};

const disputeLabelKeys: Record<string, TranslationKey> = {
  did_not_consume: 'status.disputeDidNotConsume',
  incorrect_amount: 'status.disputeIncorrectAmount',
  already_paid: 'status.disputeAlreadyPaid',
  unknown_expense: 'status.disputeUnknownExpense',
  other: 'status.disputeOther',
};

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
  const { t, formatDate, formatMoney } = useI18n();
  const cache = useQueryClient();
  const [feedback, setFeedback] = useState<string>();
  const [showMenu, setShowMenu] = useState(false);
  const [reminderPreview, setReminderPreview] = useState<ReminderPreview>();
  const [previewingReminder, setPreviewingReminder] = useState<string>();
  const [bankChecked, setBankChecked] = useState(false);
  const [linkClaimId, setLinkClaimId] = useState<string>();
  const query = useQuery({
    queryKey: ['expense', expenseId],
    queryFn: () => repository.expense(expenseId),
    refetchInterval: 20_000,
  });
  const linkActivity = useQuery({
    queryKey: ['claim-link-activity', linkClaimId],
    enabled: Boolean(linkClaimId),
    queryFn: () => repository.claimLinkActivity(linkClaimId!),
  });
  const refresh = () => cache.invalidateQueries({ queryKey: ['expense', expenseId] });

  const markReceived = useMutation({
    mutationFn: repository.markClaimReceived,
    onSuccess: async () => {
      setFeedback(t('status.receivedFeedback'));
      await refresh();
      await cache.invalidateQueries({ queryKey: ['expenses'] });
      if (query.data?.group_id)
        await cache.invalidateQueries({ queryKey: ['group', query.data.group_id] });
    },
    onError: () => setFeedback(t('status.receivedError')),
  });
  const resolveDispute = useMutation({
    mutationFn: ({ claimId, outcome }: { claimId: string; outcome: 'reopen' | 'cancel' }) =>
      repository.resolveDispute(claimId, outcome),
    onSuccess: async (result) => {
      setFeedback(
        result.status === 'cancelled' ? t('status.disputeCancelled') : t('status.disputeReopened'),
      );
      await refresh();
    },
    onError: () => setFeedback(t('status.disputeResolveError')),
  });
  const remind = useMutation({
    mutationFn: ({ claimId }: { claimId: string }) => repository.sendReminder(claimId, true),
    onSuccess: async (result) => {
      setFeedback(t('reminders.prepared'));
      setReminderPreview(undefined);
      setBankChecked(false);
      await refresh();
      await Share.share({ message: result.message });
    },
    onError: () => setFeedback(t('reminders.notDue')),
  });
  const regenerateLink = useMutation({
    mutationFn: ({ claimId, days }: { claimId: string; days: number }) =>
      repository.regenerateClaimLink(claimId, days),
    onSuccess: async (result) => {
      setFeedback(t('status.linkRegenerated'));
      await linkActivity.refetch();
      await Share.share({ message: result.url });
    },
    onError: () => setFeedback(t('status.linkRegenerateError')),
  });
  const revokeLink = useMutation({
    mutationFn: repository.revokeClaim,
    onSuccess: async () => {
      setFeedback(t('status.linkRevoked'));
      setLinkClaimId(undefined);
      await refresh();
    },
    onError: () => setFeedback(t('status.linkRevokeError')),
  });

  const openReminderReview = async (claimId: string) => {
    setPreviewingReminder(claimId);
    setFeedback(undefined);
    try {
      const preview = await repository.previewReminder(claimId);
      if (!preview.eligible) {
        setFeedback(
          preview.blockedReason === 'quiet_hours'
            ? t('reminders.quietBlocked')
            : preview.blockedReason === 'limit_reached'
              ? t('reminders.limitReached')
              : t('reminders.notDue'),
        );
        return;
      }
      setReminderPreview(preview);
      setBankChecked(false);
    } catch {
      setFeedback(t('reminders.notDue'));
    } finally {
      setPreviewingReminder(undefined);
    }
  };

  if (query.isPending && !query.data) return <ScreenLoadingSkeleton variant="status" />;
  if (query.isError || !query.data) {
    return (
      <ScreenContainer>
        <ErrorState body={t('status.loadError')} onRetry={() => void query.refetch()} />
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
  const completed = total > 0 && received === total;

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      <ScreenContainer>
        <PageHeader
          title={t('status.title')}
          action={
            <IconButton
              label={t('status.moreOptionsA11y')}
              variant="plain"
              icon={<EllipsisVertical color={palette.textPrimary} size={22} />}
              onPress={() => setShowMenu(true)}
            />
          }
        />

        <Card style={styles.progressCard}>
          <View style={styles.progressHeading}>
            <AppText variant="label">{t('status.generalProgress')}</AppText>
            <View style={styles.inline}>
              <AppText variant="label" color={palette.success}>
                {formatMoney(received, query.data.currency)}
              </AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                {t('status.receivedLower')}
              </AppText>
            </View>
          </View>
          <ProgressBar value={total ? received / total : 0} color={palette.success} />
          <View style={styles.inlineWrap}>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {t('status.registered')}
            </AppText>
            <AppText variant="label" color={palette.success}>
              {formatMoney(received, query.data.currency)}
            </AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {t('status.ofTotal', { total: formatMoney(total, query.data.currency) })}
            </AppText>
          </View>
          {pending || disputed ? (
            <View style={styles.inlineWrap}>
              {pending ? (
                <AppText variant="caption" color={palette.warningInk}>
                  {t('status.pendingAmount', {
                    amount: formatMoney(pending, query.data.currency),
                  })}
                </AppText>
              ) : null}
              {disputed ? (
                <AppText variant="caption" color={palette.dangerInk}>
                  {t('status.disputedAmount', {
                    amount: formatMoney(disputed, query.data.currency),
                  })}
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
              const offsetCents =
                claim.events
                  ?.filter((event) => event.event_type === 'debt_offset')
                  .reduce(
                    (sum, event) =>
                      sum + Number(event.metadata?.offsetAmountCents ?? 0),
                    0,
                  ) ?? 0;
              const fullyOffset = claim.status === 'cancelled' && offsetCents > 0;
              const statusIcon =
                claim.status === 'received' ? (
                  <CheckCircle2 color={palette.success} size={20} />
                ) : claim.status === 'disputed' ? (
                  <CircleAlert color={palette.danger} size={20} />
                ) : fullyOffset ? (
                  <Scale color={palette.success} size={20} />
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
                        name={claim.debtor?.display_name ?? t('status.participant')}
                        uri={claim.debtor?.avatar_path}
                        size={44}
                      />
                      <View style={styles.grow}>
                        <AppText variant="sectionTitle">
                          {claim.debtor?.display_name ?? t('status.participant')}
                        </AppText>
                        {claim.creditor?.display_name ? (
                          <AppText variant="caption" color={palette.textSecondary}>
                            {t('status.paysTo', { name: claim.creditor.display_name })}
                          </AppText>
                        ) : null}
                        <CurrencyAmount
                          cents={claim.amount_cents}
                          currency={query.data.currency}
                          variant="body"
                          color={palette.textSecondary}
                        />
                      </View>
                      <StatusLabel
                        status={claim.status}
                        label={fullyOffset ? t('status.offset') : t(labelKeys[claim.status])}
                        icon={statusIcon}
                      />
                    </View>

                    {offsetCents > 0 ? (
                      <AppText
                        variant="caption"
                        color={palette.successInk}
                        style={styles.offsetNote}
                      >
                        {t('status.offsetApplied', {
                          amount: formatMoney(offsetCents, query.data.currency),
                        })}
                      </AppText>
                    ) : null}

                    {claim.status === 'pending' || claim.status === 'reminder_sent' ? (
                      <View style={styles.actions}>
                        <AppButton
                          testID="mark-claim-received"
                          title={t('expense.markReceived')}
                          variant="success"
                          size="sm"
                          loading={markReceived.isPending}
                          onPress={() => markReceived.mutate(claim.id)}
                        />
                        <AppButton
                          title={t('reminders.reviewPending')}
                          variant="outline"
                          size="sm"
                          loading={previewingReminder === claim.id}
                          onPress={() => void openReminderReview(claim.id)}
                        />
                        <AppButton
                          title={t('status.manageLink')}
                          variant="ghost"
                          size="sm"
                          leftIcon={<Link2 color={palette.primary} size={17} />}
                          onPress={() => setLinkClaimId(claim.id)}
                        />
                      </View>
                    ) : claim.status === 'disputed' ? (
                      <View style={[styles.disputePanel, { backgroundColor: palette.dangerLight }]}>
                        <AppText variant="bodySmall" color={palette.textSecondary}>
                          {openDispute
                            ? t(disputeLabelKeys[openDispute.reason] ?? 'status.disputeOther')
                            : t('status.reviewRequested')}
                          {openDispute?.message ? ` · ${openDispute.message}` : ''}
                        </AppText>
                        <View style={styles.actions}>
                          <AppButton
                            title={t('status.keepRequest')}
                            variant="outline"
                            size="sm"
                            loading={resolveDispute.isPending}
                            onPress={() =>
                              resolveDispute.mutate({ claimId: claim.id, outcome: 'reopen' })
                            }
                          />
                          <AppButton
                            title={t('status.cancelRequest')}
                            variant="danger"
                            size="sm"
                            loading={resolveDispute.isPending}
                            onPress={() =>
                              resolveDispute.mutate({ claimId: claim.id, outcome: 'cancel' })
                            }
                          />
                          <AppButton
                            title={t('status.manageLink')}
                            variant="ghost"
                            size="sm"
                            leftIcon={<Link2 color={palette.primary} size={17} />}
                            onPress={() => setLinkClaimId(claim.id)}
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
            <EmptyState title={t('status.emptyTitle')} body={t('status.emptyBody')} />
          </Card>
        )}

        <Card style={styles.detailCard}>
          <AppText variant="sectionTitle">{t('status.expenseDetails')}</AppText>
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
                {t(query.data.items.length === 1 ? 'status.productOne' : 'status.productMany')}
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
              {t('status.allReceived')}
            </AppText>
          </Card>
        ) : null}

        {pendingClaims.length ? (
          <Card variant="flat" style={{ backgroundColor: palette.primaryLight }}>
            <View style={styles.reminderNotice}>
              <Bell color={palette.primary} size={20} />
              <AppText variant="bodySmall" color={palette.primary} style={styles.grow}>
                {t('reminders.configDescription')}
              </AppText>
            </View>
          </Card>
        ) : null}
      </ScreenContainer>

      <BottomSheet
        visible={showMenu}
        onClose={() => setShowMenu(false)}
        title={t('status.menuTitle')}
      >
        {query.data.receipt_path ? (
          <AppButton
            title={t('status.viewReceipt')}
            variant="secondary"
            onPress={async () => {
              try {
                await Linking.openURL(await repository.receiptUrl(query.data.receipt_path!));
                setShowMenu(false);
              } catch {
                setFeedback(t('status.openReceiptError'));
              }
            }}
          />
        ) : null}
        <AppButton
          title={t('status.exportSummary')}
          variant="secondary"
          onPress={() =>
            void Share.share({
              message: t('status.exportMessage', {
                title: query.data.title,
                total: formatMoney(query.data.total_cents, query.data.currency),
                received: formatMoney(received, query.data.currency),
                pending: formatMoney(pending, query.data.currency),
              }),
            })
          }
        />
        <AppButton
          title={t('status.archive')}
          variant="ghost"
          onPress={async () => {
            try {
              await repository.archiveExpense(expenseId);
              await cache.invalidateQueries({ queryKey: ['expenses'] });
              setShowMenu(false);
              router.replace('/(tabs)');
            } catch {
              setFeedback(t('status.archiveError'));
            }
          }}
        />
      </BottomSheet>

      <BottomSheet
        visible={Boolean(linkClaimId)}
        onClose={() => {
          if (regenerateLink.isPending || revokeLink.isPending) return;
          setLinkClaimId(undefined);
        }}
        title={t('status.linkTitle')}
      >
        {linkActivity.isPending ? (
          <AppText color={palette.textSecondary}>{t('common.loading')}</AppText>
        ) : linkActivity.data ? (
          <>
            <Card
              variant="flat"
              style={{
                backgroundColor: linkActivity.data.active
                  ? palette.successLight
                  : palette.warningLight,
              }}
            >
              <View style={styles.linkSummary}>
                <Link2
                  color={linkActivity.data.active ? palette.successInk : palette.warningInk}
                  size={22}
                />
                <View style={styles.grow}>
                  <AppText variant="label">
                    {linkActivity.data.active && linkActivity.data.expiresAt
                      ? t('status.linkActive', {
                          date: formatDate(linkActivity.data.expiresAt),
                        })
                      : t('status.linkExpired')}
                  </AppText>
                  <AppText variant="caption" color={palette.textSecondary}>
                    {linkActivity.data.accessCount
                      ? t('status.linkAccesses', {
                          count: linkActivity.data.accessCount,
                        })
                      : t('status.linkNeverOpened')}
                  </AppText>
                </View>
              </View>
            </Card>
            {linkActivity.data.recentAccesses.length ? (
              <View style={styles.linkHistory}>
                <AppText variant="label">{t('status.linkRecentAccesses')}</AppText>
                {linkActivity.data.recentAccesses.map((access, index) => (
                  <View key={`${access.accessedAt}:${index}`} style={styles.linkAccessRow}>
                    <Eye color={palette.textSecondary} size={16} />
                    <AppText variant="bodySmall" color={palette.textSecondary}>
                      {formatDate(access.accessedAt)}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : null}
            {([7, 30, 90] as const).map((days) => (
              <AppButton
                key={days}
                title={t(
                  days === 7
                    ? 'status.linkRegenerate7'
                    : days === 30
                      ? 'status.linkRegenerate30'
                      : 'status.linkRegenerate90',
                )}
                variant={days === 30 ? 'primary' : 'secondary'}
                loading={regenerateLink.isPending}
                leftIcon={
                  <RefreshCw color={days === 30 ? palette.white : palette.primary} size={18} />
                }
                onPress={() => {
                  if (linkClaimId) regenerateLink.mutate({ claimId: linkClaimId, days });
                }}
              />
            ))}
            <Card variant="flat" style={{ backgroundColor: palette.dangerLight }}>
              <AppText variant="bodySmall" color={palette.dangerInk}>
                {t('status.linkRevokeBody')}
              </AppText>
            </Card>
            <AppButton
              title={t('status.linkRevoke')}
              variant="danger"
              loading={revokeLink.isPending}
              onPress={() => {
                if (linkClaimId) revokeLink.mutate(linkClaimId);
              }}
            />
          </>
        ) : (
          <ErrorState
            body={t('status.linkRegenerateError')}
            onRetry={() => void linkActivity.refetch()}
          />
        )}
      </BottomSheet>

      <BottomSheet
        visible={Boolean(reminderPreview)}
        onClose={() => {
          if (remind.isPending) return;
          setReminderPreview(undefined);
          setBankChecked(false);
        }}
        title={t('reminders.title')}
      >
        {reminderPreview ? (
          <>
            <View style={[styles.reviewCard, { backgroundColor: palette.warningLight }]}>
              <Bell color={palette.warningInk} size={22} />
              <AppText variant="sectionTitle" color={palette.warningInk} style={styles.grow}>
                {t('reminders.checkBankPrompt', {
                  name: reminderPreview.debtorDisplayName,
                  amount: formatMoney(reminderPreview.totalCents, reminderPreview.currency),
                })}
              </AppText>
            </View>

            {reminderPreview.grouped ? (
              <ListCard>
                {reminderPreview.claims.map((claim, index) => (
                  <View key={claim.claimId}>
                    {index > 0 ? <Divider /> : null}
                    <View style={styles.bundleRow}>
                      <View style={styles.grow}>
                        <AppText variant="label">{claim.expenseTitle}</AppText>
                        {claim.merchantName ? (
                          <AppText variant="caption" color={palette.textSecondary}>
                            {claim.merchantName}
                          </AppText>
                        ) : null}
                      </View>
                      <CurrencyAmount
                        cents={claim.amountCents}
                        currency={claim.currency}
                        variant="body"
                      />
                    </View>
                  </View>
                ))}
              </ListCard>
            ) : null}

            <View style={[styles.bankCheckRow, { borderColor: palette.border }]}>
              <View style={styles.grow}>
                <AppText variant="label">{t('reminders.checkBankConfirm')}</AppText>
              </View>
              <Switch
                accessibilityLabel={t('reminders.checkBankConfirm')}
                accessibilityState={{ checked: bankChecked }}
                disabled={remind.isPending}
                value={bankChecked}
                onValueChange={setBankChecked}
                ios_backgroundColor={palette.divider}
                thumbColor={palette.surface}
                trackColor={{ false: palette.disabled, true: palette.success }}
              />
            </View>

            <AppButton
              title={t('reminders.send')}
              fullWidth
              disabled={!bankChecked}
              loading={remind.isPending}
              leftIcon={<Bell color={palette.white} size={20} />}
              onPress={() => {
                const claimId = reminderPreview.claims[0]?.claimId;
                if (claimId) remind.mutate({ claimId });
              }}
            />
          </>
        ) : null}
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
  offsetNote: { marginLeft: 60 },
  disputePanel: { marginLeft: 60, padding: spacing.md, borderRadius: radii.md, gap: spacing.sm },
  detailCard: { gap: spacing.lg },
  completedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  reminderNotice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reviewCard: {
    padding: spacing.lg,
    borderRadius: radii.control,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  bundleRow: {
    minHeight: 62,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  bankCheckRow: {
    minHeight: 64,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radii.control,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  linkSummary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  linkHistory: { gap: spacing.sm },
  linkAccessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
