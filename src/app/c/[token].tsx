import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Copy,
  Landmark,
  Phone,
  ReceiptText,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react-native';
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
import { useI18n } from '@/i18n';
import { spacing } from '@/theme';

type DisputeReason =
  'did_not_consume' | 'incorrect_amount' | 'already_paid' | 'unknown_expense' | 'other';

export default function PublicClaimScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const palette = useAppColors();
  const { formatMoney, formatDate, t } = useI18n();
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState<DisputeReason>('incorrect_amount');
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState<string>();

  const query = useQuery({
    queryKey: ['public-claim', token],
    queryFn: () => repository.publicClaim(token),
    retry: 1,
  });

  const dispute = useMutation({
    mutationFn: () => repository.disputeClaim(token, reason, message.trim() || undefined),
    onSuccess: async () => {
      setDisputeOpen(false);
      setFeedback('Hemos avisado para que revise el reparto.');
      await lightHaptic();
      await query.refetch();
    },
    onError: () => setFeedback('No hemos podido enviar la revisión. Inténtalo de nuevo.'),
  });

  if (query.isPending && !query.data) return <ScreenLoadingSkeleton variant="publicClaim" />;
  if (query.isError || !query.data) {
    return (
      <ScreenContainer publicPage>
        <ErrorState
          title="Este enlace ya no está disponible"
          body="Puede haber caducado, haberse revocado o no ser correcto."
        />
      </ScreenContainer>
    );
  }

  const claim = query.data;
  const paymentOpen = claim.status === 'pending' || claim.status === 'reminder_sent';
  const statusPresentation =
    claim.status === 'received'
      ? {
          title: `${claim.creditorDisplayName} lo ha marcado como recibido`,
          body: 'El cobro está cerrado. No tienes que hacer nada más.',
          backgroundColor: palette.successLight,
          color: palette.successInk,
          icon: <CheckCircle2 color={palette.successInk} size={25} />,
        }
      : claim.status === 'disputed'
        ? {
            title: 'Reparto en revisión',
            body: `${claim.creditorDisplayName} ha recibido tu aviso. Espera a que revise el importe antes de pagar.`,
            backgroundColor: palette.warningLight,
            color: palette.warningInk,
            icon: <TriangleAlert color={palette.warningInk} size={25} />,
          }
        : {
            title: 'Solicitud cancelada',
            body: 'Este cobro ya no está activo y no tienes que pagarlo desde este enlace.',
            backgroundColor: palette.dangerLight,
            color: palette.danger,
            icon: <TriangleAlert color={palette.danger} size={25} />,
          };

  return (
    <ScreenContainer publicPage contentContainerStyle={styles.screenContent}>
      <View style={styles.brand}>
        <View style={[styles.brandMark, { backgroundColor: palette.primary }]}>
          <ReceiptText color={palette.white} size={22} />
        </View>
        <AppText variant="screenTitle" color={palette.primary}>
          Pagaste
        </AppText>
        <AppText variant="caption" color={palette.textSecondary}>
          Enlace privado de cobro
        </AppText>
      </View>

      <Card style={[styles.hero, { backgroundColor: palette.primaryLight }]}>
        <View style={[styles.avatarRing, { borderColor: palette.surface }]}>
          <Avatar name={claim.creditorDisplayName} uri={claim.creditorAvatarUrl} size={62} />
        </View>
        <AppText variant="bodySmall" color={palette.textSecondary}>
          Debes pagar a
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
          Tu parte de {claim.expenseTitle}
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
              <AppText variant="heading">Paga desde tu banco</AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                Haz el Bizum o la transferencia fuera de Pagaste
              </AppText>
            </View>
          </View>

          <View style={[styles.dataRow, { borderTopColor: palette.divider }]}>
            <View style={styles.flex}>
              <AppText variant="caption" color={palette.textSecondary}>
                Importe
              </AppText>
              <AppText variant="label">{formatMoney(claim.amountCents, claim.currency)}</AppText>
            </View>
            <AppButton
              title="Copiar"
              variant="ghost"
              size="sm"
              leftIcon={<Copy color={palette.primary} size={17} />}
              onPress={async () => {
                await Clipboard.setStringAsync(
                  formatMoney(claim.amountCents, claim.currency).replace(/[^\d,.-]/g, ''),
                );
                setFeedback('Importe copiado.');
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
                    Teléfono de {claim.creditorDisplayName}
                  </AppText>
                  <AppText variant="label">{claim.creditorPhoneE164}</AppText>
                </View>
              </View>
              <AppButton
                title="Copiar"
                variant="ghost"
                size="sm"
                leftIcon={<Copy color={palette.primary} size={17} />}
                onPress={async () => {
                  await Clipboard.setStringAsync(claim.creditorPhoneE164 ?? '');
                  setFeedback('Teléfono copiado.');
                }}
              />
            </View>
          ) : (
            <View style={[styles.privatePhone, { borderTopColor: palette.divider }]}>
              <ShieldCheck color={palette.textSecondary} size={18} />
              <AppText variant="bodySmall" color={palette.textSecondary} style={styles.flex}>
                El teléfono no está visible en este enlace. Usa los datos de pago que te haya
                facilitado {claim.creditorDisplayName}.
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
            <AppText variant="heading">Sin confirmaciones en Pagaste</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              El pago se completa únicamente en tu banco
            </AppText>
          </View>
        </View>
        <View style={styles.flowSteps}>
          <FlowStep
            number="1"
            text="Realiza el Bizum o la transferencia desde la aplicación de tu banco."
          />
          <FlowStep
            number="2"
            text="Cuando termines, no tienes que pulsar «Ya he pagado» ni volver a Pagaste."
          />
          <FlowStep
            number="3"
            text={`${claim.creditorDisplayName} marcará el cobro como recibido cuando vea el ingreso en su banco.`}
          />
        </View>
        <View style={[styles.disclaimer, { backgroundColor: palette.background }]}>
          <AppText variant="caption" color={palette.textSecondary} style={styles.centerText}>
            Pagaste no procesa, ejecuta ni verifica el pago.
          </AppText>
        </View>
      </Card>

      <Card variant="grouped" style={styles.groupedCard}>
        <View style={styles.cardHeading}>
          <AppText variant="heading">Cómo se calcula</AppText>
          <AppText variant="caption" color={palette.textSecondary}>
            {claim.items.length} {claim.items.length === 1 ? 'producto' : 'productos'}
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
                subtitle={`${item.allocationLabel} · línea original ${formatMoney(item.originalLineTotalCents, claim.currency)}`}
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
          title="Hay un error en el reparto"
          variant="outline"
          size="lg"
          onPress={() => setDisputeOpen(true)}
        />
      ) : null}

      <AppText variant="caption" color={palette.textSecondary} style={styles.centerText}>
        Este enlace muestra solo tu parte y los datos autorizados por quien pagó. No lo reenvíes.
      </AppText>

      <BottomSheet
        visible={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        title="Cuéntanos qué no cuadra"
      >
        <View style={styles.methods}>
          {(
            [
              ['did_not_consume', 'No consumí esto'],
              ['incorrect_amount', 'Importe incorrecto'],
              ['already_paid', 'Ya estaba pagado'],
              ['unknown_expense', 'No reconozco el gasto'],
              ['other', 'Otro'],
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
          label="Explicación opcional"
          value={message}
          onChangeText={setMessage}
          maxLength={500}
          multiline
        />
        <AppButton
          title="Enviar para revisión"
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
  brandMark: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
