import { useEffect, useState } from 'react';
import { Share as NativeShare, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Check, CheckCircle2, Copy, Share2 } from 'lucide-react-native';
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
  const { formatMoney } = useI18n();
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
        <ErrorState
          body="No hemos podido cargar las solicitudes."
          onRetry={() => void query.refetch()}
        />
      </ScreenContainer>
    );

  return (
    <ScreenContainer contentContainerStyle={styles.screenContent}>
      <PageHeader title="Solicitudes listas" />

      <View style={styles.successHero}>
        <View style={[styles.successIcon, { backgroundColor: palette.successLight }]}>
          <CheckCircle2 color={palette.success} size={38} strokeWidth={2} />
        </View>
        <AppText variant="screenTitle" style={styles.centerText}>
          Reparto completado
        </AppText>
        <AppText color={palette.textSecondary} style={styles.centerText}>
          Comparte cada enlace únicamente con la persona correspondiente.
        </AppText>
      </View>

      {!links?.length ? (
        <Card>
          <EmptyState
            title="Los enlaces ya no están en este dispositivo"
            body="Por seguridad, solo aparecen al crearlos. El estado de los cobros sigue disponible."
            action={
              <AppButton
                title="Ver estado"
                onPress={() => router.replace(`/expense/${expenseId}/status`)}
              />
            }
          />
        </Card>
      ) : (
        <View style={styles.linksSection}>
          <View style={styles.sectionHeading}>
            <AppText variant="heading">Enlaces privados</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {links.length} {links.length === 1 ? 'solicitud' : 'solicitudes'}
            </AppText>
          </View>
          {links.map((link) => {
            const participant = query.data.participants.find(
              (value) => value.id === link.debtorParticipantId,
            );
            const name = participant?.display_name ?? 'Participante';
            const message = `${name}, esta es tu parte de “${query.data.title}”: ${formatMoney(link.amountCents, query.data.currency)}. Revísala aquí: ${link.url}`;
            const isCopied = copied === link.claimId;
            return (
              <Card key={link.claimId} style={styles.linkCard}>
                <View style={styles.personRow}>
                  <Avatar name={name} uri={participant?.avatar_path} size={48} />
                  <View style={styles.flex}>
                    <AppText variant="heading">{name}</AppText>
                    <AppText variant="bodySmall" color={palette.textSecondary}>
                      Solicitud individual
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
                    title="Compartir"
                    style={styles.flex}
                    leftIcon={<Share2 color={palette.white} size={18} />}
                    onPress={() => void NativeShare.share({ message })}
                  />
                  <AppButton
                    title={isCopied ? 'Enlace copiado' : 'Copiar enlace'}
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
        title="Ver estado del cobro"
        size="lg"
        onPress={() => router.replace(`/expense/${expenseId}/status`)}
      />
      <AppText variant="caption" color={palette.textSecondary} style={styles.legalText}>
        Los enlaces son individuales y privados. No compartas un enlace en un grupo.
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
  linkCard: { gap: spacing.lg },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
  legalText: { textAlign: 'center', paddingHorizontal: spacing.lg },
});
