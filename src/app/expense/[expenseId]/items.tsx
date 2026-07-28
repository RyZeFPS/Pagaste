import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  ScanLine,
  Trash2,
} from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppButton,
  AppInput,
  AppText,
  Card,
  CurrencyAmount,
  ErrorState,
  IconButton,
  LoadingSkeleton,
  MoneyInput,
  ScreenContainer,
} from '@/components/ui';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { ScreenLoadingSkeleton } from '@/components/loading-skeletons';
import { repository } from '@/lib/repository';
import { useAppColors } from '@/providers/app-providers';
import { useI18n } from '@/i18n';
import { radii, spacing } from '@/theme';
import { sumCents } from '@/domain/money';
import { receiptLineReviewState, reconcileReceiptAmounts } from '@/domain/ocr';
import { expenseReceiptSources, groupItemsByReceipt } from '@/domain/expense-receipts';
import type { ExpenseItem } from '@/lib/models';
import { ThreeDIcon } from '@/components/three-d-icon';
import { productThreeDAsset } from '@/lib/product-visual';

type Translate = ReturnType<typeof useI18n>['t'];

function scanWarningMessage(warning: string, t: Translate): string {
  const lowConfidence = /^low_confidence_lines:(\d+)$/u.exec(warning);
  if (lowConfidence) {
    const count = Number(lowConfidence[1]);
    return t(count === 1 ? 'items.warningLowConfidenceOne' : 'items.warningLowConfidenceMany', {
      count,
    });
  }
  const messages: Record<string, Parameters<Translate>[0]> = {
    image_low_resolution: 'items.warningLowResolution',
    image_unusual_aspect_ratio: 'items.warningAspectRatio',
    image_too_dark: 'items.warningDark',
    image_overexposed: 'items.warningOverexposed',
    image_low_contrast: 'items.warningLowContrast',
    image_blurry: 'items.warningBlurry',
    products_not_detected: 'items.warningProductsNotDetected',
    rounding_adjusted: 'items.warningRoundingAdjusted',
    items_do_not_match_total: 'items.warningItemsDoNotMatchTotal',
    items_do_not_match_subtotal: 'items.warningItemsDoNotMatchSubtotal',
    items_total_out_of_range: 'items.warningItemsTotalOutOfRange',
    total_label_not_found: 'items.warningTotalLabelNotFound',
    total_inferred: 'items.warningTotalInferred',
    page_low_confidence: 'items.warningPageLowConfidence',
    review_before_split: 'items.warningReviewBeforeSplit',
  };
  const key = messages[warning];
  return key ? t(key) : warning;
}

export default function ItemsScreen() {
  return (
    <RequireAuth>
      <ItemsContent />
    </RequireAuth>
  );
}

