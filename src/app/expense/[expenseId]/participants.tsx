import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  ChevronRight,
  Minus,
  Plus,
  QrCode,
  ReceiptText,
  Send,
  Sparkles,
  Star,
  Trash2,
  WalletCards,
} from 'lucide-react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppButton,
  AppInput,
  AppText,
  Avatar,
  BottomSheet,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  MoneyInput,
  ParticipantChip,
  ScreenContainer,
} from '@/components/ui';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { ScreenLoadingSkeleton } from '@/components/loading-skeletons';
import {
  splitByCustomAmounts,
  splitByPercentages,
  splitByUnits,
  splitEvenly,
  sumCents,
} from '@/domain/money';
import { equalAllocationValues, isManualRemainder } from '@/domain/manual-expense';
import { repository } from '@/lib/repository';
import type { ExpenseItem, Participant } from '@/lib/models';
import {
  favoritePersonKey,
  findDuplicatePerson,
  mergePersonSuggestions,
  rankPersonSuggestions,
  type DuplicateReason,
  type PersonIdentity,
  type PersonSuggestion,
} from '@/domain/person-suggestions';
import { loadFavoritePeople, saveFavoritePeople } from '@/lib/favorite-people';
import { getPeopleCopy } from '@/features/people/i18n';
import { collaborationCopy } from '@/features/collaboration/i18n';
import { useAppColors } from '@/providers/app-providers';
import { useI18n } from '@/i18n';
import { useAuth } from '@/providers/auth-provider';
import { radii, spacing } from '@/theme';
import { ThreeDIcon } from '@/components/three-d-icon';
import { productThreeDAsset } from '@/lib/product-visual';
import {
  calculateSettlementTransfers,
  type ContributionMethod,
  type SettlementTransfer,
} from '@/domain/contributions';

type AllocationMode = 'all' | 'all_except' | 'one' | 'equal' | 'units' | 'custom' | 'percentage';

type DuplicateResolution = {
  candidate: PersonIdentity;
  existing: Participant;
  reason: DuplicateReason;
};

export default function ParticipantsScreen() {
  return (
    <RequireAuth>
      <ParticipantsContent />
    </RequireAuth>
  );
}

