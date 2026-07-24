import { useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { Camera, ChevronRight, Plus, ReceiptText, UserPlus } from 'lucide-react-native';
import {
  AppButton,
  AppInput,
  AppText,
  Avatar,
  AvatarGroup,
  BottomSheet,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  IconButton,
  ScreenContainer,
} from '@/components/ui';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { GroupAvatarPicker } from '@/components/group-avatar-picker';
import { GroupStreakCard, GroupStreakSkeleton } from '@/components/group-streak-card';
import { MerchantLogo } from '@/components/merchant-logo';
import { ScreenLoadingSkeleton } from '@/components/loading-skeletons';
import { pickProcessedGroupAvatar } from '@/lib/group-avatar-image';
import { repository } from '@/lib/repository';
import { useAppColors } from '@/providers/app-providers';
import { useAuth } from '@/providers/auth-provider';
import { useI18n } from '@/i18n';
import { radii, spacing } from '@/theme';

const groupTypeLabels: Record<string, string> = {
  friends: 'Amigos',
  household: 'Piso compartido',
  couple: 'Pareja',
  trip: 'Viaje',
  work: 'Trabajo',
  family: 'Familia',
  other: 'Grupo compartido',
};

type GroupDetail = Awaited<ReturnType<typeof repository.group>>;

const enter = (delay: number) =>
  FadeInDown.duration(340).delay(delay).reduceMotion(ReduceMotion.System);

export default function GroupScreen() {
  return (
    <RequireAuth>
      <GroupContent />
    </RequireAuth>
  );
}

function GroupContent() {
  const { groupId, avatarUploadFailed } = useLocalSearchParams<{
    groupId: string;
    avatarUploadFailed?: string;
  }>();
  const router = useRouter();
  const auth = useAuth();
  const palette = useAppColors();
  const cache = useQueryClient();
  const { formatMoney, formatDate } = useI18n();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMessage, setInviteMessage] = useState<string>();
  const [showInvite, setShowInvite] = useState(false);
  const [selectingPhoto, setSelectingPhoto] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState<string | undefined>(() =>
    avatarUploadFailed === '1'
      ? 'El grupo se ha creado, pero no hemos podido subir la foto. Puedes intentarlo de nuevo.'
      : undefined,
  );
  const query = useQuery({
    queryKey: ['group', groupId],
    queryFn: () => repository.group(groupId),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
  const groupStreak = useQuery({
    queryKey: ['group-streak', groupId],
    queryFn: () => repository.groupStreak(groupId),
    enabled: Boolean(groupId),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
  const reputationUserIds =
    query.data?.members.flatMap((member) => (member.user_id ? [member.user_id] : [])) ?? [];
  const reputations = useQuery({
    queryKey: ['reputations', groupId, ...reputationUserIds],
    queryFn: () => repository.reputations(reputationUserIds),
    enabled: reputationUserIds.length > 0,
  });

  const applyAvatarResult = (group: GroupDetail['group']) => {
    cache.setQueryData<GroupDetail>(['group', groupId], (current) =>
      current ? { ...current, group } : current,
    );
    void cache.invalidateQueries({ queryKey: ['groups'] });
  };
  const uploadAvatar = useMutation({
    mutationFn: (uri: string) => repository.uploadGroupAvatar(groupId, uri),
    onSuccess: (group) => {
      setAvatarMessage(undefined);
      applyAvatarResult(group);
    },
    onError: (cause) =>
      setAvatarMessage(
        cause instanceof Error ? cause.message : 'No se ha podido guardar la foto del grupo.',
      ),
  });
  const removeAvatar = useMutation({
    mutationFn: () => repository.removeGroupAvatar(groupId),
    onSuccess: (group) => {
      setAvatarMessage(undefined);
      applyAvatarResult(group);
    },
    onError: (cause) =>
      setAvatarMessage(
        cause instanceof Error ? cause.message : 'No se ha podido quitar la foto del grupo.',
      ),
  });
  const invite = useMutation({
    mutationFn: () => repository.createGroupInvite(groupId, inviteEmail || undefined),
    onSuccess: async (result) => {
      setInviteMessage(`Invitación válida hasta ${formatDate(result.expiresAt)}.`);
      await Share.share({
        message: `Te invito a mi grupo de Pagaste. Abre este enlace privado: ${result.url}`,
      });
    },
    onError: (cause) =>
      setInviteMessage(
        cause instanceof Error ? cause.message : 'No se ha podido crear la invitación.',
      ),
  });

  const pickAvatar = async () => {
    if (query.data?.group.owner_id !== auth.user?.id) return;
    setAvatarMessage(undefined);
    setSelectingPhoto(true);
    try {
      const uri = await pickProcessedGroupAvatar();
      if (uri) uploadAvatar.mutate(uri);
    } catch (cause) {
      setAvatarMessage(
        cause instanceof Error ? cause.message : 'No se ha podido preparar la foto del grupo.',
      );
    } finally {
      setSelectingPhoto(false);
    }
  };

  const openNewExpense = (mode: 'scan' | 'manual') =>
    router.push({ pathname: '/expense/new', params: { mode, groupId } });

  if (query.isPending && !query.data) return <ScreenLoadingSkeleton variant="group" />;
  if (query.isError || !query.data)
    return (
      <ScreenContainer>
        <View style={styles.screen}>
          <PageHeader title="Grupo" />
          <Card variant="grouped">
            <ErrorState
              title="No hemos encontrado este grupo"
              body="Puede que ya no tengas acceso."
              onRetry={() => void query.refetch()}
            />
          </Card>
        </View>
      </ScreenContainer>
    );

  const { group, members, expenses } = query.data;
  const typeLabel = groupTypeLabels[group.type.toLowerCase()] || 'Grupo compartido';
  const canEditAvatar = auth.user?.id === group.owner_id;
  const avatarBusy = selectingPhoto || uploadAvatar.isPending || removeAvatar.isPending;

  return (
    <ScreenContainer>
      <View style={styles.screen}>
        <PageHeader title={group.name} subtitle={group.description?.trim() || typeLabel} />

        <Card variant="elevated" padding="spacious" style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            {canEditAvatar ? (
              <GroupAvatarPicker
                name={group.name}
                uri={group.avatar_url}
                size={70}
                busy={avatarBusy}
                onPick={() => void pickAvatar()}
                onRemove={
                  group.avatar_path && !avatarBusy ? () => removeAvatar.mutate() : undefined
                }
              />
            ) : (
              <Avatar name={group.name} uri={group.avatar_url} size={70} />
            )}
            <View style={styles.summaryCopy}>
              <AppText variant="screenTitle" numberOfLines={2}>
                {group.name}
              </AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                {members.length} {members.length === 1 ? 'persona' : 'personas'} · {group.currency}
              </AppText>
              <AvatarGroup people={members.map((member) => ({ name: member.display_name }))} />
            </View>
          </View>
          {avatarMessage ? (
            <View style={[styles.avatarMessage, { backgroundColor: palette.dangerLight }]}>
              <AppText variant="bodySmall" color={palette.dangerInk}>
                {avatarMessage}
              </AppText>
            </View>
          ) : null}
          <View style={styles.expenseActions}>
            <View style={styles.expenseActionsCopy}>
              <AppText variant="heading">Añadir gasto</AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                Escanea el ticket o introduce el total a mano.
              </AppText>
            </View>
            <AppButton
              title="Escanear ticket"
              accessibilityLabel={`Escanear ticket para ${group.name}`}
              size="lg"
              fullWidth
              leftIcon={<Camera color={palette.white} size={21} strokeWidth={2.2} />}
              onPress={() => openNewExpense('scan')}
            />
            <AppButton
              title="Añadir manualmente"
              accessibilityLabel={`Añadir gasto manualmente para ${group.name}`}
              variant="outline"
              size="md"
              fullWidth
              leftIcon={<Plus color={palette.primary} size={19} strokeWidth={2.2} />}
              onPress={() => openNewExpense('manual')}
            />
          </View>
        </Card>

        <Animated.View entering={enter(80)}>
          {groupStreak.isPending && groupStreak.data === undefined ? (
            <GroupStreakSkeleton />
          ) : (
            <GroupStreakCard
              streak={groupStreak.data}
              error={groupStreak.isError}
              onRetry={() => void groupStreak.refetch()}
            />
          )}
        </Animated.View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <AppText variant="sectionTitle">Personas</AppText>
            <View style={styles.memberHeaderActions}>
              <AppText variant="bodySmall" color={palette.textMuted}>
                {members.length}
              </AppText>
              <IconButton
                label="Invitar a alguien"
                variant="soft"
                size={38}
                icon={<UserPlus color={palette.primary} size={19} strokeWidth={2} />}
                onPress={() => {
                  setInviteMessage(undefined);
                  setShowInvite(true);
                }}
              />
            </View>
          </View>
          <Card variant="grouped">
            {members.map((member, index) => {
              const role = member.role === 'owner' ? 'Administrador' : 'Miembro';
              const status = member.status === 'active' ? role : 'Invitación pendiente';
              const reputation = member.user_id ? reputations.data?.[member.user_id] : undefined;
              const reputationLabel = reputation?.score
                ? `${reputation.score}/100`
                : reputation
                  ? 'Nuevo'
                  : null;
              return (
                <View key={member.id}>
                  <View style={styles.memberRow}>
                    <Avatar name={member.display_name} size={38} />
                    <View style={styles.memberCopy}>
                      <AppText variant="label" numberOfLines={1}>
                        {member.display_name}
                      </AppText>
                      <AppText variant="caption" color={palette.textSecondary}>
                        {status}
                      </AppText>
                    </View>
                    {member.status === 'active' && reputationLabel ? (
                      <View
                        accessibilityLabel={`Reputación ${reputationLabel}`}
                        style={[styles.reputationBadge, { backgroundColor: palette.primaryLight }]}
                      >
                        <AppText variant="caption" color={palette.primary} tabular>
                          {reputationLabel}
                        </AppText>
                      </View>
                    ) : (
                      <View
                        style={[
                          styles.memberStatus,
                          {
                            backgroundColor:
                              member.status === 'active'
                                ? palette.successLight
                                : palette.warningLight,
                          },
                        ]}
                      >
                        <AppText
                          variant="caption"
                          color={
                            member.status === 'active' ? palette.successInk : palette.warningInk
                          }
                        >
                          {member.status === 'active' ? 'Activo' : 'Pendiente'}
                        </AppText>
                      </View>
                    )}
                  </View>
                  {index < members.length - 1 ? <Divider inset={64} /> : null}
                </View>
              );
            })}
          </Card>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <AppText variant="sectionTitle">Gastos del grupo</AppText>
            <AppText variant="bodySmall" color={palette.textMuted}>
              {expenses.length}
            </AppText>
          </View>
          {!expenses.length ? (
            <Card variant="grouped" style={styles.emptyCard}>
              <View style={[styles.emptyIcon, { backgroundColor: palette.primaryLight }]}>
                <ReceiptText color={palette.primary} size={26} strokeWidth={1.8} />
              </View>
              <EmptyState
                title="Aún no hay gastos"
                body="Crea el primero para empezar a repartir con el grupo."
                action={
                  <View style={styles.emptyExpenseActions}>
                    <AppButton
                      title="Escanear primer ticket"
                      leftIcon={<Camera color={palette.white} size={19} />}
                      onPress={() => openNewExpense('scan')}
                    />
                    <AppButton
                      title="Añadir manualmente"
                      variant="ghost"
                      onPress={() => openNewExpense('manual')}
                    />
                  </View>
                }
              />
            </Card>
          ) : (
            <Card variant="grouped">
              {expenses.map((expense, index) => {
                const status =
                  expense.status === 'settled'
                    ? { label: 'Pagado', color: palette.successInk }
                    : expense.status === 'sent'
                      ? { label: 'Enviado', color: palette.primary }
                      : expense.status === 'cancelled'
                        ? { label: 'Cancelado', color: palette.dangerInk }
                        : { label: 'Borrador', color: palette.warningInk };
                return (
                  <View key={expense.id}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${expense.title}, ${formatMoney(expense.total_cents, expense.currency)}, ${status.label}`}
                      onPress={() => router.push(`/expense/${expense.id}/status`)}
                      style={({ pressed }) => [
                        styles.expenseRow,
                        pressed && { backgroundColor: palette.primaryLight },
                      ]}
                    >
                      <MerchantLogo
                        merchantName={expense.merchant_name}
                        fallbackLabel={expense.title}
                        size={40}
                      />
                      <View style={styles.expenseCopy}>
                        <AppText variant="label" numberOfLines={1}>
                          {expense.title}
                        </AppText>
                        <AppText variant="caption" color={palette.textSecondary}>
                          {formatDate(expense.occurred_at)}
                        </AppText>
                      </View>
                      <View style={styles.expenseMeta}>
                        <AppText variant="label" tabular numberOfLines={1}>
                          {formatMoney(expense.total_cents, expense.currency)}
                        </AppText>
                        <AppText variant="caption" color={status.color}>
                          {status.label}
                        </AppText>
                      </View>
                      <ChevronRight color={palette.textMuted} size={20} strokeWidth={1.8} />
                    </Pressable>
                    {index < expenses.length - 1 ? <Divider inset={68} /> : null}
                  </View>
                );
              })}
            </Card>
          )}
        </View>
      </View>

      <BottomSheet
        visible={showInvite}
        onClose={() => setShowInvite(false)}
        title="Invitar al grupo"
      >
        <View style={styles.inviteSheetIntro}>
          <View style={[styles.inviteIcon, { backgroundColor: palette.primaryLight }]}>
            <UserPlus color={palette.primary} size={21} strokeWidth={1.9} />
          </View>
          <AppText variant="bodySmall" color={palette.textSecondary} style={styles.memberCopy}>
            Escribe su correo o déjalo vacío para compartir directamente el enlace privado.
          </AppText>
        </View>
        <AppInput
          label="Correo de la invitación (opcional)"
          placeholder="persona@correo.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={inviteEmail}
          onChangeText={setInviteEmail}
        />
        <AppButton
          title="Crear y compartir invitación"
          fullWidth
          loading={invite.isPending}
          onPress={() => invite.mutate()}
        />
        {inviteMessage ? (
          <View
            style={[
              styles.inviteMessage,
              {
                backgroundColor: invite.isError ? palette.dangerLight : palette.successLight,
              },
            ]}
          >
            <AppText
              variant="bodySmall"
              color={invite.isError ? palette.dangerInk : palette.successInk}
            >
              {inviteMessage}
            </AppText>
          </View>
        ) : null}
      </BottomSheet>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: {
    width: '100%',
    gap: spacing.xl,
  },
  summaryCard: {
    gap: spacing.xl,
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  summaryCopy: {
    minWidth: 0,
    flex: 1,
    gap: spacing.xs,
  },
  avatarMessage: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  expenseActions: {
    gap: spacing.sm,
  },
  expenseActionsCopy: {
    marginBottom: spacing.xs,
    gap: spacing.xxs,
  },
  section: {
    gap: spacing.sm,
  },
  sectionHeader: {
    minHeight: 28,
    paddingHorizontal: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  memberHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  memberRow: {
    minHeight: 58,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  memberCopy: {
    minWidth: 0,
    flex: 1,
    gap: 1,
  },
  memberStatus: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
  },
  reputationBadge: {
    minHeight: 28,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  inviteSheetIntro: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  inviteIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteMessage: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  emptyCard: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
    alignItems: 'center',
    gap: 0,
  },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyExpenseActions: {
    width: '100%',
    gap: spacing.sm,
  },
  expenseRow: {
    minHeight: 76,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  expenseCopy: {
    minWidth: 0,
    flex: 1,
    gap: 1,
  },
  expenseMeta: {
    maxWidth: 120,
    alignItems: 'flex-end',
    gap: 1,
  },
});