function ItemsContent() {
  const { expenseId } = useLocalSearchParams<{ expenseId: string }>();
  const router = useRouter();
  const palette = useAppColors();
  const cache = useQueryClient();
  const { formatMoney, intlLocale, t } = useI18n();
  const query = useQuery({
    queryKey: ['expense', expenseId],
    queryFn: () => repository.expense(expenseId),
  });
  const receiptSources = useMemo(
    () => expenseReceiptSources(query.data?.receipts ?? [], query.data?.receipt_path ?? null),
    [query.data?.receipt_path, query.data?.receipts],
  );
  const receiptUrlQueries = useQueries({
    queries: receiptSources.map((receipt) => ({
      queryKey: ['receipt-url', receipt.storagePath],
      queryFn: () => repository.receiptUrl(receipt.storagePath),
      staleTime: 240_000,
      refetchInterval: 240_000,
    })),
  });
  const scanQuery = useQuery({
    queryKey: ['receipt-scan', expenseId],
    enabled: receiptSources.length > 0,
    queryFn: () => repository.latestReceiptScan(expenseId),
  });
  const [selectedReceiptId, setSelectedReceiptId] = useState<string>();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState(0);
  const [quantity, setQuantity] = useState('1');
  const [editingId, setEditingId] = useState<string>();
  const [editingMode, setEditingMode] = useState(false);
  const [isAdjustment, setIsAdjustment] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ['expense', expenseId] });
  };

  const resetEditor = () => {
    setName('');
    setAmount(0);
    setQuantity('1');
    setEditingId(undefined);
    setIsAdjustment(false);
    setError(undefined);
  };

  const save = useMutation({
    mutationFn: async () => {
      const parsedQuantity = Number(quantity.replace(',', '.'));
      if (name.trim().length < 2 || (!isAdjustment && amount <= 0) || (isAdjustment && amount >= 0))
        throw new Error(
          isAdjustment ? t('items.discountMustBeNegative') : t('items.validProductAmount'),
        );
      if (
        !isAdjustment &&
        (!/^\d{1,4}(?:[.,]\d{1,3})?$/u.test(quantity) ||
          !Number.isFinite(parsedQuantity) ||
          parsedQuantity <= 0)
      )
        throw new Error(t('items.validQuantity'));

      const savedQuantity = isAdjustment ? 1 : parsedQuantity;
      const unitPriceCents =
        Number.isSafeInteger(savedQuantity) && amount % savedQuantity === 0
          ? amount / savedQuantity
          : null;
      if (editingId) {
        const originalItem = query.data?.items.find((item) => item.id === editingId);
        if (
          originalItem?.source === 'ocr' &&
          originalItem.name.trim().toLocaleLowerCase() !== name.trim().toLocaleLowerCase()
        ) {
          await repository.submitAnonymousOcrCorrection(editingId, name.trim()).catch(() => false);
        }
        await repository.updateItem(editingId, {
          name: name.trim(),
          quantity: savedQuantity,
          unit_price_cents: unitPriceCents,
          line_total_cents: amount,
          ocr_confidence: null,
          source: isAdjustment ? 'adjustment' : 'manual',
        });
      } else
        await repository.addItem(
          expenseId,
          {
            name: name.trim(),
            lineTotalCents: amount,
            quantity: savedQuantity,
            source: isAdjustment ? 'adjustment' : 'manual',
          },
          query.data?.items.length ?? 0,
        );
    },
    onSuccess: async () => {
      resetEditor();
      await refresh();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : t('items.saveError')),
  });

  const itemTotal = useMemo(
    () => sumCents((query.data?.items ?? []).map((item) => item.line_total_cents)),
    [query.data?.items],
  );
  const receiptItemGroups = useMemo(
    () => groupItemsByReceipt(query.data?.items ?? [], receiptSources),
    [query.data?.items, receiptSources],
  );
  const reconciliation = useMemo(
    () =>
      reconcileReceiptAmounts(
        (query.data?.items ?? []).map((item) => ({
          name: item.name,
          lineTotalCents: item.line_total_cents,
          category: item.category,
        })),
        query.data?.total_cents ?? 0,
      ),
    [query.data?.items, query.data?.total_cents],
  );
  const scanWarnings = useMemo(
    () =>
      (scanQuery.data?.warnings ?? [])
        .filter((warning): warning is string => typeof warning === 'string')
        .map((warning) => scanWarningMessage(warning, t))
        .filter((warning, index, warnings) => warnings.indexOf(warning) === index),
    [scanQuery.data?.warnings, t],
  );
  const quickFix = useMutation({
    mutationFn: async (
      action:
        | { type: 'add-common'; amountCents: number }
        | { type: 'correct-total'; totalCents: number }
        | { type: 'delete-duplicate'; itemId: string },
    ) => {
      if (action.type === 'add-common') {
        await repository.addItem(
          expenseId,
          {
            name: t('items.commonExpenseDefault'),
            lineTotalCents: action.amountCents,
            source: 'manual',
            category: 'common',
          },
          query.data?.items.length ?? 0,
        );
        return;
      }
      if (action.type === 'correct-total') {
        await repository.updateExpense(expenseId, {
          total_cents: action.totalCents,
          own_share_cents: action.totalCents,
        });
        return;
      }
      await repository.deleteItem(action.itemId);
    },
    onSuccess: async () => {
      setError(undefined);
      await refresh();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : t('items.quickFixError')),
  });

  if (query.isPending && !query.data) return <ScreenLoadingSkeleton variant="items" />;
  if (query.isError || !query.data)
    return (
      <ScreenContainer>
        <ErrorState body={t('items.loadError')} onRetry={() => void query.refetch()} />
      </ScreenContainer>
    );

  const difference = reconciliation.differenceCents;
  const duplicateItem = query.data.items[reconciliation.duplicateIndexes[0] ?? -1];
  const lowConfidenceItems = query.data.items.filter(
    (item) => receiptLineReviewState(item.ocr_confidence) === 'review',
  ).length;
  const scanConfidence = scanQuery.data?.confidence;
  const scanNeedsReview =
    lowConfidenceItems > 0 ||
    (scanConfidence !== null && scanConfidence !== undefined && scanConfidence < 0.78);
  const selectedReceiptIndex = Math.max(
    0,
    receiptSources.findIndex((receipt) => receipt.id === selectedReceiptId),
  );
  const selectedReceiptQuery = receiptUrlQueries[selectedReceiptIndex];
  const hasReceipt = receiptSources.length > 0;
  const canContinue =
    query.data.items.length > 0 && (difference === 0 || query.data.total_cents === 0);
  const showEditor = editingMode || !hasReceipt || query.data.items.length === 0;
  const receiptTotal = query.data.total_cents || itemTotal;

  const startEditing = (item: ExpenseItem) => {
    setEditingMode(true);
    setEditingId(item.id);
    setName(item.name);
    setAmount(item.line_total_cents);
    setQuantity(String(item.quantity).replace('.', ','));
    setIsAdjustment(item.source === 'adjustment');
  };

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      <ScreenContainer contentContainerStyle={styles.screenContent}>
        <PageHeader
          title={hasReceipt ? t('items.scannedTitle') : t('items.manualTitle')}
          action={
            query.data.items.length ? (
              <AppButton
                title={editingMode ? t('common.done') : t('common.edit')}
                variant="ghost"
                size="sm"
                onPress={() => {
                  if (editingMode) resetEditor();
                  setEditingMode((current) => !current);
                }}
              />
            ) : undefined
          }
        />

        {hasReceipt ? (
          <>
            {receiptSources.length > 1 ? (
              <View style={styles.receiptSelectorSection}>
                <View style={styles.receiptSelectorHeading}>
                  <AppText variant="heading">
                    {t(
                      receiptSources.length === 1
                        ? 'items.receiptCountOne'
                        : 'items.receiptCountMany',
                      { count: receiptSources.length },
                    )}
                  </AppText>
                  <AppText variant="bodySmall" color={palette.textSecondary}>
                    {t('items.receiptSelectorHint')}
                  </AppText>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.receiptSelector}
                  accessibilityRole="tablist"
                >
                  {receiptSources.map((receipt, index) => {
                    const selected = index === selectedReceiptIndex;
                    return (
                      <Pressable
                        key={receipt.id}
                        accessibilityRole="tab"
                        accessibilityLabel={t('items.receiptSelectorA11y', {
                          index: index + 1,
                          count: receiptSources.length,
                        })}
                        accessibilityState={{ selected }}
                        onPress={() => setSelectedReceiptId(receipt.id)}
                        style={({ pressed }) => [
                          styles.receiptSelectorItem,
                          {
                            backgroundColor: selected ? palette.primaryLight : palette.surface,
                            borderColor: selected ? palette.primary : palette.border,
                          },
                          pressed && styles.receiptSelectorPressed,
                        ]}
                      >
                        <View
                          style={[
                            styles.receiptSelectorIcon,
                            {
                              backgroundColor: selected ? palette.primary : palette.background,
                            },
                          ]}
                        >
                          <ScanLine
                            color={selected ? palette.white : palette.textSecondary}
                            size={18}
                          />
                        </View>
                        <View style={styles.receiptSelectorCopy}>
                          <AppText
                            variant="label"
                            color={selected ? palette.primary : palette.textPrimary}
                          >
                            {t('items.receiptLabel', { index: index + 1 })}
                          </AppText>
                          <AppText
                            variant="caption"
                            color={palette.textSecondary}
                            numberOfLines={1}
                          >
                            {receipt.merchantName ||
                              receipt.originalName ||
                              t('items.receiptPrivateLabel')}
                          </AppText>
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}
            <View style={[styles.receiptFrame, { backgroundColor: palette.surface }]}>
              {selectedReceiptQuery?.isLoading ? (
                <LoadingSkeleton height={420} />
              ) : selectedReceiptQuery?.data ? (
                <Image
                  source={{ uri: selectedReceiptQuery.data }}
                  style={styles.receipt}
                  contentFit="contain"
                  accessibilityLabel={
                    receiptSources.length > 1
                      ? t('items.receiptPhotoNumberA11y', {
                          index: selectedReceiptIndex + 1,
                          count: receiptSources.length,
                        })
                      : t('items.receiptPhotoA11y')
                  }
                />
              ) : (
                <View style={[styles.receiptFallback, { backgroundColor: palette.surface }]}>
                  <ScanLine color={palette.textMuted} size={42} />
                  <AppText color={palette.textSecondary} style={styles.centerText}>
                    {t('items.privatePreviewError')}
                  </AppText>
                  <AppButton
                    title={t('common.retry')}
                    variant="outline"
                    onPress={() => void selectedReceiptQuery?.refetch()}
                  />
                </View>
              )}
              <View style={[styles.scanCorner, styles.topLeft, { borderColor: palette.primary }]} />
              <View
                style={[styles.scanCorner, styles.topRight, { borderColor: palette.primary }]}
              />
              <View
                style={[styles.scanCorner, styles.bottomLeft, { borderColor: palette.primary }]}
              />
              <View
                style={[styles.scanCorner, styles.bottomRight, { borderColor: palette.primary }]}
              />
            </View>
          </>
        ) : (
          <Card variant="outlined" style={styles.manualTicket}>
            <View style={[styles.manualIcon, { backgroundColor: palette.primaryLight }]}>
              <ScanLine color={palette.primary} size={26} />
            </View>
            <View style={styles.flex}>
              <AppText variant="heading">{t('items.manualExpense')}</AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                {t('items.manualBody')}
              </AppText>
            </View>
          </Card>
        )}

        {hasReceipt ? (
          <>
            <View style={styles.ocrStatus}>
              <View
                style={[
                  styles.ocrChip,
                  {
                    backgroundColor: scanNeedsReview ? palette.warningLight : palette.successLight,
                  },
                ]}
              >
                {scanNeedsReview ? (
                  <AlertTriangle color={palette.warningInk} size={14} strokeWidth={2.5} />
                ) : (
                  <Check color={palette.successInk} size={14} strokeWidth={2.5} />
                )}
                <AppText
                  variant="caption"
                  color={scanNeedsReview ? palette.warningInk : palette.successInk}
                >
                  {typeof scanConfidence === 'number'
                    ? t('items.readingPercent', {
                        percent: Math.round(scanConfidence * 100),
                      })
                    : 'OCR'}
                </AppText>
              </View>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                {scanQuery.isLoading
                  ? t('items.readingItems')
                  : lowConfidenceItems
                    ? t(lowConfidenceItems === 1 ? 'items.reviewLineOne' : 'items.reviewLineMany', {
                        count: lowConfidenceItems,
                      })
                    : t('items.detectedProducts')}
              </AppText>
            </View>
            {scanWarnings.length ? (
              <Card
                variant="flat"
                style={[styles.warningCard, { backgroundColor: palette.warningLight }]}
              >
                <AlertTriangle color={palette.warningInk} size={20} />
                <View style={styles.warningList}>
                  {scanWarnings.map((warning) => (
                    <AppText key={warning} variant="bodySmall" color={palette.warningInk}>
                      {warning}
                    </AppText>
                  ))}
                </View>
              </Card>
            ) : null}
          </>
        ) : null}

        {query.data.items.length ? (
          <Card variant="grouped" style={styles.productCard}>
            <View style={styles.totalRow}>
              <AppText variant="heading">{t('expense.total')}</AppText>
              <CurrencyAmount
                cents={receiptTotal}
                currency={query.data.currency}
                variant="metric"
                color={palette.primary}
              />
            </View>
            <View style={[styles.divider, { backgroundColor: palette.divider }]} />
            {receiptItemGroups.map((group, groupIndex) => {
              const showSourceHeader =
                receiptSources.length > 1 || (hasReceipt && group.receipt === null);
              const groupSelected =
                group.receipt !== null &&
                group.receipt.id === receiptSources[selectedReceiptIndex]?.id;

              return (
                <View key={group.key}>
                  {showSourceHeader ? (
                    <Pressable
                      accessibilityRole={group.receipt ? 'button' : undefined}
                      accessibilityLabel={
                        group.receipt && group.receiptIndex !== null
                          ? t('items.showReceiptLinesA11y', {
                              index: group.receiptIndex + 1,
                            })
                          : t('items.manualLinesBody')
                      }
                      accessibilityState={group.receipt ? { selected: groupSelected } : undefined}
                      disabled={!group.receipt}
                      onPress={() => {
                        if (group.receipt) setSelectedReceiptId(group.receipt.id);
                      }}
                      style={[
                        styles.itemSourceHeader,
                        {
                          backgroundColor: groupSelected
                            ? palette.primaryLight
                            : palette.background,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.itemSourceDot,
                          {
                            backgroundColor: group.receipt
                              ? groupSelected
                                ? palette.primary
                                : palette.textMuted
                              : palette.warning,
                          },
                        ]}
                      />
                      <View style={styles.flex}>
                        <AppText
                          variant="label"
                          color={groupSelected ? palette.primary : palette.textPrimary}
                        >
                          {group.receipt && group.receiptIndex !== null
                            ? t('items.receiptLines', { index: group.receiptIndex + 1 })
                            : t('items.manualLines')}
                        </AppText>
                        <AppText variant="caption" color={palette.textSecondary} numberOfLines={1}>
                          {group.receipt
                            ? group.receipt.merchantName ||
                              group.receipt.originalName ||
                              t('items.receiptPrivateLabel')
                            : t('items.manualLinesBody')}
                        </AppText>
                      </View>
                      {group.receipt?.totalCents !== null &&
                      group.receipt?.totalCents !== undefined ? (
                        <CurrencyAmount
                          cents={group.receipt.totalCents}
                          currency={query.data.currency}
                          variant="caption"
                          color={groupSelected ? palette.primary : palette.textSecondary}
                        />
                      ) : null}
                    </Pressable>
                  ) : null}
                  {group.items.map((item, itemIndex) => {
                    const itemAsset = productThreeDAsset(item);
                    const reviewState = receiptLineReviewState(item.ocr_confidence);
                    return (
                      <View key={item.id}>
                        <View style={styles.productRow}>
                          <View
                            style={[
                              styles.productIcon,
                              {
                                backgroundColor:
                                  item.source === 'adjustment'
                                    ? palette.warningLight
                                    : 'transparent',
                              },
                            ]}
                          >
                            {itemAsset ? (
                              <ThreeDIcon name={itemAsset} size={40} />
                            ) : (
                              <Minus color={palette.warningInk} size={20} strokeWidth={2.2} />
                            )}
                          </View>
                          <View style={styles.flex}>
                            <AppText variant="label">{item.name}</AppText>
                            <View style={styles.itemMetadata}>
                              <AppText variant="bodySmall" color={palette.textSecondary}>
                                {item.source === 'adjustment'
                                  ? t('items.adjustment')
                                  : `${item.quantity.toLocaleString(intlLocale)} ${t(
                                      item.quantity === 1 ? 'items.unitOne' : 'items.unitMany',
                                    )}`}
                              </AppText>
                              {reviewState !== 'unknown' ? (
                                <View
                                  style={[
                                    styles.confidenceBadge,
                                    {
                                      backgroundColor:
                                        reviewState === 'correct'
                                          ? palette.successLight
                                          : palette.warningLight,
                                    },
                                  ]}
                                  accessible
                                  accessibilityLabel={t('items.readingA11y', {
                                    state: t(
                                      reviewState === 'correct'
                                        ? 'items.readingStateCorrect'
                                        : 'items.readingStateReview',
                                    ),
                                    confidence:
                                      typeof item.ocr_confidence === 'number'
                                        ? t('items.confidenceSuffix', {
                                            percent: Math.round(item.ocr_confidence * 100),
                                          })
                                        : '',
                                  })}
                                >
                                  {reviewState === 'correct' ? (
                                    <CheckCircle2 color={palette.successInk} size={13} />
                                  ) : (
                                    <AlertTriangle color={palette.warningInk} size={13} />
                                  )}
                                  <AppText
                                    variant="caption"
                                    color={
                                      reviewState === 'correct'
                                        ? palette.successInk
                                        : palette.warningInk
                                    }
                                  >
                                    {t(
                                      reviewState === 'correct' ? 'items.correct' : 'items.review',
                                    )}
                                  </AppText>
                                </View>
                              ) : null}
                            </View>
                          </View>
                          <CurrencyAmount
                            cents={item.line_total_cents}
                            currency={query.data.currency}
                            variant="label"
                          />
                          {editingMode ? (
                            <View style={styles.rowActions}>
                              <IconButton
                                label={t('items.editA11y', { name: item.name })}
                                variant="plain"
                                icon={<Pencil color={palette.primary} size={18} />}
                                onPress={() => startEditing(item)}
                              />
                              <IconButton
                                label={t('items.deleteA11y', { name: item.name })}
                                variant="plain"
                                icon={<Trash2 color={palette.danger} size={18} />}
                                onPress={async () => {
                                  await repository.deleteItem(item.id);
                                  if (editingId === item.id) resetEditor();
                                  await refresh();
                                }}
                              />
                            </View>
                          ) : null}
                        </View>
                        {itemIndex < group.items.length - 1 ? (
                          <View
                            style={[styles.indentedDivider, { backgroundColor: palette.divider }]}
                          />
                        ) : null}
                      </View>
                    );
                  })}
                  {groupIndex < receiptItemGroups.length - 1 ? (
                    <View style={[styles.groupDivider, { backgroundColor: palette.divider }]} />
                  ) : null}
                </View>
              );
            })}
          </Card>
        ) : null}

        {query.data.items.length ? (
          <Card style={styles.reconciliationCard}>
            <View style={styles.reconciliationHeading}>
              <View style={styles.flex}>
                <AppText variant="heading">{t('items.reconciliationTitle')}</AppText>
                <AppText variant="bodySmall" color={palette.textSecondary}>
                  {t('items.reconciliationBody')}
                </AppText>
              </View>
              {difference === 0 ? (
                <CheckCircle2 color={palette.success} size={24} />
              ) : (
                <AlertTriangle color={palette.warning} size={24} />
              )}
            </View>
            <View style={styles.breakdownRows}>
              <View style={styles.breakdownRow}>
                <AppText color={palette.textSecondary}>
                  {hasReceipt ? t('items.detectedProducts') : t('items.products')}
                </AppText>
                <CurrencyAmount
                  cents={reconciliation.productsCents}
                  currency={query.data.currency}
                  variant="label"
                />
              </View>
              <View style={styles.breakdownRow}>
                <AppText color={palette.textSecondary}>{t('items.discounts')}</AppText>
                <CurrencyAmount
                  cents={reconciliation.discountsCents}
                  currency={query.data.currency}
                  variant="label"
                  color={
                    reconciliation.discountsCents < 0 ? palette.successInk : palette.textSecondary
                  }
                />
              </View>
              <View style={styles.breakdownRow}>
                <AppText color={palette.textSecondary}>{t('items.commonExpenses')}</AppText>
                <CurrencyAmount
                  cents={reconciliation.commonExpensesCents}
                  currency={query.data.currency}
                  variant="label"
                />
              </View>
              <View style={[styles.breakdownDivider, { backgroundColor: palette.divider }]} />
              <View style={styles.breakdownRow}>
                <AppText variant="label">{t('items.receiptTotal')}</AppText>
                <CurrencyAmount
                  cents={query.data.total_cents}
                  currency={query.data.currency}
                  variant="label"
                />
              </View>
              <View style={styles.breakdownRow}>
                <AppText
                  variant="label"
                  color={difference === 0 ? palette.successInk : palette.warningInk}
                >
                  {t('items.pendingDifference')}
                </AppText>
                <CurrencyAmount
                  cents={difference}
                  currency={query.data.currency}
                  variant="label"
                  color={difference === 0 ? palette.successInk : palette.warningInk}
                />
              </View>
            </View>

            {difference !== 0 || duplicateItem ? (
              <View style={styles.quickActions}>
                <AppText variant="label">{t('items.quickSolutions')}</AppText>
                <View style={styles.quickActionButtons}>
                  {difference > 0 ? (
                    <>
                      <AppButton
                        title={t('items.addAsCommon')}
                        size="sm"
                        variant="outline"
                        disabled={quickFix.isPending}
                        loading={quickFix.isPending && quickFix.variables?.type === 'add-common'}
                        onPress={() =>
                          quickFix.mutate({ type: 'add-common', amountCents: difference })
                        }
                      />
                      <AppButton
                        title={t('items.createDifference')}
                        size="sm"
                        variant="secondary"
                        onPress={() => {
                          setEditingMode(true);
                          setEditingId(undefined);
                          setName(t('items.differenceProductDefault'));
                          setAmount(difference);
                          setQuantity('1');
                          setIsAdjustment(false);
                        }}
                      />
                    </>
                  ) : null}
                  {difference < 0 ? (
                    <AppButton
                      title={t('items.reviewAsDiscount')}
                      size="sm"
                      variant="outline"
                      onPress={() => {
                        setEditingMode(true);
                        setEditingId(undefined);
                        setName(t('items.pendingDiscountDefault'));
                        setAmount(difference);
                        setQuantity('1');
                        setIsAdjustment(true);
                      }}
                    />
                  ) : null}
                  {difference !== 0 && itemTotal > 0 ? (
                    <AppButton
                      title={t('items.correctReceiptTotal')}
                      size="sm"
                      variant="secondary"
                      disabled={quickFix.isPending}
                      loading={quickFix.isPending && quickFix.variables?.type === 'correct-total'}
                      onPress={() =>
                        quickFix.mutate({ type: 'correct-total', totalCents: itemTotal })
                      }
                    />
                  ) : null}
                  {duplicateItem ? (
                    <AppButton
                      title={t('items.deleteDuplicate')}
                      accessibilityLabel={t('items.deleteDuplicateA11y', {
                        name: duplicateItem.name,
                      })}
                      size="sm"
                      variant="danger"
                      disabled={quickFix.isPending}
                      loading={
                        quickFix.isPending && quickFix.variables?.type === 'delete-duplicate'
                      }
                      onPress={() =>
                        quickFix.mutate({
                          type: 'delete-duplicate',
                          itemId: duplicateItem.id,
                        })
                      }
                    />
                  ) : null}
                </View>
              </View>
            ) : null}
          </Card>
        ) : null}

        <View style={styles.balanceLine}>
          {!query.data.items.length ? (
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {t('items.needProduct')}
            </AppText>
          ) : difference === 0 ? (
            <>
              <Check color={palette.successInk} size={18} />
              <AppText variant="bodySmall" color={palette.successInk}>
                {t('expense.itemsMatch')}
              </AppText>
            </>
          ) : query.data.total_cents === 0 ? (
            <AppText variant="bodySmall" color={palette.warningInk}>
              {t('items.totalWillBeSet', {
                amount: formatMoney(itemTotal, query.data.currency),
              })}
            </AppText>
          ) : (
            <AppText variant="bodySmall" color={palette.dangerInk}>
              {t('items.missingAdjustment', {
                amount: formatMoney(Math.abs(difference), query.data.currency),
              })}
            </AppText>
          )}
        </View>

        {showEditor ? (
          <Card style={styles.editorCard}>
            <View style={styles.editorHeading}>
              <View style={styles.flex}>
                <AppText variant="heading">
                  {editingId
                    ? t('items.editLine')
                    : isAdjustment
                      ? t('items.addAdjustment')
                      : t('items.addProduct')}
                </AppText>
                <AppText variant="bodySmall" color={palette.textSecondary}>
                  {editingId ? t('items.updateDetected') : t('items.completeReceipt')}
                </AppText>
              </View>
              {!editingId && hasReceipt ? (
                <IconButton
                  label={t('items.rescan')}
                  variant="plain"
                  icon={<RotateCcw color={palette.textSecondary} size={19} />}
                  onPress={() => router.push(`/expense/${expenseId}/scan`)}
                />
              ) : null}
            </View>
            <View style={styles.toggle}>
              <AppButton
                title={t('items.product')}
                size="sm"
                variant={!isAdjustment ? 'primary' : 'outline'}
                onPress={() => {
                  setIsAdjustment(false);
                  if (amount < 0) setAmount(0);
                }}
              />
              <AppButton
                title={t('items.discountAdjustment')}
                size="sm"
                variant={isAdjustment ? 'primary' : 'outline'}
                onPress={() => {
                  setIsAdjustment(true);
                  setQuantity('1');
                  if (amount > 0) setAmount(-amount);
                }}
              />
            </View>
            <AppInput
              testID="item-name"
              label={isAdjustment ? t('items.adjustmentConcept') : t('items.product')}
              placeholder={
                isAdjustment ? t('items.discountPlaceholder') : t('expense.itemPlaceholder')
              }
              value={name}
              onChangeText={setName}
            />
            {!isAdjustment ? (
              <AppInput
                label={t('items.quantity')}
                value={quantity}
                onChangeText={(value) => setQuantity(value.replace(/[^\d.,]/gu, '').slice(0, 8))}
                keyboardType="decimal-pad"
                hint={t('items.quantityHint')}
              />
            ) : null}
            <MoneyInput
              testID="item-amount"
              label={t('items.amount')}
              valueCents={amount}
              onChangeCents={setAmount}
              currency={query.data.currency}
              allowNegative={isAdjustment}
              hint={isAdjustment ? t('items.negativeHint') : query.data.currency}
            />
            {error ? <AppText color={palette.dangerInk}>{error}</AppText> : null}
            <AppButton
              testID="add-item"
              title={
                editingId
                  ? t('items.saveChanges')
                  : isAdjustment
                    ? t('items.addAdjustment')
                    : t('items.addProduct')
              }
              leftIcon={!editingId ? <Plus color={palette.white} size={19} /> : undefined}
              loading={save.isPending}
              onPress={() => save.mutate()}
            />
            {editingId ? (
              <AppButton title={t('items.cancelEdit')} variant="ghost" onPress={resetEditor} />
            ) : null}
          </Card>
        ) : null}
        <AppButton
          title={t('common.continue')}
          accessibilityLabel={t('items.chooseParticipantsA11y')}
          size="lg"
          fullWidth
          disabled={!canContinue}
          onPress={async () => {
            if (query.data.total_cents === 0)
              await repository.updateExpense(expenseId, {
                total_cents: itemTotal,
                own_share_cents: itemTotal,
              });
            router.push(`/expense/${expenseId}/participants`);
          }}
        />
      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  flex: { flex: 1 },
  screenContent: { gap: spacing.md },
  centerText: { textAlign: 'center' },
  receiptSelectorSection: { gap: spacing.sm },
  receiptSelectorHeading: { gap: spacing.xs },
  receiptSelector: { gap: spacing.sm, paddingRight: spacing.md },
  receiptSelectorItem: {
    width: 166,
    minHeight: 62,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  receiptSelectorPressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
  receiptSelectorIcon: {
    width: 38,
    height: 38,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptSelectorCopy: { minWidth: 0, flex: 1, gap: 2 },
  receiptFrame: {
    width: '100%',
    aspectRatio: 1.05,
    borderRadius: radii.card,
    overflow: 'hidden',
    position: 'relative',
  },
  receipt: { width: '100%', height: '100%' },
  receiptFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xxl,
  },
  scanCorner: { position: 'absolute', width: 34, height: 34 },
  topLeft: { top: 16, left: 16, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 10 },
  topRight: {
    top: 16,
    right: 16,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 10,
  },
  bottomLeft: {
    bottom: 16,
    left: 16,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 10,
  },
  bottomRight: {
    right: 16,
    bottom: 16,
    borderRightWidth: 4,
    borderBottomWidth: 4,
    borderBottomRightRadius: 10,
  },
  ocrStatus: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ocrChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  warningList: { flex: 1, gap: spacing.xs },
  manualTicket: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  manualIcon: {
    width: 50,
    height: 50,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productCard: { paddingVertical: 0 },
  itemSourceHeader: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  itemSourceDot: { width: 9, height: 9, borderRadius: radii.pill },
  groupDivider: { height: 1, width: '100%' },
  totalRow: {
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  divider: { height: 1, width: '100%' },
  indentedDivider: { height: 1, marginLeft: 64 },
  productRow: {
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  productIcon: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemMetadata: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  confidenceBadge: {
    minHeight: 24,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  rowActions: { flexDirection: 'row', marginRight: -spacing.sm },
  reconciliationCard: { gap: spacing.lg },
  reconciliationHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  breakdownRows: { gap: spacing.sm },
  breakdownRow: {
    minHeight: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  breakdownDivider: { height: 1, width: '100%', marginVertical: spacing.xs },
  quickActions: { gap: spacing.sm },
  quickActionButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  balanceLine: {
    minHeight: 24,
    paddingHorizontal: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  editorCard: { gap: spacing.lg },
  editorHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  toggle: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