function ParticipantsContent() {
  const { expenseId } = useLocalSearchParams<{ expenseId: string }>();
  const router = useRouter();
  const auth = useAuth();
  const palette = useAppColors();
  const cache = useQueryClient();
  const { formatMoney, locale, t } = useI18n();
  const peopleCopy = getPeopleCopy(locale);
  const collaborativeCopy = collaborationCopy(locale);
  const modeLabels = useMemo<Record<AllocationMode, string>>(
    () => ({
      all: t('participants.modeAll'),
      all_except: t('participants.modeAllExcept'),
      one: t('participants.modeOne'),
      equal: t('participants.modeEqual'),
      units: t('participants.modeUnits'),
      custom: t('participants.modeCustom'),
      percentage: t('participants.modePercentage'),
    }),
    [t],
  );
  const query = useQuery({
    queryKey: ['expense', expenseId],
    queryFn: () => repository.expense(expenseId),
  });
  const [name, setName] = useState('');
  const [participantError, setParticipantError] = useState<string>();
  const [allocationError, setAllocationError] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [addingParticipant, setAddingParticipant] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [productName, setProductName] = useState('');
  const [productAmount, setProductAmount] = useState(0);
  const [productQuantity, setProductQuantity] = useState('1');
  const [productError, setProductError] = useState<string>();
  const [editingItem, setEditingItem] = useState<ExpenseItem>();
  const [mode, setMode] = useState<AllocationMode>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<string>();
  const [units, setUnits] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, number>>({});
  const [percentages, setPercentages] = useState<Record<string, string>>({});
  const [savingSplit, setSavingSplit] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [favoriteKeys, setFavoriteKeys] = useState<Set<string>>(new Set());
  const [duplicateResolution, setDuplicateResolution] = useState<DuplicateResolution>();
  const [editingContributions, setEditingContributions] = useState(false);
  const [contributionAmounts, setContributionAmounts] = useState<Record<string, number>>({});
  const [contributionMethods, setContributionMethods] = useState<
    Record<string, ContributionMethod>
  >({});
  const [contributionError, setContributionError] = useState<string>();
  const detail = query.data;
  const recentPeopleQuery = useQuery({
    queryKey: ['recent-people', auth.user?.id],
    enabled: Boolean(auth.user?.id),
    queryFn: () => repository.listRecentPeople(auth.user!.id),
  });
  const currentGroupQuery = useQuery({
    queryKey: ['group', detail?.group_id],
    enabled: Boolean(detail?.group_id),
    queryFn: () => repository.group(detail!.group_id!),
  });
  useEffect(() => {
    let active = true;
    if (!auth.user?.id) {
      return () => {
        active = false;
      };
    }
    void loadFavoritePeople(auth.user.id).then((keys) => {
      if (active) setFavoriteKeys(new Set(keys));
    });
    return () => {
      active = false;
    };
  }, [auth.user?.id]);
  const refresh = () => cache.invalidateQueries({ queryKey: ['expense', expenseId] });
  const add = useMutation({
    mutationFn: async (candidate: PersonIdentity & { avatarPath?: string | null }) => {
      if (candidate.displayName.trim().length < 2) throw new Error(peopleCopy.invalidName);
      const participant = await repository.addParticipant(
        expenseId,
        {
          displayName: candidate.displayName.trim(),
          userId: candidate.userId ?? undefined,
          email: candidate.email ?? undefined,
          phoneE164: candidate.phoneE164 ?? undefined,
          avatarPath: candidate.avatarPath ?? undefined,
        },
        detail?.participants.length ?? 0,
      );
      const participantIds = [
        ...(detail?.participants.map((person) => person.id) ?? []),
        participant.id,
      ];
      for (const item of detail?.items ?? []) {
        const current = detail?.allocations.filter((allocation) => allocation.item_id === item.id);
        if (!current?.length || current.every((allocation) => allocation.method === 'equal'))
          await repository.replaceAllocations(
            item.id,
            equalAllocationValues(item.line_total_cents, participantIds),
          );
      }
    },
    onSuccess: async () => {
      setName('');
      setParticipantError(undefined);
      setDuplicateResolution(undefined);
      setAddingParticipant(false);
      await refresh();
    },
    onError: (cause) =>
      setParticipantError(cause instanceof Error ? cause.message : peopleCopy.addFailed),
  });
  const allocationsByItem = useMemo(
    () =>
      new Map(
        (detail?.items ?? []).map((item) => [
          item.id,
          (detail?.allocations ?? []).filter((allocation) => allocation.item_id === item.id),
        ]),
      ),
    [detail],
  );
  const totalsByParticipant = useMemo(() => {
    const totals = new Map<string, number>();
    for (const allocation of detail?.allocations ?? [])
      totals.set(
        allocation.participant_id,
        sumCents([totals.get(allocation.participant_id) ?? 0, allocation.amount_cents]),
      );
    return totals;
  }, [detail?.allocations]);
  const paidByParticipant = useMemo(() => {
    const paid = new Map<string, number>();
    for (const contribution of detail?.contributions ?? []) {
      paid.set(
        contribution.participant_id,
        sumCents([paid.get(contribution.participant_id) ?? 0, contribution.amount_cents]),
      );
    }
    if (!paid.size && detail) {
      const primaryPayer = detail.participants.find((participant) => participant.is_payer);
      if (primaryPayer && detail.total_cents > 0) paid.set(primaryPayer.id, detail.total_cents);
    }
    return paid;
  }, [detail]);
  const personSuggestions = useMemo(() => {
    const groupName = currentGroupQuery.data?.group.name ?? null;
    const groupSuggestions: PersonSuggestion[] = (currentGroupQuery.data?.members ?? [])
      .filter((member) => member.status === 'active' && member.user_id !== auth.user?.id)
      .map((member) => ({
        id: `group:${member.id}`,
        displayName: member.display_name,
        userId: member.user_id,
        avatarPath: member.avatar_path,
        groupName,
        sources: ['group'],
      }));
    const merged = mergePersonSuggestions([...groupSuggestions, ...(recentPeopleQuery.data ?? [])]);
    return rankPersonSuggestions(merged, favoriteKeys).slice(0, 20);
  }, [auth.user?.id, currentGroupQuery.data, favoriteKeys, recentPeopleQuery.data]);
  const requestAddPerson = (candidate: PersonIdentity & { avatarPath?: string | null }) => {
    if (!detail) return;
    const duplicate = findDuplicatePerson(
      candidate,
      detail.participants.map((participant) => ({
        ...participant,
        displayName: participant.display_name,
        userId: participant.user_id,
        phoneE164: participant.phone_e164,
      })),
    );
    if (duplicate) {
      setDuplicateResolution({
        candidate,
        existing: duplicate.person,
        reason: duplicate.reason,
      });
      return;
    }
    add.mutate(candidate);
  };
  const toggleFavorite = async (person: PersonSuggestion) => {
    if (!auth.user?.id) return;
    const key = favoritePersonKey(person);
    const next = new Set(favoriteKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFavoriteKeys(next);
    await saveFavoritePeople(auth.user.id, [...next]);
  };
  const addProduct = useMutation({
    mutationFn: async () => {
      if (!detail) throw new Error(t('participants.expenseLoadError'));
      const parsedQuantity = Number(productQuantity.replace(',', '.'));
      if (
        productName.trim().length < 2 ||
        productAmount <= 0 ||
        !/^\d{1,4}(?:[.,]\d{1,3})?$/u.test(productQuantity) ||
        !Number.isFinite(parsedQuantity) ||
        parsedQuantity <= 0
      )
        throw new Error(t('participants.productInvalid'));

      const remainder = detail.items.find((item) => isManualRemainder(item.category));
      const detailedTotal = sumCents(
        detail.items
          .filter((item) => !isManualRemainder(item.category))
          .map((item) => item.line_total_cents),
      );
      const available = remainder?.line_total_cents ?? detail.total_cents - detailedTotal;
      if (productAmount > available)
        throw new Error(
          t('participants.productAvailable', {
            amount: formatMoney(Math.max(0, available), detail.currency),
          }),
        );

      const product = await repository.addItem(
        expenseId,
        {
          name: productName.trim(),
          lineTotalCents: productAmount,
          quantity: parsedQuantity,
          source: 'manual',
        },
        detail.items.length,
      );
      let remainderUpdated = false;
      try {
        await repository.replaceAllocations(
          product.id,
          equalAllocationValues(
            product.line_total_cents,
            detail.participants.map((participant) => participant.id),
          ),
        );
        if (remainder) {
          const remaining = remainder.line_total_cents - productAmount;
          if (remaining === 0) {
            await repository.deleteItem(remainder.id);
          } else {
            await repository.updateItem(remainder.id, {
              line_total_cents: remaining,
              unit_price_cents: remaining,
            });
            remainderUpdated = true;
            await repository.replaceAllocations(
              remainder.id,
              equalAllocationValues(
                remaining,
                detail.participants.map((participant) => participant.id),
              ),
            );
          }
        }
      } catch (cause) {
        await repository.deleteItem(product.id).catch(() => undefined);
        if (remainder && remainderUpdated) {
          await repository
            .updateItem(remainder.id, {
              line_total_cents: remainder.line_total_cents,
              unit_price_cents: remainder.line_total_cents,
            })
            .catch(() => undefined);
          await repository
            .replaceAllocations(
              remainder.id,
              equalAllocationValues(
                remainder.line_total_cents,
                detail.participants.map((participant) => participant.id),
              ),
            )
            .catch(() => undefined);
        }
        throw cause;
      }
    },
    onSuccess: async () => {
      setProductName('');
      setProductAmount(0);
      setProductQuantity('1');
      setProductError(undefined);
      setAddingProduct(false);
      await refresh();
    },
    onError: (cause) =>
      setProductError(cause instanceof Error ? cause.message : t('participants.productAddError')),
  });
  const saveContributions = useMutation({
    mutationFn: async () => {
      if (!detail) throw new Error(t('participants.expenseLoadError'));
      const contributions = detail.participants
        .map((participant) => ({
          participantId: participant.id,
          amountCents: contributionAmounts[participant.id] ?? 0,
          method: contributionMethods[participant.id] ?? ('card' as const),
        }))
        .filter((contribution) => contribution.amountCents > 0);
      const unsupportedContributor = contributions.find(
        (contribution) =>
          !detail.participants.find(
            (participant) => participant.id === contribution.participantId && participant.user_id,
          ),
      );
      if (unsupportedContributor) throw new Error(t('participants.registeredContributorOnly'));
      const contributedTotal = sumCents(
        contributions.map((contribution) => contribution.amountCents),
      );
      if (!contributions.length || contributedTotal !== detail.total_cents) {
        throw new Error(
          t('participants.contributionExactError', {
            amount: formatMoney(detail.total_cents, detail.currency),
          }),
        );
      }
      return repository.saveExpenseContributions(expenseId, contributions);
    },
    onSuccess: async () => {
      setContributionError(undefined);
      setEditingContributions(false);
      await refresh();
    },
    onError: (cause) =>
      setContributionError(
        cause instanceof Error ? cause.message : t('participants.contributionSaveError'),
      ),
  });
  const openContributionEditor = () => {
    if (!detail) return;
    setContributionAmounts(
      Object.fromEntries(
        detail.participants.map((participant) => [
          participant.id,
          paidByParticipant.get(participant.id) ?? 0,
        ]),
      ),
    );
    setContributionMethods(
      Object.fromEntries(
        detail.participants.map((participant) => [
          participant.id,
          detail.contributions.find(
            (contribution) => contribution.participant_id === participant.id,
          )?.method ?? 'card',
        ]),
      ),
    );
    setContributionError(undefined);
    setEditingContributions(true);
  };

  const openAllocation = (item: ExpenseItem, participants: Participant[]) => {
    const existing = allocationsByItem.get(item.id) ?? [];
    const existingIds = existing.map((allocation) => allocation.participant_id);
    setAllocationError(undefined);
    setEditingItem(item);
    setMode(
      existing[0]?.method === 'units'
        ? 'units'
        : existing[0]?.method === 'percentage'
          ? 'percentage'
          : existing[0]?.method === 'custom'
            ? 'custom'
            : existingIds.length === participants.length
              ? 'all'
              : 'equal',
    );
    setSelected(
      existingIds.length ? existingIds : participants.map((participant) => participant.id),
    );
    setExcluded(undefined);
    setUnits(
      Object.fromEntries(
        participants.map((participant) => [
          participant.id,
          String(existing.find((value) => value.participant_id === participant.id)?.units ?? 1),
        ]),
      ),
    );
    setCustom(
      Object.fromEntries(
        participants.map((participant) => [
          participant.id,
          existing.find((value) => value.participant_id === participant.id)?.amount_cents ?? 0,
        ]),
      ),
    );
    const base = Math.floor(100 / Math.max(1, participants.length));
    setPercentages(
      Object.fromEntries(
        participants.map((participant, index) => [
          participant.id,
          String(index === participants.length - 1 ? 100 - base * (participants.length - 1) : base),
        ]),
      ),
    );
  };

  if (query.isPending && !detail) return <ScreenLoadingSkeleton variant="participants" />;
  if (query.isError || !detail)
    return (
      <ScreenContainer>
        <ErrorState body={t('participants.loadError')} onRetry={() => void query.refetch()} />
      </ScreenContainer>
    );

  const applyAllocation = async () => {
    if (!editingItem) return;
    setSavingSplit(true);
    setAllocationError(undefined);
    try {
      const people = detail.participants;
      let targets: { memberId: string; amountCents: number }[];
      let method: 'equal' | 'units' | 'custom' | 'percentage';
      if (mode === 'all') {
        targets = splitEvenly(
          editingItem.line_total_cents,
          people.map((participant) => participant.id),
        );
        method = 'equal';
      } else if (mode === 'all_except') {
        const included = people.filter((participant) => participant.id !== excluded);
        targets = splitEvenly(
          editingItem.line_total_cents,
          included.map((participant) => participant.id),
        );
        method = 'equal';
      } else if (mode === 'one') {
        if (selected.length !== 1) throw new Error(t('participants.chooseOne'));
        targets = [{ memberId: selected[0], amountCents: editingItem.line_total_cents }];
        method = 'custom';
      } else if (mode === 'equal') {
        targets = splitEvenly(editingItem.line_total_cents, selected);
        method = 'equal';
      } else if (mode === 'units') {
        targets = splitByUnits(
          editingItem.line_total_cents,
          people.map((participant) => ({
            memberId: participant.id,
            units: Number(units[participant.id] || 0),
          })),
        );
        method = 'units';
      } else if (mode === 'percentage') {
        targets = splitByPercentages(
          editingItem.line_total_cents,
          people.map((participant) => ({
            memberId: participant.id,
            percentage: percentages[participant.id] || '0',
          })),
        );
        method = 'percentage';
      } else {
        targets = splitByCustomAmounts(
          editingItem.line_total_cents,
          people.map((participant) => ({
            memberId: participant.id,
            amountCents: custom[participant.id] ?? 0,
          })),
        );
        method = 'custom';
      }
      await repository.replaceAllocations(
        editingItem.id,
        targets
          .filter((target) => target.amountCents !== 0)
          .map((target) => ({
            participant_id: target.memberId,
            method,
            // `equal` is its own database method. The `shares` column is only
            // valid when method = `shares`; sending 1 here violates the
            // item_allocations method/metadata check constraint.
            shares: null,
            percentage:
              method === 'percentage'
                ? Number((percentages[target.memberId] || '0').replace(',', '.'))
                : null,
            units: method === 'units' ? Number(units[target.memberId] || 0) : null,
            amount_cents: target.amountCents,
          })),
      );
      setEditingItem(undefined);
      await refresh();
    } catch (cause) {
      setAllocationError(cause instanceof Error ? cause.message : t('participants.splitSaveError'));
    } finally {
      setSavingSplit(false);
    }
  };

  const suggestAllocations = async () => {
    if (detail.participants.length < 2) {
      setFeedback(t('participants.addPersonBeforeSuggest'));
      setAddingParticipant(true);
      return;
    }
    setSuggesting(true);
    setFeedback(undefined);
    try {
      for (const item of detail.items) {
        await repository.replaceAllocations(
          item.id,
          equalAllocationValues(
            item.line_total_cents,
            detail.participants.map((participant) => participant.id),
          ),
        );
      }
      setFeedback(t('participants.equalSplitRestored'));
      await refresh();
    } catch {
      setFeedback(t('participants.suggestError'));
    } finally {
      setSuggesting(false);
    }
  };

  const allocationsValid = detail.items.every(
    (item) =>
      sumCents(
        (allocationsByItem.get(item.id) ?? []).map((allocation) => allocation.amount_cents),
      ) === item.line_total_cents,
  );
  const contributedTotal = sumCents([...paidByParticipant.values()]);
  let settlementTransfers: SettlementTransfer[] = [];
  if (allocationsValid && contributedTotal === detail.total_cents) {
    try {
      settlementTransfers = calculateSettlementTransfers(
        detail.participants.map((participant) => ({
          participantId: participant.id,
          shareCents: totalsByParticipant.get(participant.id) ?? 0,
          paidCents: paidByParticipant.get(participant.id) ?? 0,
          sortOrder: participant.sort_order,
        })),
      );
    } catch {
      settlementTransfers = [];
    }
  }
  const settlementByDebtor = new Map<string, number>();
  for (const settlement of settlementTransfers) {
    settlementByDebtor.set(
      settlement.debtorParticipantId,
      sumCents([
        settlementByDebtor.get(settlement.debtorParticipantId) ?? 0,
        settlement.amountCents,
      ]),
    );
  }
  const debtors = detail.participants.filter(
    (participant) => (settlementByDebtor.get(participant.id) ?? 0) > 0,
  );
  const totalToCollect = sumCents([...settlementByDebtor.values()]);
  const contributors = detail.participants.filter(
    (participant) => (paidByParticipant.get(participant.id) ?? 0) > 0,
  );
  const contributionDraftTotal = sumCents(Object.values(contributionAmounts));
  const manualRemainder = detail.items.find((item) => isManualRemainder(item.category));
  const detailedTotal = sumCents(
    detail.items
      .filter((item) => !isManualRemainder(item.category))
      .map((item) => item.line_total_cents),
  );
  const availableToDetail = manualRemainder?.line_total_cents ?? detail.total_cents - detailedTotal;
  const removeParticipant = async (participant: Participant) => {
    const remainingIds = detail.participants
      .filter((person) => person.id !== participant.id)
      .map((person) => person.id);
    const equalItems = detail.items.filter((item) => {
      const allocations = allocationsByItem.get(item.id) ?? [];
      return (
        !allocations.length || allocations.every((allocation) => allocation.method === 'equal')
      );
    });
    await repository.deleteParticipant(participant.id);
    for (const item of equalItems)
      await repository.replaceAllocations(
        item.id,
        equalAllocationValues(item.line_total_cents, remainingIds),
      );
    await refresh();
  };

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      <ScreenContainer>
        <PageHeader
          title={t('participants.splitTitle')}
          action={
            <AppButton
              title={t('participants.equalize')}
              accessibilityLabel={t('participants.equalizeA11y')}
              variant="ghost"
              size="sm"
              loading={suggesting}
              onPress={() => void suggestAllocations()}
            />
          }
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.peopleContent}
          style={styles.peopleScroller}
        >
          {detail.participants.map((participant) => (
            <View key={participant.id} style={styles.personAvatar}>
              <View
                style={[
                  styles.avatarRing,
                  {
                    borderColor: participant.is_payer ? palette.primary : palette.border,
                    backgroundColor: palette.surface,
                  },
                ]}
              >
                <Avatar name={participant.display_name} uri={participant.avatar_path} size={48} />
              </View>
              <AppText
                variant="bodySmall"
                color={participant.is_payer ? palette.primary : palette.textPrimary}
                numberOfLines={1}
                style={styles.personName}
              >
                {participant.is_payer ? t('common.you') : participant.display_name}
              </AppText>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('expense.addParticipant')}
            onPress={() => {
              setParticipantError(undefined);
              setAddingParticipant(true);
            }}
            style={({ pressed }) => [styles.personAvatar, pressed && styles.pressed]}
          >
            <View style={[styles.addAvatar, { borderColor: palette.primary }]}>
              <Plus color={palette.primary} size={28} />
            </View>
            <AppText variant="bodySmall" style={styles.personName}>
              {t('common.add')}
            </AppText>
          </Pressable>
        </ScrollView>

        <Card style={styles.collaborationCard}>
          <View style={[styles.equalBannerIcon, { backgroundColor: palette.primaryLight }]}>
            <QrCode color={palette.primary} size={21} />
          </View>
          <View style={styles.flex}>
            <AppText variant="label">{collaborativeCopy.ownerIntroTitle}</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {collaborativeCopy.ownerIntro}
            </AppText>
          </View>
          <AppButton
            title={collaborativeCopy.qrAction}
            variant="outline"
            size="sm"
            onPress={() => router.push(`/expense/${expenseId}/collaborate` as Href)}
          />
        </Card>

        {detail.participants.length >= 2 ? (
          <Card
            variant="flat"
            style={[styles.equalBanner, { backgroundColor: palette.primaryLight }]}
          >
            <View style={[styles.equalBannerIcon, { backgroundColor: palette.surface }]}>
              <Sparkles color={palette.primary} size={19} />
            </View>
            <View style={styles.flex}>
              <AppText variant="label">{t('participants.equalPreparedTitle')}</AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                {t('participants.equalPreparedBody')}
              </AppText>
            </View>
          </Card>
        ) : null}

        {feedback ? (
          <Card variant="flat" style={{ backgroundColor: palette.primaryLight }}>
            <AppText variant="bodySmall" color={palette.primary}>
              {feedback}
            </AppText>
          </Card>
        ) : null}

        {detail.participants.length < 2 ? (
          <EmptyState
            title={t('participants.minimumTitle')}
            body={t('participants.minimumBody')}
            action={
              <AppButton
                title={t('expense.addParticipant')}
                onPress={() => setAddingParticipant(true)}
              />
            }
          />
        ) : (
          <>
            <View style={styles.productsHeading}>
              <View style={styles.flex}>
                <AppText variant="sectionTitle">{t('participants.detailTitle')}</AppText>
                <AppText variant="bodySmall" color={palette.textSecondary}>
                  {availableToDetail > 0
                    ? t('participants.remainingToDetail', {
                        amount: formatMoney(availableToDetail, detail.currency),
                      })
                    : t('participants.fullyDetailed')}
                </AppText>
              </View>
              {availableToDetail > 0 ? (
                <AppButton
                  title={t('participants.addProduct')}
                  variant="outline"
                  size="sm"
                  leftIcon={<Plus color={palette.primary} size={17} />}
                  onPress={() => {
                    setProductError(undefined);
                    setAddingProduct(true);
                  }}
                />
              ) : null}
            </View>
            <Card variant="grouped" padding="none">
              {detail.items.map((item, index) => {
                const itemAllocations = allocationsByItem.get(item.id) ?? [];
                const isRemainder = isManualRemainder(item.category);
                const itemAsset = productThreeDAsset(item);
                const allocationLabel =
                  itemAllocations.length === 0
                    ? t('expense.unassigned')
                    : itemAllocations.length === 1
                      ? (detail.participants.find(
                          (participant) => participant.id === itemAllocations[0]?.participant_id,
                        )?.display_name ?? t('expense.assigned'))
                      : `${t('participants.shared')} · ${itemAllocations.length}`;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={t('participants.allocationA11y', {
                      item: isRemainder ? t('participants.unassignedRemainder') : item.name,
                      allocation: allocationLabel,
                    })}
                    onPress={() => openAllocation(item, detail.participants)}
                    style={({ pressed }) => [
                      styles.productRow,
                      index > 0 && { borderTopColor: palette.divider, borderTopWidth: 1 },
                      pressed && styles.pressed,
                    ]}
                  >
                    <View
                      style={[
                        styles.itemIcon,
                        {
                          backgroundColor:
                            item.source === 'adjustment' ? palette.warningLight : 'transparent',
                        },
                      ]}
                    >
                      {isRemainder ? (
                        <ReceiptText color={palette.primary} size={23} />
                      ) : itemAsset ? (
                        <ThreeDIcon name={itemAsset} size={40} />
                      ) : (
                        <Minus color={palette.warningInk} size={20} strokeWidth={2.2} />
                      )}
                    </View>
                    <View style={styles.productCopy}>
                      <AppText variant="label">
                        {isRemainder ? t('participants.generalSplit') : item.name}
                      </AppText>
                      <AppText variant="bodySmall" color={palette.textSecondary}>
                        {isRemainder
                          ? t('participants.withoutProducts', {
                              amount: formatMoney(item.line_total_cents, detail.currency),
                            })
                          : formatMoney(item.line_total_cents, detail.currency)}
                      </AppText>
                      {!itemAllocations.length ? (
                        <AppText variant="caption" color={palette.danger}>
                          {t('participants.productUnassigned')}
                        </AppText>
                      ) : null}
                    </View>
                    <View
                      style={[
                        styles.assignmentPill,
                        itemAllocations.length > 1 && styles.sharedPill,
                        { backgroundColor: palette.primaryLight },
                      ]}
                    >
                      <AppText
                        variant={itemAllocations.length > 1 ? 'caption' : 'label'}
                        color={palette.primary}
                        numberOfLines={1}
                      >
                        {itemAllocations.length > 1 ? t('participants.shared') : allocationLabel}
                      </AppText>
                      {itemAllocations.length > 1 ? (
                        <View style={styles.miniAvatars}>
                          {itemAllocations.slice(0, 2).map((allocation, avatarIndex) => {
                            const participant = detail.participants.find(
                              (person) => person.id === allocation.participant_id,
                            );
                            return participant ? (
                              <View
                                key={allocation.id}
                                style={avatarIndex ? styles.miniAvatarOverlap : undefined}
                              >
                                <Avatar
                                  name={participant.display_name}
                                  uri={participant.avatar_path}
                                  size={22}
                                />
                              </View>
                            ) : null;
                          })}
                          {itemAllocations.length > 2 ? (
                            <View
                              style={[
                                styles.moreAvatar,
                                {
                                  backgroundColor: palette.surface,
                                  borderColor: palette.primaryLight,
                                },
                              ]}
                            >
                              <AppText variant="caption" color={palette.primary}>
                                +{itemAllocations.length - 2}
                              </AppText>
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                      <ChevronRight color={palette.primary} size={17} />
                    </View>
                  </Pressable>
                );
              })}
            </Card>
          </>
        )}

        {detail.participants.length >= 2 ? (
          <Card style={styles.contributionCard}>
            <View style={styles.contributionHeading}>
              <View style={[styles.equalBannerIcon, { backgroundColor: palette.primaryLight }]}>
                <WalletCards color={palette.primary} size={20} />
              </View>
              <View style={styles.flex}>
                <AppText variant="sectionTitle">{t('participants.contributionTitle')}</AppText>
                <AppText variant="bodySmall" color={palette.textSecondary}>
                  {t('participants.contributionBody')}
                </AppText>
              </View>
              <AppButton
                title={t('common.edit')}
                size="sm"
                variant="outline"
                onPress={openContributionEditor}
              />
            </View>
            {contributors.map((participant) => (
              <View key={participant.id} style={styles.contributorRow}>
                <Avatar name={participant.display_name} uri={participant.avatar_path} size={34} />
                <AppText variant="bodySmall" style={styles.flex}>
                  {participant.display_name}
                </AppText>
                <AppText variant="label" color={palette.primary}>
                  {formatMoney(paidByParticipant.get(participant.id) ?? 0, detail.currency)}
                </AppText>
              </View>
            ))}
            {contributedTotal !== detail.total_cents ? (
              <AppText variant="bodySmall" color={palette.dangerInk}>
                {t('participants.contributionMismatch')}
              </AppText>
            ) : null}
          </Card>
        ) : null}

        {detail.participants.length >= 2 ? (
          <Card style={styles.summaryCard}>
            <AppText variant="sectionTitle">{t('participants.summaryTitle')}</AppText>
            {debtors.length ? (
              <View style={styles.summaryPeople}>
                {debtors.map((participant, index) => (
                  <View
                    key={participant.id}
                    style={[
                      styles.summaryPerson,
                      index < debtors.length - 1 && {
                        borderRightColor: palette.divider,
                        borderRightWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <AppText variant="bodySmall" numberOfLines={1} style={styles.summaryName}>
                      {participant.display_name}
                    </AppText>
                    <AppText
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.78}
                      color={palette.primary}
                      style={styles.summaryAmount}
                    >
                      {formatMoney(settlementByDebtor.get(participant.id) ?? 0, detail.currency)}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : (
              <AppText variant="bodySmall" color={palette.textSecondary}>
                {t('participants.assignHelp')}
              </AppText>
            )}
            <View style={[styles.summaryTotal, { borderTopColor: palette.divider }]}>
              <AppText variant="label">{t('participants.totalToCollect')}</AppText>
              <AppText variant="metric">{formatMoney(totalToCollect, detail.currency)}</AppText>
            </View>
          </Card>
        ) : null}
        <AppButton
          testID="review-expense"
          title={
            totalToCollect > 0 ? t('participants.sendCollections') : t('participants.finishExpense')
          }
          variant="success"
          size="lg"
          fullWidth
          leftIcon={<Send color={palette.white} size={21} />}
          disabled={
            detail.participants.length < 2 ||
            !allocationsValid ||
            contributedTotal !== detail.total_cents
          }
          onPress={() => router.push(`/expense/${expenseId}/review`)}
        />
      </ScreenContainer>
      <BottomSheet
        visible={editingContributions}
        onClose={() => {
          if (saveContributions.isPending) return;
          setEditingContributions(false);
          setContributionError(undefined);
        }}
        title={t('participants.contributionSheetTitle')}
      >
        <AppText variant="bodySmall" color={palette.textSecondary}>
          {t('participants.contributionSheetBody')}
        </AppText>
        {detail.participants.map((participant) => {
          const selectedMethod = contributionMethods[participant.id] ?? 'card';
          return (
            <Card key={participant.id} variant="flat" style={styles.contributionEditorRow}>
              <View style={styles.contributorRow}>
                <Avatar name={participant.display_name} uri={participant.avatar_path} size={38} />
                <AppText variant="label" style={styles.flex}>
                  {participant.display_name}
                </AppText>
              </View>
              <MoneyInput
                label={t('participants.amountAdvanced')}
                valueCents={contributionAmounts[participant.id] ?? 0}
                editable={Boolean(participant.user_id)}
                onChangeCents={(value) =>
                  setContributionAmounts((current) => ({
                    ...current,
                    [participant.id]: Math.max(0, value),
                  }))
                }
                currency={detail.currency}
                hint={
                  participant.user_id
                    ? detail.currency
                    : t('participants.registeredContributorOnly')
                }
              />
              {(contributionAmounts[participant.id] ?? 0) > 0 ? (
                <View style={styles.methodButtons}>
                  {(
                    [
                      ['card', t('participants.methodCard')],
                      ['cash', t('participants.methodCash')],
                      ['reservation', t('participants.methodReservation')],
                      ['other', t('participants.methodOther')],
                    ] as const
                  ).map(([method, label]) => (
                    <AppButton
                      key={method}
                      title={label}
                      size="sm"
                      variant={selectedMethod === method ? 'primary' : 'secondary'}
                      onPress={() =>
                        setContributionMethods((current) => ({
                          ...current,
                          [participant.id]: method,
                        }))
                      }
                    />
                  ))}
                </View>
              ) : null}
            </Card>
          );
        })}
        <View
          style={[
            styles.contributionTotal,
            {
              borderColor:
                contributionDraftTotal === detail.total_cents ? palette.success : palette.warning,
              backgroundColor:
                contributionDraftTotal === detail.total_cents
                  ? palette.successLight
                  : palette.warningLight,
            },
          ]}
        >
          <AppText variant="label">{t('participants.totalContributed')}</AppText>
          <AppText variant="heading">
            {formatMoney(contributionDraftTotal, detail.currency)}
          </AppText>
          <AppText variant="caption" color={palette.textSecondary}>
            {t('participants.mustBe', {
              amount: formatMoney(detail.total_cents, detail.currency),
            })}
          </AppText>
        </View>
        {contributionError ? (
          <AppText color={palette.dangerInk}>{contributionError}</AppText>
        ) : null}
        <AppButton
          title={t('participants.saveContributions')}
          loading={saveContributions.isPending}
          disabled={contributionDraftTotal !== detail.total_cents}
          onPress={() => saveContributions.mutate()}
        />
      </BottomSheet>
      <BottomSheet
        visible={addingProduct}
        onClose={() => {
          setAddingProduct(false);
          setProductError(undefined);
        }}
        title={t('participants.addProductSheetTitle')}
      >
        <View style={[styles.productBudget, { backgroundColor: palette.primaryLight }]}>
          <AppText variant="bodySmall" color={palette.textSecondary}>
            {t('participants.availableAmount')}
          </AppText>
          <AppText variant="metric" color={palette.primary}>
            {formatMoney(Math.max(0, availableToDetail), detail.currency)}
          </AppText>
        </View>
        <AppInput
          testID="split-item-name"
          label={t('expense.itemName')}
          placeholder={t('expense.itemPlaceholder')}
          value={productName}
          onChangeText={setProductName}
        />
        <AppInput
          label={t('participants.quantity')}
          keyboardType="decimal-pad"
          value={productQuantity}
          onChangeText={(value) => setProductQuantity(value.replace(/[^\d.,]/gu, '').slice(0, 8))}
          hint={t('participants.quantityHint')}
        />
        <MoneyInput
          testID="split-item-amount"
          label={t('participants.totalAmount')}
          valueCents={productAmount}
          onChangeCents={setProductAmount}
          currency={detail.currency}
        />
        <AppText variant="caption" color={palette.textSecondary}>
          {t('participants.addSplitHelp')}
        </AppText>
        {productError ? <AppText color={palette.danger}>{productError}</AppText> : null}
        <AppButton
          testID="split-add-item"
          title={t('participants.addAndSplit')}
          loading={addProduct.isPending}
          leftIcon={<Plus color={palette.white} size={19} />}
          onPress={() => addProduct.mutate()}
        />
      </BottomSheet>
      <BottomSheet
        visible={addingParticipant || detail.participants.length < 2}
        onClose={() => setAddingParticipant(false)}
        title={t('participants.addSheetTitle')}
      >
        <AppText variant="bodySmall" color={palette.textSecondary}>
          {peopleCopy.intro}
        </AppText>
        {recentPeopleQuery.isPending || currentGroupQuery.isPending ? (
          <AppText variant="bodySmall" color={palette.textSecondary}>
            {peopleCopy.loading}
          </AppText>
        ) : personSuggestions.length ? (
          <View style={styles.suggestions}>
            <AppText variant="label">
              {detail.group_id ? peopleCopy.habitualGroup : peopleCopy.recent}
            </AppText>
            {personSuggestions.map((person) => {
              const identity = {
                displayName: person.displayName,
                userId: person.userId,
                email: person.email,
                phoneE164: person.phoneE164,
              };
              const alreadyAdded = Boolean(
                findDuplicatePerson(
                  identity,
                  detail.participants.map((participant) => ({
                    displayName: participant.display_name,
                    userId: participant.user_id,
                    email: participant.email,
                    phoneE164: participant.phone_e164,
                  })),
                ),
              );
              const isFavorite = favoriteKeys.has(favoritePersonKey(person));
              return (
                <View
                  key={person.id}
                  style={[styles.suggestionRow, { borderColor: palette.divider }]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={peopleCopy.suggestionA11y(person.displayName)}
                    accessibilityState={{ disabled: alreadyAdded }}
                    disabled={alreadyAdded || add.isPending}
                    onPress={() => requestAddPerson(person)}
                    style={({ pressed }) => [
                      styles.suggestionMain,
                      pressed && styles.pressed,
                      alreadyAdded && styles.disabledSuggestion,
                    ]}
                  >
                    <Avatar name={person.displayName} uri={person.avatarPath} size={38} />
                    <View style={styles.flex}>
                      <AppText variant="label">{person.displayName}</AppText>
                      <AppText variant="caption" color={palette.textSecondary}>
                        {alreadyAdded
                          ? peopleCopy.alreadyAdded
                          : (person.groupName ??
                            (person.sources.includes('group')
                              ? peopleCopy.habitualGroup
                              : peopleCopy.recent))}
                      </AppText>
                    </View>
                  </Pressable>
                  <IconButton
                    label={isFavorite ? peopleCopy.favoriteRemove : peopleCopy.favoriteAdd}
                    variant="plain"
                    icon={
                      <Star
                        color={isFavorite ? palette.warning : palette.textMuted}
                        fill={isFavorite ? palette.warning : 'transparent'}
                        size={19}
                      />
                    }
                    onPress={() => void toggleFavorite(person)}
                  />
                </View>
              );
            })}
          </View>
        ) : (
          <AppText variant="caption" color={palette.textSecondary}>
            {peopleCopy.noSuggestions}
          </AppText>
        )}
        {duplicateResolution ? (
          <Card
            variant="flat"
            style={[styles.duplicateCard, { backgroundColor: palette.warningLight }]}
          >
            <AppText variant="label" color={palette.warningInk}>
              {peopleCopy.duplicateTitle}
            </AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {peopleCopy.duplicateBody(
                duplicateResolution.candidate.displayName,
                duplicateResolution.existing.display_name,
              )}
            </AppText>
            <View style={styles.duplicateActions}>
              <AppButton
                title={peopleCopy.duplicateUse}
                size="sm"
                onPress={() => {
                  setFeedback(peopleCopy.alreadyAdded);
                  setDuplicateResolution(undefined);
                  setAddingParticipant(false);
                }}
              />
              <AppButton
                title={peopleCopy.duplicateCancel}
                variant="ghost"
                size="sm"
                onPress={() => setDuplicateResolution(undefined)}
              />
            </View>
          </Card>
        ) : null}
        <AppInput
          testID="participant-name"
          label={t('expense.participantName')}
          placeholder={t('expense.participantPlaceholder')}
          value={name}
          onChangeText={setName}
          error={participantError}
        />
        <AppButton
          testID="add-participant"
          title={t('expense.addParticipant')}
          loading={add.isPending}
          onPress={() => requestAddPerson({ displayName: name.trim() })}
        />
        {detail.participants.some((participant) => !participant.is_payer) ? (
          <View style={styles.managePeople}>
            <AppText variant="label">{t('participants.addedPeople')}</AppText>
            {detail.participants
              .filter((participant) => !participant.is_payer)
              .map((participant) => (
                <View key={participant.id} style={styles.managePersonRow}>
                  <Avatar name={participant.display_name} size={34} />
                  <AppText variant="bodySmall" style={styles.flex}>
                    {participant.display_name}
                  </AppText>
                  <IconButton
                    label={t('participants.deletePersonA11y', {
                      name: participant.display_name,
                    })}
                    icon={<Trash2 size={17} color={palette.danger} />}
                    variant="plain"
                    onPress={async () => {
                      await removeParticipant(participant);
                    }}
                  />
                </View>
              ))}
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet
        visible={Boolean(editingItem)}
        onClose={() => setEditingItem(undefined)}
        title={
          editingItem
            ? t('participants.splitItemTitle', { name: editingItem.name })
            : t('participants.splitProductFallback')
        }
      >
        <View style={styles.modes}>
          {(Object.keys(modeLabels) as AllocationMode[]).map((value) => (
            <AppButton
              key={value}
              title={modeLabels[value]}
              variant={mode === value ? 'primary' : 'secondary'}
              size="sm"
              onPress={() => {
                setMode(value);
                if (value === 'one') setSelected([]);
              }}
            />
          ))}
        </View>
        {mode === 'one' || mode === 'equal' ? (
          <View style={styles.chips}>
            {detail.participants.map((participant) => (
              <ParticipantChip
                key={participant.id}
                name={participant.display_name}
                selected={selected.includes(participant.id)}
                onPress={() =>
                  setSelected((current) =>
                    mode === 'one'
                      ? [participant.id]
                      : current.includes(participant.id)
                        ? current.filter((id) => id !== participant.id)
                        : [...current, participant.id],
                  )
                }
              />
            ))}
          </View>
        ) : null}
        {mode === 'all_except' ? (
          <>
            <AppText>{t('participants.excludePrompt')}</AppText>
            <View style={styles.chips}>
              {detail.participants.map((participant) => (
                <ParticipantChip
                  key={participant.id}
                  name={participant.display_name}
                  selected={excluded === participant.id}
                  onPress={() => setExcluded(participant.id)}
                />
              ))}
            </View>
          </>
        ) : null}
        {mode === 'units'
          ? detail.participants.map((participant) => (
              <AppInput
                key={participant.id}
                label={t('participants.unitsFor', { name: participant.display_name })}
                keyboardType="number-pad"
                value={units[participant.id] ?? '1'}
                onChangeText={(value) =>
                  setUnits((current) => ({
                    ...current,
                    [participant.id]: value.replace(/\D/g, ''),
                  }))
                }
              />
            ))
          : null}
        {mode === 'custom'
          ? detail.participants.map((participant) => (
              <MoneyInput
                key={participant.id}
                label={participant.display_name}
                valueCents={custom[participant.id] ?? 0}
                onChangeCents={(value) =>
                  setCustom((current) => ({ ...current, [participant.id]: value }))
                }
                currency={detail.currency}
                allowNegative={(editingItem?.line_total_cents ?? 0) < 0}
              />
            ))
          : null}
        {mode === 'percentage'
          ? detail.participants.map((participant) => (
              <AppInput
                key={participant.id}
                label={t('participants.percentageFor', {
                  name: participant.display_name,
                })}
                keyboardType="decimal-pad"
                value={percentages[participant.id] ?? ''}
                onChangeText={(value) =>
                  setPercentages((current) => ({
                    ...current,
                    [participant.id]: value.replace(/[^\d,.]/g, ''),
                  }))
                }
                hint={t('participants.percentageHint')}
              />
            ))
          : null}
        {allocationError ? <AppText color={palette.danger}>{allocationError}</AppText> : null}
        <AppButton
          title={t('participants.applySplit')}
          loading={savingSplit}
          onPress={() => void applyAllocation()}
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.72 },
  peopleScroller: { marginHorizontal: -spacing.xl },
  peopleContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxs,
    gap: spacing.sm,
  },
  personAvatar: { width: 60, alignItems: 'center', gap: spacing.xs },
  avatarRing: { borderWidth: 2, borderRadius: radii.pill, padding: 2 },
  addAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  personName: { width: 64, textAlign: 'center' },
  equalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  collaborationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  equalBannerIcon: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productsHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  productRow: {
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  itemIcon: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productCopy: { flex: 1, gap: spacing.xxs },
  assignmentPill: {
    minWidth: 92,
    maxWidth: 132,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sharedPill: { minWidth: 138, maxWidth: 154, paddingHorizontal: spacing.sm },
  miniAvatars: { flexDirection: 'row', alignItems: 'center' },
  miniAvatarOverlap: { marginLeft: -5 },
  moreAvatar: {
    width: 24,
    height: 24,
    marginLeft: -5,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCard: { paddingVertical: 14, gap: spacing.sm },
  contributionCard: { gap: spacing.md },
  contributionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  contributorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  contributionEditorRow: { gap: spacing.md },
  methodButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  contributionTotal: {
    borderWidth: 1,
    borderRadius: radii.control,
    padding: spacing.md,
    gap: spacing.xs,
  },
  summaryPeople: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summaryPerson: {
    minWidth: 0,
    flex: 1,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    gap: spacing.xs,
  },
  summaryName: { textAlign: 'center' },
  summaryAmount: { fontSize: 21, lineHeight: 27, fontWeight: '800', letterSpacing: -0.3 },
  summaryTotal: {
    borderTopWidth: 1,
    paddingTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  productBudget: {
    minHeight: 68,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  managePeople: { gap: spacing.sm },
  managePersonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  suggestions: { gap: spacing.xs },
  suggestionRow: {
    minHeight: 54,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  suggestionMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  disabledSuggestion: { opacity: 0.5 },
  duplicateCard: { gap: spacing.sm },
  duplicateActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
