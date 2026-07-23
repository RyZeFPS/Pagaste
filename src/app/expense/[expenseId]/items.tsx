import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Check, Minus, Pencil, Plus, RotateCcw, ScanLine, Trash2 } from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  StickyFooter,
} from '@/components/ui';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { ScreenLoadingSkeleton } from '@/components/loading-skeletons';
import { repository } from '@/lib/repository';
import { useAppColors } from '@/providers/app-providers';
import { useI18n } from '@/i18n';
import { radii, spacing } from '@/theme';
import { sumCents } from '@/domain/money';
import type { ExpenseItem } from '@/lib/models';
import { ThreeDIcon } from '@/components/three-d-icon';
import { productThreeDAsset } from '@/lib/product-visual';

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
  const { formatMoney } = useI18n();
  const query = useQuery({
    queryKey: ['expense', expenseId],
    queryFn: () => repository.expense(expenseId),
  });
  const receiptQuery = useQuery({
    queryKey: ['receipt-url', query.data?.receipt_path],
    enabled: Boolean(query.data?.receipt_path),
    queryFn: () => repository.receiptUrl(query.data!.receipt_path!),
    staleTime: 240_000,
    refetchInterval: 240_000,
  });
  const scanQuery = useQuery({
    queryKey: ['receipt-scan', expenseId],
    enabled: Boolean(query.data?.receipt_path),
    queryFn: () => repository.latestReceiptScan(expenseId),
  });
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
          isAdjustment
            ? 'El descuento debe ser un importe negativo.'
            : 'Escribe un producto y un importe válido.',
        );
      if (
        !isAdjustment &&
        (!/^\d{1,4}(?:[.,]\d{1,3})?$/u.test(quantity) ||
          !Number.isFinite(parsedQuantity) ||
          parsedQuantity <= 0)
      )
        throw new Error('Escribe una cantidad válida, con un máximo de tres decimales.');

      const savedQuantity = isAdjustment ? 1 : parsedQuantity;
      const unitPriceCents =
        Number.isSafeInteger(savedQuantity) && amount % savedQuantity === 0
          ? amount / savedQuantity
          : null;
      if (editingId)
        await repository.updateItem(editingId, {
          name: name.trim(),
          quantity: savedQuantity,
          unit_price_cents: unitPriceCents,
          line_total_cents: amount,
          source: isAdjustment ? 'adjustment' : 'manual',
        });
      else
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
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : 'No se ha podido guardar.'),
  });

  const itemTotal = useMemo(
    () => sumCents((query.data?.items ?? []).map((item) => item.line_total_cents)),
    [query.data?.items],
  );

  if (query.isPending && !query.data) return <ScreenLoadingSkeleton variant="items" />;
  if (query.isError || !query.data)
    return (
      <ScreenContainer>
        <ErrorState
          body="No hemos podido cargar el borrador."
          onRetry={() => void query.refetch()}
        />
      </ScreenContainer>
    );

  const difference = sumCents([query.data.total_cents, -itemTotal]);
  const canContinue =
    query.data.items.length > 0 && (difference === 0 || query.data.total_cents === 0);
  const showEditor = editingMode || !query.data.receipt_path || query.data.items.length === 0;
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
          title={query.data.receipt_path ? 'Ticket escaneado' : 'Productos del gasto'}
          action={
            query.data.items.length ? (
              <AppButton
                title={editingMode ? 'Listo' : 'Editar'}
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

        {query.data.receipt_path ? (
          <View style={[styles.receiptFrame, { backgroundColor: palette.surface }]}>
            {receiptQuery.isLoading ? (
              <LoadingSkeleton height={420} />
            ) : receiptQuery.data ? (
              <Image
                source={{ uri: receiptQuery.data }}
                style={styles.receipt}
                contentFit="contain"
                accessibilityLabel="Ticket fotografiado"
              />
            ) : (
              <View style={[styles.receiptFallback, { backgroundColor: palette.surface }]}>
                <ScanLine color={palette.textMuted} size={42} />
                <AppText color={palette.textSecondary} style={styles.centerText}>
                  No se ha podido cargar la vista privada del ticket.
                </AppText>
                <AppButton
                  title="Reintentar"
                  variant="outline"
                  onPress={() => void receiptQuery.refetch()}
                />
              </View>
            )}
            <View style={[styles.scanCorner, styles.topLeft, { borderColor: palette.primary }]} />
            <View style={[styles.scanCorner, styles.topRight, { borderColor: palette.primary }]} />
            <View
              style={[styles.scanCorner, styles.bottomLeft, { borderColor: palette.primary }]}
            />
            <View
              style={[styles.scanCorner, styles.bottomRight, { borderColor: palette.primary }]}
            />
          </View>
        ) : (
          <Card variant="outlined" style={styles.manualTicket}>
            <View style={[styles.manualIcon, { backgroundColor: palette.primaryLight }]}>
              <ScanLine color={palette.primary} size={26} />
            </View>
            <View style={styles.flex}>
              <AppText variant="heading">Gasto manual</AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                Añade cada producto y Pagaste comprobará el total.
              </AppText>
            </View>
          </Card>
        )}

        {query.data.receipt_path ? (
          <View style={styles.ocrStatus}>
            <View style={[styles.ocrChip, { backgroundColor: palette.successLight }]}>
              <Check color={palette.successInk} size={14} strokeWidth={2.5} />
              <AppText variant="caption" color={palette.successInk}>
                IA / OCR
              </AppText>
            </View>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {scanQuery.isLoading ? 'Leyendo productos…' : 'Productos detectados'}
            </AppText>
          </View>
        ) : null}

        {query.data.items.length ? (
          <Card variant="grouped" style={styles.productCard}>
            <View style={styles.totalRow}>
              <AppText variant="heading">Total</AppText>
              <CurrencyAmount
                cents={receiptTotal}
                currency={query.data.currency}
                variant="metric"
                color={palette.primary}
              />
            </View>
            <View style={[styles.divider, { backgroundColor: palette.divider }]} />
            {query.data.items.map((item, index) => {
              const itemAsset = productThreeDAsset(item);
              return (
                <View key={item.id}>
                  <View style={styles.productRow}>
                    <View
                      style={[
                        styles.productIcon,
                        {
                          backgroundColor:
                            item.source === 'adjustment' ? palette.warningLight : 'transparent',
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
                      <AppText variant="bodySmall" color={palette.textSecondary}>
                        {item.source === 'adjustment'
                          ? 'Ajuste'
                          : `${item.quantity.toLocaleString('es-ES')} ${item.quantity === 1 ? 'ud' : 'uds'}`}
                      </AppText>
                    </View>
                    <CurrencyAmount
                      cents={item.line_total_cents}
                      currency={query.data.currency}
                      variant="label"
                    />
                    {editingMode ? (
                      <View style={styles.rowActions}>
                        <IconButton
                          label={`Editar ${item.name}`}
                          variant="plain"
                          icon={<Pencil color={palette.primary} size={18} />}
                          onPress={() => startEditing(item)}
                        />
                        <IconButton
                          label={`Eliminar ${item.name}`}
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
                  {index < query.data.items.length - 1 ? (
                    <View style={[styles.indentedDivider, { backgroundColor: palette.divider }]} />
                  ) : null}
                </View>
              );
            })}
          </Card>
        ) : null}

        <View style={styles.balanceLine}>
          {!query.data.items.length ? (
            <AppText variant="bodySmall" color={palette.textSecondary}>
              Añade al menos un producto para continuar.
            </AppText>
          ) : difference === 0 ? (
            <>
              <Check color={palette.successInk} size={18} />
              <AppText variant="bodySmall" color={palette.successInk}>
                Los productos cuadran con el total.
              </AppText>
            </>
          ) : query.data.total_cents === 0 ? (
            <AppText variant="bodySmall" color={palette.warningInk}>
              El total se fijará en {formatMoney(itemTotal, query.data.currency)}.
            </AppText>
          ) : (
            <AppText variant="bodySmall" color={palette.dangerInk}>
              Faltan ajustar {formatMoney(Math.abs(difference), query.data.currency)}.
            </AppText>
          )}
        </View>

        {showEditor ? (
          <Card style={styles.editorCard}>
            <View style={styles.editorHeading}>
              <View style={styles.flex}>
                <AppText variant="heading">
                  {editingId ? 'Editar línea' : isAdjustment ? 'Añadir ajuste' : 'Añadir producto'}
                </AppText>
                <AppText variant="bodySmall" color={palette.textSecondary}>
                  {editingId
                    ? 'Actualiza los datos detectados.'
                    : 'Completa el ticket si falta algo.'}
                </AppText>
              </View>
              {!editingId && query.data.receipt_path ? (
                <IconButton
                  label="Volver a escanear"
                  variant="plain"
                  icon={<RotateCcw color={palette.textSecondary} size={19} />}
                  onPress={() => router.push(`/expense/${expenseId}/scan`)}
                />
              ) : null}
            </View>
            <View style={styles.toggle}>
              <AppButton
                title="Producto"
                size="sm"
                variant={!isAdjustment ? 'primary' : 'outline'}
                onPress={() => {
                  setIsAdjustment(false);
                  if (amount < 0) setAmount(0);
                }}
              />
              <AppButton
                title="Descuento / ajuste"
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
              label={isAdjustment ? 'Concepto del ajuste' : 'Producto'}
              placeholder={isAdjustment ? 'Descuento' : 'Pizza'}
              value={name}
              onChangeText={setName}
            />
            {!isAdjustment ? (
              <AppInput
                label="Cantidad"
                value={quantity}
                onChangeText={(value) => setQuantity(value.replace(/[^\d.,]/gu, '').slice(0, 8))}
                keyboardType="decimal-pad"
                hint="Unidades o cantidad con hasta tres decimales"
              />
            ) : null}
            <MoneyInput
              testID="item-amount"
              label="Importe"
              valueCents={amount}
              onChangeCents={setAmount}
              currency={query.data.currency}
              allowNegative={isAdjustment}
              hint={
                isAdjustment
                  ? 'Introduce un valor negativo, por ejemplo -2,50'
                  : query.data.currency
              }
            />
            {error ? <AppText color={palette.dangerInk}>{error}</AppText> : null}
            <AppButton
              testID="add-item"
              title={
                editingId ? 'Guardar cambios' : isAdjustment ? 'Añadir ajuste' : 'Añadir producto'
              }
              leftIcon={!editingId ? <Plus color={palette.white} size={19} /> : undefined}
              loading={save.isPending}
              onPress={() => save.mutate()}
            />
            {editingId ? (
              <AppButton title="Cancelar edición" variant="ghost" onPress={resetEditor} />
            ) : null}
          </Card>
        ) : null}
      </ScreenContainer>
      <StickyFooter>
        <AppButton
          title="Continuar"
          accessibilityLabel="Elegir participantes"
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
      </StickyFooter>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  flex: { flex: 1 },
  screenContent: { gap: spacing.md },
  centerText: { textAlign: 'center' },
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
  manualTicket: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  manualIcon: {
    width: 50,
    height: 50,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productCard: { paddingVertical: 0 },
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
  rowActions: { flexDirection: 'row', marginRight: -spacing.sm },
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
