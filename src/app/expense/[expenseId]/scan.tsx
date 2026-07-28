import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Camera,
  CheckCircle2,
  ClipboardPaste,
  Images,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Trash2,
} from 'lucide-react-native';
import { AppButton, AppText, Card, ProgressBar, ScreenContainer } from '@/components/ui';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { repository } from '@/lib/repository';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { readableError } from '@/lib/api-error';
import {
  combineReceiptScans,
  prepareReceiptCandidates,
  receiptCaptureQualityWarnings,
  type ReceiptImportCandidate,
} from '@/domain';
import { parseDigitalReceiptText } from '@/domain/digital-receipt';
import { receiptImportCopy } from '@/features/receipts/i18n';
import { useI18n } from '@/i18n';
import type { ReceiptScanResult } from '@/types';
import { radii, spacing } from '@/theme';

type ReceiptQueueStatus =
  'queued' | 'compressing' | 'uploading' | 'processing' | 'completed' | 'failed';

type ReceiptQueueItem = ReceiptImportCandidate & {
  status: ReceiptQueueStatus;
  progress: number;
  receiptId?: string;
  storagePath?: string;
  scanResult?: ReceiptScanResult;
  error?: string;
};

export default function ScanScreen() {
  return (
    <RequireAuth>
      <ScanContent />
    </RequireAuth>
  );
}

