import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Copy,
  Landmark,
  Phone,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react-native';
import { BrandLogo } from '@/components/brand-logo';
import {
  AppButton,
  AppInput,
  AppText,
  Avatar,
  BottomSheet,
  Card,
  CurrencyAmount,
  ErrorState,
  ReceiptItemRow,
  ScreenContainer,
  StatusBadge,
} from '@/components/ui';
import { ScreenLoadingSkeleton } from '@/components/loading-skeletons';
import { repository } from '@/lib/repository';
import { lightHaptic } from '@/lib/haptics';
import { useAppColors } from '@/providers/app-providers';
import { normalizeLocale, useI18n } from '@/i18n';
import { spacing } from '@/theme';

type DisputeReason =
  'did_not_consume' | 'incorrect_amount' | 'already_paid' | 'unknown_expense' | 'other';

export default function PublicClaimScreen() {
  const { token, lang } = useLocalSearchParams<{ token: string; lang?: string }>();
  const palette = useAppColors();
  const { formatMoney, formatDate, setLocale, t } = useI18n();
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState<DisputeReason>('incorrect_amount');
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState<string>();

  useEffect(() => {
    if (lang) setLocale(normalizeLocale(lang));
  }, [lang, setLocale]);

  const query = useQuery({
    queryKey: ['public-claim', token],
    queryFn: () => repository.publicClaim(token),
    retry: 1,
  });

  useEffect(() => {
    if (!lang && query.data?.recipientLocale)
      setLocale(normalizeLocale(query.data.recipientLocale));
  }, [lang, query.data?.recipientLocale, setLocale]);

  const dispute = useMutation({
    mutationFn: () => repository.disputeClaim(token, reason, message.trim() || undefined),
    onSuccess: async () => {
      setDisputeOpen(false);
      setFeedback(t('claim.reviewSent'));
      await lightHaptic();
      await query.refetch();
    },
    onError: () => setFeedback(t('claim.reviewError')),
  });

  if (query.isPending && !query.data) return <ScreenLoadingSkeleton variant="publicClaim" />;
  if (query.isError || !query.data) {
    return (
      <ScreenContainer publicPage>
        <ErrorState title={t('claim.invalidTitle')} body={t('claim.invalidBody')} />
      </ScreenContainer>
    );
  }

  const claim = query.data;
  const paymentOpen = claim.status === 'pending' || claim.status === 'reminder_sent';
  const statusPresentation =
    claim.status === 'received'
      ? {
          title: t('claim.receivedTitle', { name: claim.creditorDisplayName }),
          body: t('claim.receivedBody'),
          backgroundColor: palette.successLight,
          color: palette.successInk,
          icon: <CheckCircle2 color={palette.successInk} size={25} />,
        }
      : claim.status === 'disputed'
        ? {
            title: t('claim.disputedTitle'),
            body: t('claim.disputedBody', { name: claim.creditorDisplayName }),
            backgroundColor: palette.warningLight,
            color: palette.warningInk,
            icon: <TriangleAlert color={palette.warningInk} size={25} />,
          }
        : {
            title: t('claim.cancelledTitle'),
            body: t('claim.cancelledBody'),
            backgroundColor: palette.dangerLight,
            color: palette.danger,
            icon: <TriangleAlert color={palette.danger} size={25} />,
          };

  return (
    <ScreenContainer publicPage contentContainerStyle={styles.screenContent}>
      <View style={styles.brand}>
        <BrandLogo variant="horizontal" width={190} testID="pagaste-brand-logo" />
        <AppText variant="caption" color={palette.textSecondary}>
          {t('claim.privateLink')}
        </AppText>
      </View>

      <Card style={[styles.hero, { backgroundColor: palette.primaryLight }]}>
        <View style={[styles.avatarRing, { borderColor: palette.surface }]}>
          <Avatar name={claim.creditorDisplayName} uri={claim.creditorAvatarUrl} size={62} />
        </View>
        <AppText variant="bodySmall" color={palette.textSecondary}>
          {t('claim.youOwe')}
        </AppText>
        <AppText variant="screenTitle" style={styles.centerText}>
          {claim.creditorDisplayName}
        </AppText>
        <CurrencyAmount
          cents={claim.amountCents}
          currency={claim.currency}
          variant="display"
          color={palette.primary}
        />
        <AppText variant="caption" color={palette.textSecondary}>
          {t('claim.yourShareOf', { expense: claim.expenseTitle })}
        </AppText>
        {claim.merchantName ? (
          <AppText variant="bodySmall" color={palette.textSecondary} style={styles.centerText}>
            {claim.merchantName} · {formatDate(claim.occurredAt)}
          </AppText>
        ) : null}
        <StatusBadge status={claim.status} label={t(`status.${claim.status}`)} />
      </Card>

      {paymentOpen ? (
        <Card style={styles.paymentCard}>
          <View style={styles.paymentHeading}>
            <View style={[styles.paymentIcon, { backgroundColor: palette.successLight }]}>
              <Landmark color={palette.successInk} size={22} />
            </View>
            <View style={styles.flex}>
              <AppText variant="heading">{t('claim.payFromBank')}</AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                {t('claim.payFromBankBody')}
              </AppText>
            </View>
          </View>

          <View style={[styles.dataRow, { borderTopColor: palette.divider }]}>
            <View style={styles.flex}>
              <AppText variant="caption" color={palette.textSecondary}>
                {t('claim.amount')}
              </AppText>
              <AppText variant="label">{formatMoney(claim.amountCents, claim.currency)}</AppText>
            </View>
            <AppButton
              title={t('common.copy')}
              variant="ghost"
              size="sm"
              leftIcon={<Copy color={palette.primary} size={17} />}
              onPress={async () => {
                await Clipboard.setStringAsync(
                  formatMoney(claim.amountCents, claim.currency).replace(/[^\d,.-]/g, ''),
                );
                setFeedback(t('claim.amountCopied'));
              }}
            />
          </View>

          {claim.creditorPhoneE164 ? (
            <View
              testID="public-payment-phone"
              style={[styles.dataRow, { borderTopColor: palette.divider }]}
            >
              <View style={styles.phoneLabel}>
                <Phone color={palette.primary} size={18} />
                <View style={styles.flex}>
                  <AppText variant="caption" color={palette.textSecondary}>
                    {t('claim.phoneOf', { name: claim.creditorDisplayName })}
                  </AppText>
                  <AppText variant="label">{claim.creditorPhoneE164}</AppText>
                </View>
              </View>
              <AppButton
                title={t('common.copy')}
                variant="ghost"
                size="sm"
                leftIcon={<Copy color={palette.primary} size={17} />}
                onPress={async () => {
                  await Clipboard.setStringAsync(claim.creditorPhoneE164 ?? '');
                  setFeedback(t('claim.phoneCopied'));
                }}
              />
            </View>
          ) : (
            <View style={[styles.privatePhone, { borderTopColor: palette.divider }]}>
              <ShieldCheck color={palette.textSecondary} size={18} />
              <AppText variant="bodySmall" color={palette.textSecondary} style={styles.flex}>
                {t('claim.phoneHidden', { name: claim.creditorDisplayName })}
              </AppText>
            </View>
          )}
        </Card>
      ) : (
        <Card
          variant="flat"
          style={[styles.closedPayment, { backgroundColor: statusPresentation.backgroundColor }]}
        >
          {statusPresentation.icon}
          <View style={styles.flex}>
            <AppText variant="heading" color={statusPresentation.color}>
              {statusPresentation.title}
            </AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {statusPresentation.body}
            </AppText>
          </View>
        </Card>
      )}

      <Card style={styles.flowCard}>
        <View style={styles.flowHeading}>
          <View style={[styles.paymentIcon, { backgroundColor: palette.primaryLight }]}>
            <ShieldCheck color={palette.primary} size={22} />
          </View>
          <View style={styles.flex}>
            <AppText variant="heading">{t('claim.noConfirmation')}</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {t('claim.noConfirmationBody')}
            </AppText>
          </View>
        </View>
        <View style={styles.flowSteps}>
          <FlowStep number="1" text={t('claim.flowStep1')} />
          <FlowStep number="2" text={t('claim.flowStep2')} />
          <FlowStep number="3" text={t('claim.flowStep3', { name: claim.creditorDisplayName })} />
        </View>
        <View style={[styles.disclaimer, { backgroundColor: palette.background }]}>
          <AppText variant="caption" color={palette.textSecondary} style={styles.centerText}>
            {t('claim.paymentDisclaimer')}
          </AppText>
        </View>
      </Card>

      <Card variant="grouped" style={styles.groupedCard}>
        <View style={styles.cardHeading}>
          <AppText variant="heading">{t('claim.breakdown')}</AppText>
          <AppText variant="caption" color={palette.textSecondary}>
            {claim.items.length} {t(claim.items.length === 1 ? 'claim.product' : 'claim.products')}
          </AppText>
        </View>
        <View style={[styles.divider, { backgroundColor: palette.divider }]} />
        {claim.items.map((item, index) => (
          <View key={`${item.name}-${index}`}>
            <View style={styles.calculationRow}>
              <ReceiptItemRow
                name={item.name}
                amountCents={item.assignedAmountCents}
                currency={claim.currency}
                subtitle={t('claim.originalLine', {
                  allocation: item.allocationLabel,
                  amount: formatMoney(item.originalLineTotalCents, claim.currency),
                })}
              />
            </View>
            {index < claim.items.length - 1 ? (
              <View style={[styles.indentedDivider, { backgroundColor: palette.divider }]} />
            ) : null}
          </View>
        ))}
      </Card>

      {feedback ? (
        <Card style={[styles.feedback, { backgroundColor: palette.successLight }]}>
          <CheckCircle2 color={palette.successInk} size={20} />
          <AppText variant="bodySmall" color={palette.successInk} style={styles.flex}>
            {feedback}
          </AppText>
        </Card>
      ) : null}

      {claim.canDispute ? (
        <AppButton
          testID="public-dispute"
          title={t('claim.disputeButton')}
          variant="outline"
          size="lg"
          onPress={() => setDisputeOpen(true)}
        />
      ) : null}

      <AppText variant="caption" color={palette.textSecondary} style={styles.centerText}>
        {t('claim.authorizedData')}
      </AppText>

      <BottomSheet
        visible={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        title={t('claim.disputeTitle')}
      >
        <View style={styles.methods}>
          {(
            [
              ['did_not_consume', t('claim.reasonDidNotConsume')],
              ['incorrect_amount', t('claim.reasonIncorrectAmount')],
              ['already_paid', t('claim.reasonAlreadyPaid')],
              ['unknown_expense', t('claim.reasonUnknownExpense')],
              ['other', t('claim.reasonOther')],
            ] as const
          ).map(([value, label]) => (
            <AppButton
              key={value}
              title={label}
              variant={reason === value ? 'primary' : 'secondary'}
              onPress={() => setReason(value)}
            />
          ))}
        </View>
        <AppInput
          label={t('claim.optionalExplanation')}
          value={message}
          onChangeText={setMessage}
          maxLength={500}
          multiline
        />
        <AppButton
          title={t('claim.sendForReview')}
          loading={dispute.isPending}
          onPress={() => dispute.mutate()}
        />
      </BottomSheet>
    </ScreenContainer>
  );
}

function FlowStep({ number, text }: { number: string; text: string }) {
  const palette = useAppColors();
  return (
    <View style={styles.flowStep}>
      <View style={[styles.stepNumber, { backgroundColor: palette.primaryLight }]}>
        <AppText variant="label" color={palette.primary}>
          {number}
        </AppText>
      </View>
      <AppText variant="bodySmall" color={palette.textSecondary} style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: { gap: spacing.lg },
  brand: { alignItems: 'center', gap: spacing.xs, paddingTop: spacing.sm },
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  avatarRing: { borderWidth: 4, borderRadius: 36 },
  centerText: { textAlign: 'center' },
  groupedCard: { gap: 0 },
  cardHeading: {
    minHeight: 62,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  divider: { width: '100%', height: 1 },
  indentedDivider: { height: 1, marginLeft: spacing.lg },
  calculationRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  paymentCard: { gap: 0 },
  paymentHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  paymentIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dataRow: {
    minHeight: 72,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  phoneLabel: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  privatePhone: {
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingTop: spacing.lg,
  },
  closedPayment: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flowCard: { gap: spacing.lg },
  flowHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flowSteps: { gap: spacing.md },
  flowStep: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disclaimer: { borderRadius: 12, padding: spacing.md },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
