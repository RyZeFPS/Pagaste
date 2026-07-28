import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, Copy, QrCode as QrCodeIcon, Share2 } from 'lucide-react-native';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { QrCode } from '@/components/qr-code';
import {
  AppButton,
  AppText,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  ScreenContainer,
} from '@/components/ui';
import { ScreenLoadingSkeleton } from '@/components/loading-skeletons';
import { canApplyCollaboration, pendingCollaborationGuests } from '@/domain/expense-collaboration';
import { collaborationCopy } from '@/features/collaboration/i18n';
import { useI18n } from '@/i18n';
import { repository } from '@/lib/repository';
import { useAppColors } from '@/providers/app-providers';
import { radii, spacing } from '@/theme';

export default function ExpenseCollaborationScreen() {
  return (
    <RequireAuth>
      <ExpenseCollaborationContent />
    </RequireAuth>
  );
}

function ExpenseCollaborationContent() {
  const { expenseId } = useLocalSearchParams<{ expenseId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const palette = useAppColors();
  const { locale, formatMoney } = useI18n();
  const copy = collaborationCopy(locale);
  const [shareUrl, setShareUrl] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [confirmClose, setConfirmClose] = useState(false);

  const expenseQuery = useQuery({
    queryKey: ['expense', expenseId],
    queryFn: () => repository.expense(expenseId),
    enabled: Boolean(expenseId),
  });
  const collaborationQuery = useQuery({
    queryKey: ['expense-collaboration', expenseId],
    queryFn: () => repository.expenseCollaboration(expenseId),
    enabled: Boolean(expenseId),
    refetchInterval: (query) =>
      query.state.data?.session?.status === 'active' && !query.state.data.session.expired
        ? 4_000
        : false,
  });

  const start = useMutation({
    mutationFn: () => repository.startExpenseCollaboration(expenseId, locale, 24),
    onSuccess: async (result) => {
      setShareUrl(result.url);
      setFeedback(undefined);
      await collaborationQuery.refetch();
    },
    onError: () => setFeedback(copy.createError),
  });
  const apply = useMutation({
    mutationFn: () => {
      const sessionId = collaborationQuery.data?.session?.id;
      if (!sessionId) throw new Error('COLLABORATION_SESSION_REQUIRED');
      return repository.applyExpenseCollaboration(sessionId);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['expense', expenseId] }),
        queryClient.invalidateQueries({ queryKey: ['expense-collaboration', expenseId] }),
      ]);
      router.replace(`/expense/${expenseId}/participants`);
    },
    onError: () => setFeedback(copy.applyError),
  });
  const revoke = useMutation({
    mutationFn: () => {
      const sessionId = collaborationQuery.data?.session?.id;
      if (!sessionId) throw new Error('COLLABORATION_SESSION_REQUIRED');
      return repository.revokeExpenseCollaboration(sessionId);
    },
    onSuccess: async () => {
      setShareUrl(undefined);
      setConfirmClose(false);
      await collaborationQuery.refetch();
    },
    onError: () => {
      setConfirmClose(false);
      setFeedback(copy.revokeError);
    },
  });

  if (
    (expenseQuery.isPending && !expenseQuery.data) ||
    (collaborationQuery.isPending && !collaborationQuery.data)
  ) {
    return <ScreenLoadingSkeleton variant="participants" />;
  }
  if (!expenseQuery.data || expenseQuery.isError || collaborationQuery.isError) {
    return (
      <ScreenContainer>
        <PageHeader title={copy.ownerTitle} />
        <ErrorState title={copy.invalidExpense} />
      </ScreenContainer>
    );
  }

  const payload = collaborationQuery.data;
  const pendingGuests = pendingCollaborationGuests(payload);
  const hasSession = Boolean(payload?.session);
  const active = payload?.session?.status === 'active' && !payload.session.expired;

  return (
    <>
      <ScreenContainer>
        <PageHeader title={copy.ownerTitle} subtitle={expenseQuery.data.title} />

        <Card style={styles.introCard}>
          <View style={[styles.icon, { backgroundColor: palette.primaryLight }]}>
            <QrCodeIcon color={palette.primary} size={25} />
          </View>
          <View style={styles.flex}>
            <AppText variant="heading">{copy.ownerIntroTitle}</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {copy.ownerIntro}
            </AppText>
          </View>
        </Card>

        {shareUrl ? (
          <Card style={styles.qrCard}>
            <AppText variant="heading" style={styles.center}>
              {copy.scanTitle}
            </AppText>
            <View
              style={[
                styles.qrSurface,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}
            >
              <QrCode value={shareUrl} accessibilityLabel={copy.accessibilityQr} size={224} />
            </View>
            <View style={styles.expiry}>
              <Clock3 color={palette.textSecondary} size={16} />
              <AppText variant="caption" color={palette.textSecondary}>
                {copy.expires}
              </AppText>
            </View>
            <View style={styles.actions}>
              <AppButton
                title={feedback === copy.copied ? copy.copied : copy.copyLink}
                variant="secondary"
                leftIcon={<Copy color={palette.primary} size={18} />}
                onPress={async () => {
                  await Clipboard.setStringAsync(shareUrl);
                  setFeedback(copy.copied);
                }}
              />
              <AppButton
                title={copy.share}
                leftIcon={<Share2 color={palette.white} size={18} />}
                onPress={() => void Share.share({ message: shareUrl })}
              />
            </View>
          </Card>
        ) : (
          <Card style={styles.createCard}>
            {hasSession ? (
              <AppText variant="bodySmall" color={palette.textSecondary}>
                {copy.linkUnavailable}
              </AppText>
            ) : null}
            <AppButton
              title={hasSession ? copy.regenerate : copy.start}
              loading={start.isPending}
              leftIcon={<QrCodeIcon color={palette.white} size={19} />}
              onPress={() => start.mutate()}
            />
          </Card>
        )}

        <View style={styles.sectionHeading}>
          <AppText variant="sectionTitle">{copy.submissions}</AppText>
          {pendingGuests.length ? (
            <View style={[styles.count, { backgroundColor: palette.primaryLight }]}>
              <AppText variant="label" color={palette.primary}>
                {pendingGuests.length}
              </AppText>
            </View>
          ) : null}
        </View>

        {pendingGuests.length ? (
          <View style={styles.guestList}>
            {pendingGuests.map((guest) => (
              <Card key={guest.id} style={styles.guestCard}>
                <View style={styles.guestHeading}>
                  <View style={[styles.initial, { backgroundColor: palette.primaryLight }]}>
                    <AppText variant="label" color={palette.primary}>
                      {guest.displayName.slice(0, 1).toUpperCase()}
                    </AppText>
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="heading">{guest.displayName}</AppText>
                    <AppText variant="caption" color={palette.textSecondary}>
                      {copy.products(guest.items.length)}
                    </AppText>
                  </View>
                  <AppText variant="label" color={palette.primary}>
                    {formatMoney(
                      guest.items.reduce((sum, item) => sum + item.lineTotalCents, 0),
                      expenseQuery.data.currency,
                    )}
                  </AppText>
                </View>
                <View style={styles.itemChips}>
                  {guest.items.map((item) => (
                    <View
                      key={item.id}
                      style={[
                        styles.itemChip,
                        { backgroundColor: palette.background, borderColor: palette.border },
                      ]}
                    >
                      <AppText variant="caption">{item.name}</AppText>
                    </View>
                  ))}
                </View>
              </Card>
            ))}
          </View>
        ) : (
          <EmptyState title={copy.waitingTitle} body={copy.waitingBody} />
        )}

        {feedback && feedback !== copy.copied ? (
          <Card variant="flat" style={{ backgroundColor: palette.dangerLight }}>
            <AppText variant="bodySmall" color={palette.danger}>
              {feedback}
            </AppText>
          </Card>
        ) : null}

        {active ? (
          <>
            <Card variant="flat" style={{ backgroundColor: palette.successLight }}>
              <View style={styles.applyHint}>
                <CheckCircle2 color={palette.successInk} size={20} />
                <AppText variant="bodySmall" color={palette.successInk} style={styles.flex}>
                  {copy.applyHint}
                </AppText>
              </View>
            </Card>
            <AppButton
              title={copy.apply}
              disabled={!canApplyCollaboration(payload)}
              loading={apply.isPending}
              onPress={() => apply.mutate()}
            />
            <AppButton title={copy.revoke} variant="ghost" onPress={() => setConfirmClose(true)} />
          </>
        ) : (
          <Card variant="flat" style={{ backgroundColor: palette.background }}>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {copy.closed}
            </AppText>
          </Card>
        )}
      </ScreenContainer>
      <ConfirmDialog
        visible={confirmClose}
        title={copy.closeConfirmTitle}
        body={copy.closeConfirmBody}
        confirmLabel={copy.closeConfirm}
        destructive
        onClose={() => setConfirmClose(false)}
        onConfirm={() => revoke.mutate()}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  introCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: {
    width: 48,
    height: 48,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrCard: { alignItems: 'center', gap: spacing.lg },
  qrSurface: {
    borderWidth: 1,
    borderRadius: radii.xl,
    padding: spacing.sm,
    overflow: 'hidden',
  },
  expiry: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  actions: { width: '100%', flexDirection: 'row', gap: spacing.sm },
  createCard: { gap: spacing.lg },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  count: {
    minWidth: 26,
    height: 26,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  guestList: { gap: spacing.md },
  guestCard: { gap: spacing.md },
  guestHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  initial: {
    width: 42,
    height: 42,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  itemChip: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  applyHint: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
