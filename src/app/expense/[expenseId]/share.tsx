import { useEffect, useState } from 'react';
import { Share as NativeShare, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Check, CheckCircle2, Copy, Share2, UsersRound } from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  AppButton,
  AppText,
  Avatar,
  Card,
  CurrencyAmount,
  EmptyState,
  ErrorState,
  ScreenContainer,
} from '@/components/ui';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { ScreenLoadingSkeleton } from '@/components/loading-skeletons';
import { repository } from '@/lib/repository';
import { readSmallJson } from '@/lib/storage';
import type { ClaimLink } from '@/lib/models';
import { useAppColors } from '@/providers/app-providers';
import { spacing } from '@/theme';
import { useI18n } from '@/i18n';

export default function ShareScreen() {
  return (
    <RequireAuth>
      <ShareContent />
    </RequireAuth>
  );
}

function ShareContent() {
  const { expenseId } = useLocalSearchParams<{ expenseId: string }>();
  const router = useRouter();
  const palette = useAppColors();
  const { formatMoney, t } = useI18n();
  const [links, setLinks] = useState<ClaimLink[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState<string>();
  const query = useQuery({
    queryKey: ['expense', expenseId],
    queryFn: () => repository.expense(expenseId),
  });

  useEffect(() => {
    readSmallJson<ClaimLink[]>(`claim-links:${expenseId}`)
      .then(setLinks)
      .finally(() => setLoaded(true));
  }, [expenseId]);

  if ((query.isPending && !query.data) || !loaded) return <ScreenLoadingSkeleton variant="share" />;
  if (query.isError || !query.data)
    return (
      <ScreenContainer>
        <ErrorState body={t('share.loadError')} onRetry={() => void query.refetch()} />
      </ScreenContainer>
    );

  const groupMessage = links?.length
    ? [
        t('share.groupMessageHeader', { title: query.data.title }),
        ...links.map((link) => {
          const participant = query.data.participants.find(
            (value) => value.id === link.debtorParticipantId,
          );
          return t('share.groupMessageLine', {
            name: participant?.display_name ?? t('share.participant'),
            amount: formatMoney(link.amountCents, query.data.currency),
            url: link.url,
          });
        }),
      ].join('\n\n')
    : '';

  return (
    <ScreenContainer contentContainerStyle={styles.screenContent}>
      <PageHeader title={t('expense.shareTitle')} />

      <View style={styles.successHero}>
        <View style={[styles.successIcon, { backgroundColor: palette.successLight }]}>
          <CheckCircle2 color={palette.success} size={38} strokeWidth={2} />
        </View>
        <AppText variant="screenTitle" style={styles.centerText}>
          {t('share.successTitle')}
        </AppText>
        <AppText color={palette.textSecondary} style={styles.centerText}>
          {t('share.successBody')}
        </AppText>
      </View>

      {!links?.length ? (
        <Card>
          <EmptyState
            title={t('share.linksMissingTitle')}
            body={t('share.linksMissingBody')}
            action={
              <AppButton
                title={t('share.viewStatus')}
                onPress={() => router.replace(`/expense/${expenseId}/status`)}
              />
            }
          />
        </Card>
      ) : (
        <View style={styles.linksSection}>
          <View style={styles.sectionHeading}>
            <AppText variant="heading">{t('share.privateLinks')}</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {t(links.length === 1 ? 'share.requestOne' : 'share.requestMany', {
                count: links.length,
              })}
            </AppText>
          </View>
          {query.data.group_id ? (
            <Card
              variant="flat"
              style={[styles.groupShareCard, { backgroundColor: palette.primaryLight }]}
            >
              <View style={styles.personRow}>
                <View style={[styles.groupShareIcon, { backgroundColor: palette.surface }]}>
                  <UsersRound color={palette.primary} size={22} strokeWidth={2} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="heading">{t('share.groupTitle')}</AppText>
                  <AppText variant="bodySmall" color={palette.textSecondary}>
                    {t('share.groupBody')}
                  </AppText>
                </View>
              </View>
              <AppButton
                title={t('share.groupAction')}
                fullWidth
                leftIcon={<Share2 color={palette.white} size={18} />}
                onPress={() => void NativeShare.share({ message: groupMessage })}
              />
            </Card>
          ) : null}
          {links.map((link) => {
            const participant = query.data.participants.find(
              (value) => value.id === link.debtorParticipantId,
            );
            const name = participant?.display_name ?? t('share.participant');
            const message = t('share.message', {
              name,
              title: query.data.title,
              amount: formatMoney(link.amountCents, query.data.currency),
              url: link.url,
            });
            const isCopied = copied === link.claimId;
            return (
              <Card key={link.claimId} style={styles.linkCard}>
                <View style={styles.personRow}>
                  <Avatar name={name} uri={participant?.avatar_path} size={48} />
                  <View style={styles.flex}>
                    <AppText variant="heading">{name}</AppText>
                    <AppText variant="bodySmall" color={palette.textSecondary}>
                      {t('share.individualRequest')}
                    </AppText>
                  </View>
                  <CurrencyAmount
                    cents={link.amountCents}
                    currency={query.data.currency}
                    variant="heading"
                  />
                </View>
                <View style={styles.actions}>
                  <AppButton
                    title={t('common.share')}
                    style={styles.flex}
                    leftIcon={<Share2 color={palette.white} size={18} />}
                    onPress={() => void NativeShare.share({ message })}
                  />
                  <AppButton
                    title={isCopied ? t('share.linkCopied') : t('share.copyLink')}
                    variant="outline"
                    style={styles.flex}
                    leftIcon={
                      isCopied ? (
                        <Check color={palette.primary} size={18} />
                      ) : (
                        <Copy color={palette.primary} size={18} />
                      )
                    }
                    onPress={async () => {
                      await Clipboard.setStringAsync(link.url);
                      setCopied(link.claimId);
                    }}
                  />
                </View>
              </Card>
            );
          })}
        </View>
      )}

      <AppButton
        title={t('share.statusAction')}
        size="lg"
        onPress={() => router.replace(`/expense/${expenseId}/status`)}
      />
      <AppText variant="caption" color={palette.textSecondary} style={styles.legalText}>
        {t('share.legal')}
      </AppText>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screenContent: { gap: spacing.xl },
  centerText: { textAlign: 'center' },
  successHero: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.sm },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  linksSection: { gap: spacing.md },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupShareCard: { gap: spacing.lg },
  groupShareIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkCard: { gap: spacing.lg },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
  legalText: { textAlign: 'center', paddingHorizontal: spacing.lg },
});
