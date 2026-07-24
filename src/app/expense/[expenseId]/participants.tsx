import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  ChevronRight,
  Minus,
  Plus,
  ReceiptText,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import {
  equalAllocationValues,
  isManualRemainder,
} from '@/domain/manual-expense';
import { repository } from '@/lib/repository';
import type { ExpenseItem, Participant } from '@/lib/models';
import { useAppColors } from '@/providers/app-providers';
import { useI18n } from '@/i18n';
import { radii, spacing } from '@/theme';
import { ThreeDIcon } from '@/components/three-d-icon';
import { productThreeDAsset } from '@/lib/product-visual';

type AllocationMode = 'all' | 'all_except' | 'one' | 'equal' | 'units' | 'custom' | 'percentage';

const modeLabels: Record<AllocationMode, string> = {
  all: 'Todos',
  all_except: 'Todos menos una persona',
  one: 'Una persona',
  equal: 'Partes iguales',
  units: 'Por unidades',
  custom: 'Importes personalizados',
  percentage: 'Por porcentaje',
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
  const palette = useAppColors();
  const cache = useQueryClient();
  const { formatMoney } = useI18n();
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
  const detail = query.data;
  const refresh = () => cache.invalidateQueries({ queryKey: ['expense', expenseId] });
  const add = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2) throw new Error('Escribe un nombre válido.');
      const participant = await repository.addParticipant(
        expenseId,
        { displayName: name.trim() },
        detail?.participants.length ?? 0,
      );
      const participantIds = [
        ...(detail?.participants.map((person) => person.id) ?? []),
        participant.id,
      ];
      for (const item of detail?.items ?? []) {
        const current = detail?.allocations.filter(
          (allocation) => allocation.item_id === item.id,
        );
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
      setAddingParticipant(false);
      await refresh();
    },
    onError: (cause) =>
      setParticipantError(cause instanceof Error ? cause.message : 'No se ha podido añadir.'),
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
  const addProduct = useMutation({
    mutationFn: async () => {
      if (!detail) throw new Error('No hemos podido cargar el gasto.');
      const parsedQuantity = Number(productQuantity.replace(',', '.'));
      if (
        productName.trim().length < 2 ||
        productAmount <= 0 ||
        !/^\d{1,4}(?:[.,]\d{1,3})?$/u.test(productQuantity) ||
        !Number.isFinite(parsedQuantity) ||
        parsedQuantity <= 0
      )
        throw new Error('Escribe un producto, una cantidad y un importe válidos.');

      const remainder = detail.items.find((item) => isManualRemainder(item.category));
      const detailedTotal = sumCents(
        detail.items
          .filter((item) => !isManualRemainder(item.category))
          .map((item) => item.line_total_cents),
      );
      const available = remainder?.line_total_cents ?? detail.total_cents - detailedTotal;
      if (productAmount > available)
        throw new Error(
          `Solo quedan ${formatMoney(Math.max(0, available), detail.currency)} sin detallar.`,
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
      setProductError(
        cause instanceof Error ? cause.message : 'No se ha podido añadir el producto.',
      ),
  });

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
        <ErrorState
          body="No hemos podido cargar los participantes."
          onRetry={() => void query.refetch()}
        />
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
        if (selected.length !== 1) throw new Error('Elige una persona.');
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
      setAllocationError(
        cause instanceof Error ? cause.message : 'No se ha podido guardar el reparto.',
      );
    } finally {
      setSavingSplit(false);
    }
  };

  const suggestAllocations = async () => {
    if (detail.participants.length < 2) {
      setFeedback('Añade al menos una persona antes de sugerir un reparto.');
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
      setFeedback('Todo el gasto vuelve a estar repartido a partes iguales.');
      await refresh();
    } catch {
      setFeedback('No hemos podido sugerir el reparto.');
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
  const debtors = detail.participants.filter(
    (participant) => !participant.is_payer && (totalsByParticipant.get(participant.id) ?? 0) > 0,
  );
  const totalToCollect = sumCents(
    debtors.map((participant) => totalsByParticipant.get(participant.id) ?? 0),
  );
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
      return !allocations.length || allocations.every((allocation) => allocation.method === 'equal');
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
          title="Repartir productos"
          action={
            <AppButton
              title="Igualar"
              accessibilityLabel="Repartir todo a partes iguales"
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
                {participant.is_payer ? 'Tú' : participant.display_name}
              </AppText>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Añadir persona"
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
              Añadir
            </AppText>
          </Pressable>
        </ScrollView>

        {detail.participants.length >= 2 ? (
          <Card variant="flat" style={[styles.equalBanner, { backgroundColor: palette.primaryLight }]}>
            <View style={[styles.equalBannerIcon, { backgroundColor: palette.surface }]}>
              <Sparkles color={palette.primary} size={19} />
            </View>
            <View style={styles.flex}>
              <AppText variant="label">Reparto igual preparado</AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                Cada producto empieza dividido entre todos. Tócalo para cambiar quién paga.
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
            title="Añade al menos una persona"
            body="Incluye a quien debe devolverte una parte."
            action={<AppButton title="Añadir persona" onPress={() => setAddingParticipant(true)} />}
          />
        ) : (
          <>
            <View style={styles.productsHeading}>
              <View style={styles.flex}>
                <AppText variant="sectionTitle">Detalle del gasto</AppText>
                <AppText variant="bodySmall" color={palette.textSecondary}>
                  {availableToDetail > 0
                    ? `${formatMoney(availableToDetail, detail.currency)} todavía sin detallar`
                    : 'Todo el gasto está detallado'}
                </AppText>
              </View>
              {availableToDetail > 0 ? (
                <AppButton
                  title="Añadir producto"
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
                    ? 'Asignar'
                    : itemAllocations.length === 1
                      ? (detail.participants.find(
                          (participant) => participant.id === itemAllocations[0]?.participant_id,
                        )?.display_name ?? 'Asignado')
                      : `Compartido · ${itemAllocations.length}`;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${isRemainder ? 'Resto sin detallar' : item.name}: ${allocationLabel}. Cambiar reparto`}
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
                        {isRemainder ? 'Reparto general' : item.name}
                      </AppText>
                      <AppText variant="bodySmall" color={palette.textSecondary}>
                        {isRemainder
                          ? `${formatMoney(item.line_total_cents, detail.currency)} sin productos`
                          : formatMoney(item.line_total_cents, detail.currency)}
                      </AppText>
                      {!itemAllocations.length ? (
                        <AppText variant="caption" color={palette.danger}>
                          Producto sin asignar
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
                        {itemAllocations.length > 1 ? 'Compartido' : allocationLabel}
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
          <Card style={styles.summaryCard}>
            <AppText variant="sectionTitle">Resumen de cobros</AppText>
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
                      {formatMoney(totalsByParticipant.get(participant.id) ?? 0, detail.currency)}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : (
              <AppText variant="bodySmall" color={palette.textSecondary}>
                Asigna los productos para calcular cuánto debe cada persona.
              </AppText>
            )}
            <View style={[styles.summaryTotal, { borderTopColor: palette.divider }]}>
              <AppText variant="label">Total a cobrar</AppText>
              <AppText variant="metric">{formatMoney(totalToCollect, detail.currency)}</AppText>
            </View>
          </Card>
        ) : null}
        <AppButton
          testID="review-expense"
          title="Enviar cobros"
          variant="success"
          size="lg"
          fullWidth
          leftIcon={<Send color={palette.white} size={21} />}
          disabled={detail.participants.length < 2 || !allocationsValid || totalToCollect <= 0}
          onPress={() => router.push(`/expense/${expenseId}/review`)}
        />
      </ScreenContainer>
      <BottomSheet
        visible={addingProduct}
        onClose={() => {
          setAddingProduct(false);
          setProductError(undefined);
        }}
        title="Añadir producto"
      >
        <View style={[styles.productBudget, { backgroundColor: palette.primaryLight }]}>
          <AppText variant="bodySmall" color={palette.textSecondary}>
            Importe disponible
          </AppText>
          <AppText variant="metric" color={palette.primary}>
            {formatMoney(Math.max(0, availableToDetail), detail.currency)}
          </AppText>
        </View>
        <AppInput
          testID="split-item-name"
          label="Producto"
          placeholder="Pizza"
          value={productName}
          onChangeText={setProductName}
        />
        <AppInput
          label="Cantidad"
          keyboardType="decimal-pad"
          value={productQuantity}
          onChangeText={(value) =>
            setProductQuantity(value.replace(/[^\d.,]/gu, '').slice(0, 8))
          }
          hint="Unidades o cantidad con hasta tres decimales"
        />
        <MoneyInput
          testID="split-item-amount"
          label="Importe total"
          valueCents={productAmount}
          onChangeCents={setProductAmount}
          currency={detail.currency}
        />
        <AppText variant="caption" color={palette.textSecondary}>
          Lo repartiremos por igual. Después puedes tocar el producto para cambiar la asignación.
        </AppText>
        {productError ? <AppText color={palette.danger}>{productError}</AppText> : null}
        <AppButton
          testID="split-add-item"
          title="Añadir y repartir"
          loading={addProduct.isPending}
          leftIcon={<Plus color={palette.white} size={19} />}
          onPress={() => addProduct.mutate()}
        />
      </BottomSheet>
      <BottomSheet
        visible={addingParticipant || detail.participants.length < 2}
        onClose={() => setAddingParticipant(false)}
        title="Añadir participante"
      >
        <AppText variant="bodySmall" color={palette.textSecondary}>
          No necesita una cuenta. Bastará con su nombre.
        </AppText>
        <AppInput
          testID="participant-name"
          label="Nombre de la persona"
          placeholder="Ferran"
          value={name}
          onChangeText={setName}
          error={participantError}
        />
        <AppButton
          testID="add-participant"
          title="Añadir persona"
          loading={add.isPending}
          onPress={() => add.mutate()}
        />
        {detail.participants.some((participant) => !participant.is_payer) ? (
          <View style={styles.managePeople}>
            <AppText variant="label">Participantes añadidos</AppText>
            {detail.participants
              .filter((participant) => !participant.is_payer)
              .map((participant) => (
                <View key={participant.id} style={styles.managePersonRow}>
                  <Avatar name={participant.display_name} size={34} />
                  <AppText variant="bodySmall" style={styles.flex}>
                    {participant.display_name}
                  </AppText>
                  <IconButton
                    label={`Eliminar ${participant.display_name}`}
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
        title={editingItem ? `Repartir ${editingItem.name}` : 'Repartir producto'}
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
            <AppText>Elige a quién excluir:</AppText>
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
                label={`Unidades de ${participant.display_name}`}
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
                label={`Porcentaje de ${participant.display_name}`}
                keyboardType="decimal-pad"
                value={percentages[participant.id] ?? ''}
                onChangeText={(value) =>
                  setPercentages((current) => ({
                    ...current,
                    [participant.id]: value.replace(/[^\d,.]/g, ''),
                  }))
                }
                hint="La suma debe ser exactamente 100 %"
              />
            ))
          : null}
        {allocationError ? <AppText color={palette.danger}>{allocationError}</AppText> : null}
        <AppButton
          title="Aplicar reparto"
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