function ScanContent() {
  const { expenseId, gallery, paste } = useLocalSearchParams<{
    expenseId: string;
    gallery?: string;
    paste?: string;
  }>();
  const router = useRouter();
  const auth = useAuth();
  const palette = useAppColors();
  const { locale, intlLocale, t } = useI18n();
  const copy = useMemo(() => receiptImportCopy(locale), [locale]);
  const cameraRef = useRef<CameraView>(null);
  const autoPicker = useRef(false);
  const autoPaste = useRef(false);
  const processingRef = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [queue, setQueue] = useState<ReceiptQueueItem[]>([]);
  const [processingQueue, setProcessingQueue] = useState(false);
  const [importingText, setImportingText] = useState(false);
  const [error, setError] = useState<string>();

  const patchQueueItem = useCallback(
    (clientId: string, patch: Partial<ReceiptQueueItem>) =>
      setQueue((current) =>
        current.map((item) => (item.clientId === clientId ? { ...item, ...patch } : item)),
      ),
    [],
  );

  const addCandidates = useCallback(
    (inputs: Parameters<typeof prepareReceiptCandidates>[0]) => {
      const prepared = prepareReceiptCandidates(inputs, queue);
      if (prepared.rejected.length) {
        const reasons = new Set(prepared.rejected.map((entry) => entry.reason));
        const message = reasons.has('too_large')
          ? copy.oversizedRejected
          : reasons.has('unsupported_type')
            ? copy.unsupportedRejected
            : reasons.has('limit_reached')
              ? copy.limitRejected
              : reasons.has('duplicate')
                ? copy.duplicateRejected
                : copy.someRejected;
        setError(message);
      } else {
        setError(undefined);
      }
      setQueue([
        ...queue,
        ...prepared.accepted.map<ReceiptQueueItem>((candidate) => ({
          ...candidate,
          status: 'queued',
          progress: 0,
        })),
      ]);
    },
    [copy, queue],
  );

  const pick = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: true,
      orderedSelection: true,
      selectionLimit: Math.max(1, 20 - queue.length),
    });
    if (!result.canceled) {
      addCandidates(
        result.assets.map((asset) => ({
          id: asset.assetId || asset.uri,
          uri: asset.uri,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          fileSize: asset.fileSize,
        })),
      );
      setCameraOpen(false);
    }
  }, [addCandidates, queue.length]);

  useEffect(() => {
    if (gallery === '1' && !autoPicker.current) {
      autoPicker.current = true;
      void pick();
    }
  }, [gallery, pick]);

  const processQueueItem = useCallback(
    async (item: ReceiptQueueItem): Promise<ReceiptQueueItem> => {
      if (!auth.user) return item;
      let receiptId = item.receiptId;
      let storagePath = item.storagePath;
      try {
        if (!receiptId || !storagePath) {
          patchQueueItem(item.clientId, {
            status: 'compressing',
            progress: 0.18,
            error: undefined,
          });
          const compressed = await manipulateAsync(item.uri, [{ resize: { width: 2_200 } }], {
            compress: 0.86,
            format: SaveFormat.JPEG,
          });
          patchQueueItem(item.clientId, { status: 'uploading', progress: 0.48 });
          const persisted = await repository.uploadExpenseReceipt(
            auth.user.id,
            expenseId,
            compressed.uri,
            item.fileName,
          );
          receiptId = persisted.id;
          storagePath = persisted.storage_path;
        }

        patchQueueItem(item.clientId, {
          receiptId,
          storagePath,
          status: 'processing',
          progress: 0.72,
        });
        await repository.updateExpenseReceipt(receiptId, {
          status: 'processing',
          error_code: null,
        });
        const scanned = await repository.scanReceipt(expenseId, storagePath, {
          persistResult: false,
          locale: intlLocale,
        });
        await repository.updateExpenseReceipt(receiptId, {
          status: 'completed',
          scan_job_id: scanned.jobId,
          merchant_name: scanned.merchantName,
          total_cents: scanned.totalCents,
          confidence: scanned.confidence,
          error_code: null,
        });
        const completed: ReceiptQueueItem = {
          ...item,
          receiptId,
          storagePath,
          status: 'completed',
          progress: 1,
          scanResult: scanned,
          error: undefined,
        };
        patchQueueItem(item.clientId, completed);
        return completed;
      } catch (cause) {
        const appError = readableError(cause);
        if (receiptId) {
          await repository
            .updateExpenseReceipt(receiptId, {
              status: 'failed',
              error_code: appError.code,
            })
            .catch(() => undefined);
        }
        const failed: ReceiptQueueItem = {
          ...item,
          receiptId,
          storagePath,
          status: 'failed',
          progress: 0,
          error: appError.message,
        };
        patchQueueItem(item.clientId, failed);
        return failed;
      }
    },
    [auth.user, expenseId, intlLocale, patchQueueItem],
  );

  const processReceipts = useCallback(
    async (onlyClientIds?: readonly string[]) => {
      if (processingRef.current || !queue.length) return;
      processingRef.current = true;
      setError(undefined);
      setProcessingQueue(true);
      try {
        let finalQueue = [...queue];
        const requested = onlyClientIds ? new Set(onlyClientIds) : null;
        const targets = finalQueue.filter(
          (item) =>
            (!requested || requested.has(item.clientId)) &&
            (item.status === 'queued' || item.status === 'failed'),
        );
        for (const target of targets) {
          const processed = await processQueueItem(target);
          finalQueue = finalQueue.map((item) =>
            item.clientId === processed.clientId ? processed : item,
          );
        }
        setQueue(finalQueue);

        const failures = finalQueue.filter((item) => item.status === 'failed');
        const incomplete = finalQueue.filter(
          (item) => item.status !== 'completed' && item.status !== 'failed',
        );
        if (failures.length || incomplete.length) {
          setError(
            finalQueue.some((item) => item.status === 'completed')
              ? copy.partialFailure
              : copy.allFailed,
          );
          return;
        }

        const completed = finalQueue.filter(
          (
            item,
          ): item is ReceiptQueueItem & {
            receiptId: string;
            scanResult: ReceiptScanResult;
          } => item.status === 'completed' && Boolean(item.receiptId && item.scanResult),
        );
        const combined = combineReceiptScans(
          completed.map((item) => ({
            receiptId: item.receiptId,
            result: item.scanResult,
          })),
        );
        await repository.applyMultiReceiptResult(
          expenseId,
          completed.map((item) => item.receiptId),
          combined,
        );
        router.replace(`/expense/${expenseId}/items`);
      } catch (cause) {
        const appError = readableError(cause);
        setError(
          appError.code === 'multi_receipt_currency_mismatch'
            ? copy.currencyMismatch
            : copy.saveFailed,
        );
      } finally {
        processingRef.current = false;
        setProcessingQueue(false);
      }
    },
    [copy, expenseId, processQueueItem, queue, router],
  );

  const takePhoto = async () => {
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        quality: 1,
        skipProcessing: false,
      });
      if (photo?.uri) {
        addCandidates([
          {
            id: photo.uri,
            uri: photo.uri,
            fileName: `ticket-${Date.now()}.jpg`,
            mimeType: 'image/jpeg',
            width: photo.width,
            height: photo.height,
          },
        ]);
        setCameraOpen(false);
      }
    } catch (cause) {
      setError(readableError(cause).message);
    }
  };

  const removeQueueItem = async (item: ReceiptQueueItem) => {
    if (processingQueue) return;
    if (item.receiptId) {
      try {
        await repository.removeExpenseReceipt(item.receiptId);
      } catch (cause) {
        setError(readableError(cause).message);
        return;
      }
    }
    setQueue((current) => current.filter((candidate) => candidate.clientId !== item.clientId));
    setError(undefined);
  };

  const rotateQueueItem = async (item: ReceiptQueueItem) => {
    try {
      const rotated = await manipulateAsync(item.uri, [{ rotate: 90 }], {
        compress: 0.9,
        format: SaveFormat.JPEG,
      });
      patchQueueItem(item.clientId, {
        uri: rotated.uri,
        width: item.height,
        height: item.width,
      });
    } catch (cause) {
      setError(readableError(cause).message);
    }
  };

  const pasteDigitalOrder = useCallback(async () => {
    setError(undefined);
    setImportingText(true);
    const createdItemIds: string[] = [];
    try {
      const clipboardText = await Clipboard.getStringAsync();
      const imported = parseDigitalReceiptText(clipboardText, intlLocale);
      const current = await repository.expense(expenseId);
      if (current.items.length) throw new Error('digital_receipt_existing_items');

      for (const [index, item] of imported.items.entries()) {
        const created = await repository.addItem(
          expenseId,
          {
            name: item.name,
            lineTotalCents: item.lineTotalCents,
            quantity: item.quantity,
            source: 'manual',
          },
          index,
        );
        createdItemIds.push(created.id);
      }
      await repository.updateExpense(expenseId, {
        merchant_name: imported.merchantName,
        total_cents: imported.totalCents,
        own_share_cents: imported.totalCents,
        scan_status: 'completed',
      });
      router.replace(`/expense/${expenseId}/items`);
    } catch (cause) {
      await Promise.allSettled(createdItemIds.map((itemId) => repository.deleteItem(itemId)));
      const code = cause instanceof Error ? cause.message : '';
      setError(
        code === 'digital_receipt_empty'
          ? t('expense.clipboardEmpty')
          : code === 'digital_receipt_no_items'
            ? t('expense.clipboardNoItems')
            : code === 'digital_receipt_existing_items'
              ? t('expense.clipboardExistingItems')
              : t('expense.clipboardImportError'),
      );
    } finally {
      setImportingText(false);
    }
  }, [expenseId, intlLocale, router, t]);

  useEffect(() => {
    if (paste === '1' && !autoPaste.current) {
      autoPaste.current = true;
      void pasteDigitalOrder();
    }
  }, [paste, pasteDigitalOrder]);

  if (cameraOpen && permission?.granted) {
    return (
      <View style={styles.cameraPage}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
        <View style={styles.cameraActions}>
          <AppButton
            title={t('common.cancel')}
            variant="secondary"
            onPress={() => setCameraOpen(false)}
          />
          <AppButton
            title={t('expense.takePhoto')}
            leftIcon={<Camera color={palette.white} />}
            onPress={() => void takePhoto()}
          />
        </View>
      </View>
    );
  }

  return (
    <ScreenContainer contentContainerStyle={styles.screenContent}>
      <PageHeader title={t('expense.scanMode')} />
      <View style={styles.instructions}>
        <AppText variant="screenTitle">{t('expense.scanTitle')}</AppText>
        <AppText variant="bodySmall" color={palette.textSecondary}>
          {t('expense.scanGuide')}
        </AppText>
      </View>

      {queue.length ? (
        <Card style={styles.queueCard}>
          <View style={styles.queueHeader}>
            <View style={styles.flex}>
              <AppText variant="heading">{copy.selectedTitle(queue.length)}</AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                {copy.selectedBody}
              </AppText>
            </View>
            <AppButton
              title={copy.addMore}
              variant="ghost"
              disabled={processingQueue || queue.length >= 20}
              onPress={() => void pick()}
            />
          </View>

          <View style={styles.queueList}>
            {queue.map((item, index) => {
              const warnings = receiptCaptureQualityWarnings(item);
              const statusCopy =
                item.status === 'queued'
                  ? copy.queued
                  : item.status === 'compressing'
                    ? copy.compressing
                    : item.status === 'uploading'
                      ? copy.uploading
                      : item.status === 'processing'
                        ? copy.processing
                        : item.status === 'completed'
                          ? copy.completed
                          : copy.failed;
              const statusColor =
                item.status === 'completed'
                  ? palette.successInk
                  : item.status === 'failed'
                    ? palette.dangerInk
                    : item.status === 'queued'
                      ? palette.textSecondary
                      : palette.primary;
              return (
                <View
                  key={item.clientId}
                  style={[styles.queueItem, { borderColor: palette.divider }]}
                >
                  <Image
                    source={{ uri: item.uri }}
                    style={styles.thumbnail}
                    contentFit="cover"
                    accessibilityLabel={copy.receiptA11y(index + 1)}
                  />
                  <View style={styles.queueItemCopy}>
                    <View style={styles.queueItemTitle}>
                      <AppText variant="label" numberOfLines={1} style={styles.flex}>
                        {item.fileName || `${t('expense.scanMode')} ${index + 1}`}
                      </AppText>
                      <AppText variant="caption" color={statusColor}>
                        {statusCopy}
                      </AppText>
                    </View>
                    {item.status !== 'queued' && item.status !== 'failed' ? (
                      <ProgressBar value={item.progress} color={statusColor} />
                    ) : null}
                    {warnings.length && item.status === 'queued' ? (
                      <AppText variant="caption" color={palette.warningInk}>
                        {warnings
                          .map((warning) =>
                            t(
                              warning === 'image_low_resolution'
                                ? 'expense.captureLowResolution'
                                : 'expense.captureAspectRatio',
                            ),
                          )
                          .join(' ')}
                      </AppText>
                    ) : null}
                    {item.error ? (
                      <AppText variant="caption" color={palette.dangerInk}>
                        {item.error}
                      </AppText>
                    ) : null}
                    <View style={styles.itemActions}>
                      {item.status === 'queued' ? (
                        <AppButton
                          title={t('expense.rotate')}
                          variant="ghost"
                          size="sm"
                          leftIcon={<RotateCcw color={palette.textSecondary} size={15} />}
                          onPress={() => void rotateQueueItem(item)}
                        />
                      ) : null}
                      {item.status === 'failed' ? (
                        <AppButton
                          title={copy.retry}
                          variant="ghost"
                          size="sm"
                          disabled={processingQueue}
                          onPress={() => void processReceipts([item.clientId])}
                        />
                      ) : null}
                      <AppButton
                        title={copy.remove}
                        variant="ghost"
                        size="sm"
                        disabled={
                          processingQueue ||
                          item.status === 'compressing' ||
                          item.status === 'uploading' ||
                          item.status === 'processing'
                        }
                        leftIcon={<Trash2 color={palette.dangerInk} size={15} />}
                        onPress={() => void removeQueueItem(item)}
                      />
                    </View>
                  </View>
                </View>
              );
            })}
          </View>

          <AppButton
            title={copy.readAll(
              queue.filter((item) => item.status !== 'completed').length || queue.length,
            )}
            size="lg"
            loading={processingQueue}
            disabled={processingQueue || !queue.length}
            leftIcon={<ScanLine color={palette.white} size={20} />}
            onPress={() => void processReceipts()}
          />
          {queue.length > 1 && queue.some((item) => item.status === 'completed') ? (
            <View style={styles.combineLine}>
              <CheckCircle2 color={palette.successInk} size={17} />
              <AppText variant="caption" color={palette.successInk}>
                {copy.combineReady(queue.filter((item) => item.status === 'completed').length)}
              </AppText>
            </View>
          ) : null}
        </Card>
      ) : (
        <Card style={styles.captureCard}>
          <View
            style={[
              styles.guide,
              { borderColor: palette.primary, backgroundColor: palette.primaryLight },
            ]}
          >
            <View style={[styles.guideIcon, { backgroundColor: palette.surface }]}>
              <ScanLine color={palette.primary} size={38} />
            </View>
            <AppText variant="heading" style={styles.centerText}>
              {t('expense.visibleTotalAndItems')}
            </AppText>
            <AppText variant="bodySmall" color={palette.textSecondary} style={styles.centerText}>
              {t('expense.detectsMerchantAndItems')}
            </AppText>
          </View>
          <AppButton
            title={t('expense.camera')}
            size="lg"
            leftIcon={<Camera color={palette.white} size={20} />}
            onPress={async () => {
              const next = permission?.granted ? permission : await requestPermission();
              if (next.granted) setCameraOpen(true);
              else setError(t('expense.permissionDenied'));
            }}
          />
          <AppButton
            title={t('expense.gallery')}
            variant="outline"
            size="lg"
            leftIcon={<Images color={palette.primary} size={20} />}
            onPress={() => void pick()}
          />
          <AppButton
            title={t('expense.pasteActionShort')}
            variant="secondary"
            size="lg"
            loading={importingText}
            leftIcon={<ClipboardPaste color={palette.primary} size={20} />}
            onPress={() => void pasteDigitalOrder()}
          />
          <AppText variant="caption" color={palette.textSecondary} style={styles.centerText}>
            {t('expense.pasteHelp')}
          </AppText>
          <View style={styles.privacyLine}>
            <ShieldCheck color={palette.successInk} size={17} />
            <AppText variant="caption" color={palette.successInk}>
              {t('expense.receiptPrivate')}
            </AppText>
          </View>
        </Card>
      )}

      {error ? (
        <Card style={{ backgroundColor: palette.dangerLight }}>
          <AppText variant="heading" color={palette.dangerInk}>
            {t('expense.scanFailed')}
          </AppText>
          <AppText>{error}</AppText>
          {!queue.length ? (
            <AppButton
              title={t('expense.manualFallback')}
              onPress={() => router.replace(`/expense/${expenseId}/items`)}
            />
          ) : null}
        </Card>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: { gap: spacing.lg },
  instructions: { gap: spacing.xs },
  flex: { flex: 1, minWidth: 0 },
  cameraPage: { flex: 1, backgroundColor: '#000' },
  cameraActions: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xxl,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  queueCard: { gap: spacing.lg },
  queueHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  queueList: { gap: spacing.sm },
  queueItem: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumbnail: { width: 72, height: 92, borderRadius: radii.md },
  queueItemCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  queueItemTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  itemActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  combineLine: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
  captureCard: { gap: spacing.lg },
  guide: {
    minHeight: 300,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: radii.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  guideIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerText: { textAlign: 'center' },
  privacyLine: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
