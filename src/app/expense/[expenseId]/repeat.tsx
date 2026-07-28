import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check, Pencil, Repeat2, Trash2, Users } from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppButton,
  AppText,
  Avatar,
  BottomSheet,
  Card,
  CurrencyAmount,
  ErrorState,
  IconButton,
  MoneyInput,
  ScreenContainer,
} from '@/components/ui';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { ScreenLoadingSkeleton } from '@/components/loading-skeletons';
import { RepeatAllocationError, rescaleRepeatedAllocations } from '@/domain/repeat-expense';
import { readableError } from '@/lib/api-error';
import type { ExpenseItem } from '@/lib/models';
import { repository } from '@/lib/repository';
import { repeatExpenseRepository } from '@/lib/repeat-expense';
import { useAppColors } from '@/providers/app-providers';
import { useI18n } from '@/i18n';
import { radii, spacing } from '@/theme';

export default function RepeatExpenseReviewScreen() {
  return (
    <RequireAuth>
      <RepeatExpenseReviewContent />
    </RequireAuth>
  );
}

function RepeatExpenseReviewContent() {
  const { expenseId } = useLocalSearchParams<{ expenseId: string }>();
  const router = useRouter();
  const palette = useAppColors();
  const { t } = useI18n();
  const cache = useQueryClient();
  const [editingItem, setEditingItem] = useState<ExpenseItem>();
  const [deletingItem, setDeletingItem] = useState<ExpenseItem>();
  const [amountCents, setAmountCents] = useState(0);
  const [error, setError] = useState<string>();
  const query = useQuery({
    queryKey: ['expense', expenseId],
    queryFn: () => repository.expense(expenseId),
  });
  const detail = query.data;
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
  const refresh = () => cache.invalidateQueries({ queryKey: ['expense', expenseId] });

  const updatePrice = useMutation({
    mutationFn: async () => {
      if (!editingItem) throw new Error(t('repeat.chooseProductError'));
      if (amountCents === 0) throw new Error(t('repeat.zeroError'));
      if (
        (editingItem.source === 'adjustment' && amountCents > 0) ||
        (editingItem.source !== 'adjustment' && amountCents < 0)
      )
        throw new Error(
          editingItem.source === 'adjustment'
            ? t('repeat.adjustmentSignError')
            : t('repeat.productSignError'),
        );
      let allocations;
      try {
        allocations = rescaleRepeatedAllocations(
          amountCents,
          allocationsByItem.get(editingItem.id) ?? [],
        );
      } catch (cause) {
        if (cause instanceof RepeatAllocationError) {
          const key = {
            REPEAT_AMOUNT_ZERO: 'repeat.zeroError',
            REPEAT_ALLOCATION_MISSING: 'repeat.allocationMissingError',
            REPEAT_ALLOCATION_SIGN: 'repeat.allocationSignError',
            REPEAT_ALLOCATION_ZERO: 'repeat.allocationZeroError',
          } as const;
          throw new Error(t(key[cause.code]));
        }
        throw cause;
      }
      return repeatExpenseRepository.updateItemAmount({
        expenseId,
        itemId: editingItem.id,
        lineTotalCents: amountCents,
        allocations,
      });
    },
    onSuccess: async () => {
      setEditingItem(undefined);
      setError(undefined);
      await refresh();
    },
    onError: (cause) =>
      setError(
        readableError(cause).code === 'UNKNOWN'
          ? readableError(cause).message
          : t('repeat.repeatedItemUpdateError'),
      ),
  });

  const removeItem = useMutation({
    mutationFn: async () => {
      if (!deletingItem) throw new Error(t('repeat.chooseProductError'));
      return repeatExpenseRepository.deleteItem(expenseId, deletingItem.id);
    },
    onSuccess: async () => {
      setDeletingItem(undefined);
      setError(undefined);
      await refresh();
    },
    onError: () => setError(t('repeat.repeatedItemDeleteError')),
  });

  if (query.isPending && !detail) return <ScreenLoadingSkeleton variant="items" />;
  if (query.isError || !detail)
    return (
      <ScreenContainer>
        <ErrorState body={t('repeat.loadReviewError')} onRetry={() => void query.refetch()} />
      </ScreenContainer>
    );

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      <ScreenContainer contentContainerStyle={styles.content}>
        <PageHeader title={t('repeat.reviewTitle')} />

        <Card style={styles.templateCard}>
          <View style={[styles.templateIcon, { backgroundColor: palette.primaryLight }]}>
            <Repeat2 color={palette.primary} size={24} />
          </View>
          <View style={styles.flex}>
            <AppText variant="heading">{detail.title}</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {detail.merchant_name || t('repeat.noMerchant')}
            </AppText>
          </View>
          <CurrencyAmount
            cents={detail.total_cents}
            currency={detail.currency}
            variant="heading"
            color={palette.primary}
          />
          <View style={[styles.copiedNotice, { backgroundColor: palette.successLight }]}>
            <Check color={palette.successInk} size={18} />
            <AppText variant="bodySmall" color={palette.successInk} style={styles.flex}>
              {t('repeat.copiedNotice')}
            </AppText>
          </View>
        </Card>

        <View style={styles.peopleHeading}>
          <View style={styles.peopleTitle}>
            <Users color={palette.textSecondary} size={19} />
            <AppText variant="sectionTitle">{t('repeat.samePeople')}</AppText>
          </View>
          <AppText variant="bodySmall" color={palette.textSecondary}>
            {detail.participants.length}
          </AppText>
        </View>
        <View style={styles.people}>
          {detail.participants.map((participant) => (
            <View key={participant.id} style={styles.person}>
              <Avatar name={participant.display_name} uri={participant.avatar_path} size={42} />
              <AppText variant="caption" numberOfLines={1} style={styles.personName}>
                {participant.is_payer ? t('common.you') : participant.display_name}
              </AppText>
            </View>
          ))}
        </View>

        <View style={styles.sectionHeading}>
          <View style={styles.flex}>
            <AppText variant="sectionTitle">{t('repeat.productsTitle')}</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {t('repeat.productsBody')}
            </AppText>
          </View>
        </View>

        <Card variant="grouped" padding="none">
          {detail.items.map((item, index) => (
            <View key={item.id}>
              <View style={styles.itemRow}>
                <View
                  style={[
                    styles.itemBadge,
                    {
                      backgroundColor:
                        item.source === 'adjustment' ? palette.warningLight : palette.primaryLight,
                    },
                  ]}
                >
                  <AppText
                    variant="label"
                    color={item.source === 'adjustment' ? palette.warningInk : palette.primary}
                  >
                    {item.source === 'adjustment' ? '−' : item.name.slice(0, 1).toUpperCase()}
                  </AppText>
                </View>
                <View style={styles.flex}>
                  <AppText variant="label">{item.name}</AppText>
                  <AppText variant="caption" color={palette.textSecondary}>
                    {t(
                      (allocationsByItem.get(item.id)?.length ?? 0) === 1
                        ? 'repeat.assignedOne'
                        : 'repeat.assignedMany',
                      { count: allocationsByItem.get(item.id)?.length ?? 0 },
                    )}
                  </AppText>
                </View>
                <CurrencyAmount
                  cents={item.line_total_cents}
                  currency={detail.currency}
                  variant="label"
                />
                <IconButton
                  label={`${t('common.edit')}: ${item.name}`}
                  variant="plain"
                  icon={<Pencil color={palette.primary} size={18} />}
                  onPress={() => {
                    setError(undefined);
                    setEditingItem(item);
                    setAmountCents(item.line_total_cents);
                  }}
                />
                <IconButton
                  label={`${t('common.delete')}: ${item.name}`}
                  variant="plain"
                  disabled={detail.items.length <= 1}
                  icon={<Trash2 color={palette.danger} size={18} />}
                  onPress={() => {
                    setError(undefined);
                    setDeletingItem(item);
                  }}
                />
              </View>
              {index < detail.items.length - 1 ? (
                <View style={[styles.divider, { backgroundColor: palette.divider }]} />
              ) : null}
            </View>
          ))}
        </Card>

        {detail.items.length === 1 ? (
          <AppText variant="caption" color={palette.textSecondary} style={styles.centerText}>
            {t('repeat.keepOneItem')}
          </AppText>
        ) : null}
        {error ? <AppText color={palette.dangerInk}>{error}</AppText> : null}
        <AppButton
          title={t('repeat.continueSplit')}
          size="lg"
          fullWidth
          disabled={updatePrice.isPending || removeItem.isPending}
          onPress={() => router.replace(`/expense/${expenseId}/participants`)}
        />
        <AppText variant="caption" color={palette.textSecondary} style={styles.centerText}>
          {t('repeat.continueFootnote')}
        </AppText>
      </ScreenContainer>

      <BottomSheet
        visible={Boolean(editingItem)}
        onClose={() => {
          setEditingItem(undefined);
          setError(undefined);
        }}
        title={
          editingItem
            ? t('repeat.priceTitle', { name: editingItem.name })
            : t('repeat.priceFallbackTitle')
        }
      >
        <MoneyInput
          label={t('repeat.amount')}
          valueCents={amountCents}
          onChangeCents={setAmountCents}
          currency={detail.currency}
          allowNegative={editingItem?.source === 'adjustment'}
          autoFocus
        />
        {error ? <AppText color={palette.dangerInk}>{error}</AppText> : null}
        <AppButton
          title={t('repeat.savePrice')}
          loading={updatePrice.isPending}
          onPress={() => updatePrice.mutate()}
        />
      </BottomSheet>

      <BottomSheet
        visible={Boolean(deletingItem)}
        onClose={() => {
          setDeletingItem(undefined);
          setError(undefined);
        }}
        title={t('repeat.deleteTitle')}
      >
        <AppText color={palette.textSecondary}>
          {deletingItem ? t('repeat.deleteBody', { name: deletingItem.name }) : ''}
        </AppText>
        {error ? <AppText color={palette.dangerInk}>{error}</AppText> : null}
        <AppButton
          title={t('common.delete')}
          variant="danger"
          loading={removeItem.isPending}
          onPress={() => removeItem.mutate()}
        />
        <AppButton
          title={t('common.cancel')}
          variant="ghost"
          disabled={removeItem.isPending}
          onPress={() => setDeletingItem(undefined)}
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { gap: spacing.lg },
  flex: { flex: 1, minWidth: 0 },
  templateCard: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md },
  templateIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copiedNotice: {
    width: '100%',
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  peopleHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  peopleTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  person: { width: 62, alignItems: 'center', gap: spacing.xs },
  personName: { width: '100%', textAlign: 'center' },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  itemRow: {
    minHeight: 76,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  itemBadge: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 64 },
  centerText: { textAlign: 'center' },
});
