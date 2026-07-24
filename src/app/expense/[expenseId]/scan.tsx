import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Camera, Images, RotateCcw, ScanLine, ShieldCheck } from 'lucide-react-native';
import { AppButton, AppText, Card, ProgressBar, ScreenContainer } from '@/components/ui';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { repository } from '@/lib/repository';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { readableError } from '@/lib/api-error';
import { radii, spacing } from '@/theme';

export default function ScanScreen() {
  return (
    <RequireAuth>
      <ScanContent />
    </RequireAuth>
  );
}
function ScanContent() {
  const { expenseId, gallery } = useLocalSearchParams<{ expenseId: string; gallery?: string }>();
  const router = useRouter();
  const auth = useAuth();
  const palette = useAppColors();
  const cameraRef = useRef<CameraView>(null);
  const autoPicker = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [uri, setUri] = useState<string>();
  const [phase, setPhase] = useState<'idle' | 'compressing' | 'uploading' | 'processing'>('idle');
  const [error, setError] = useState<string>();
  const pick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (!result.canceled) {
      setUri(result.assets[0]?.uri);
      setCameraOpen(false);
    }
  };
  useEffect(() => {
    if (gallery === '1' && !autoPicker.current) {
      autoPicker.current = true;
      void pick();
    }
  }, [gallery]);
  const processReceipt = async () => {
    if (!uri || !auth.user) return;
    setError(undefined);
    setPhase('compressing');
    try {
      const compressed = await manipulateAsync(uri, [{ resize: { width: 2_200 } }], {
        compress: 0.86,
        format: SaveFormat.JPEG,
      });
      setPhase('uploading');
      const receiptPath = await repository.uploadReceipt(auth.user.id, expenseId, compressed.uri);
      setPhase('processing');
      const result = await repository.scanReceipt(expenseId, receiptPath);
      const detail = await repository.expense(expenseId);
      if (!detail.items.length)
        for (const [index, item] of result.items.entries())
          await repository.addItem(
            expenseId,
            {
              name: item.name,
              lineTotalCents: item.lineTotalCents,
              quantity: item.quantity,
              source: 'ocr',
            },
            index,
          );
      await repository.updateExpense(expenseId, {
        merchant_name: result.merchantName,
        currency: result.currency,
        total_cents: result.totalCents,
        own_share_cents: result.totalCents,
        scan_status: 'completed',
      });
      router.replace(`/expense/${expenseId}/items`);
    } catch (cause) {
      setError(readableError(cause).message);
      try {
        await repository.updateExpense(expenseId, { scan_status: 'failed' });
      } catch {
        /* Preserve the actionable OCR error. */
      }
    } finally {
      setPhase('idle');
    }
  };
  const takePhoto = async () => {
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        quality: 1,
        skipProcessing: false,
      });
      if (photo?.uri) {
        setUri(photo.uri);
        setCameraOpen(false);
      }
    } catch (cause) {
      setError(readableError(cause).message);
    }
  };
  if (cameraOpen && permission?.granted)
    return (
      <View style={styles.cameraPage}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
        <View style={styles.cameraActions}>
          <AppButton title="Cancelar" variant="secondary" onPress={() => setCameraOpen(false)} />
          <AppButton
            title="Hacer foto"
            leftIcon={<Camera color={palette.white} />}
            onPress={() => void takePhoto()}
          />
        </View>
      </View>
    );
  const phaseText =
    phase === 'compressing'
      ? 'Comprimiendo imagen…'
      : phase === 'uploading'
        ? 'Subiendo ticket…'
        : phase === 'processing'
          ? 'Leyendo los productos…'
          : undefined;
  return (
    <ScreenContainer contentContainerStyle={styles.screenContent}>
      <PageHeader title="Escanear ticket" />
      <View style={styles.instructions}>
        <AppText variant="screenTitle">Encuadra todo el ticket</AppText>
        <AppText variant="bodySmall" color={palette.textSecondary}>
          Ponlo sobre una superficie plana, con buena luz y sin cortar los bordes.
        </AppText>
      </View>
      {uri ? (
        <Card style={styles.previewCard}>
          <Image
            source={{ uri }}
            style={styles.preview}
            contentFit="contain"
            accessibilityLabel="Vista previa del ticket"
          />
          <View style={styles.actions}>
            <AppButton title="Repetir foto" variant="outline" onPress={() => setUri(undefined)} />
            <AppButton
              title="Girar"
              variant="outline"
              leftIcon={<RotateCcw color={palette.text} size={18} />}
              onPress={async () => {
                const rotated = await manipulateAsync(uri, [{ rotate: 90 }], {
                  compress: 0.9,
                  format: SaveFormat.JPEG,
                });
                setUri(rotated.uri);
              }}
            />
          </View>
          <AppButton
            title="Leer productos"
            size="lg"
            loading={phase !== 'idle'}
            onPress={() => void processReceipt()}
          />
          {phaseText ? (
            <>
              <AppText color={palette.textSecondary}>{phaseText}</AppText>
              <ProgressBar
                value={phase === 'compressing' ? 0.2 : phase === 'uploading' ? 0.55 : 0.82}
                color={palette.primary}
              />
            </>
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
              Total y productos visibles
            </AppText>
            <AppText variant="bodySmall" color={palette.textSecondary} style={styles.centerText}>
              Pagaste detectará el comercio, el total y cada línea.
            </AppText>
          </View>
          <AppButton
            title="Abrir cámara"
            size="lg"
            leftIcon={<Camera color={palette.white} size={20} />}
            onPress={async () => {
              const next = permission?.granted ? permission : await requestPermission();
              if (next.granted) setCameraOpen(true);
              else
                setError(
                  'Necesitamos permiso para usar la cámara. También puedes elegir una foto de tu galería.',
                );
            }}
          />
          <AppButton
            title="Elegir de la galería"
            variant="outline"
            size="lg"
            leftIcon={<Images color={palette.primary} size={20} />}
            onPress={() => void pick()}
          />
          <View style={styles.privacyLine}>
            <ShieldCheck color={palette.successInk} size={17} />
            <AppText variant="caption" color={palette.successInk}>
              Tu ticket se guarda de forma privada
            </AppText>
          </View>
        </Card>
      )}
      {error ? (
        <Card style={{ backgroundColor: palette.dangerLight }}>
          <AppText variant="heading" color={palette.dangerInk}>
            No hemos podido leer bien el ticket
          </AppText>
          <AppText>{error}</AppText>
          <AppButton
            title="Introducir productos manualmente"
            onPress={() => router.replace(`/expense/${expenseId}/items`)}
          />
        </Card>
      ) : null}
    </ScreenContainer>
  );
}
const styles = StyleSheet.create({
  screenContent: { gap: spacing.lg },
  instructions: { gap: spacing.xs },
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
  previewCard: { gap: spacing.lg },
  preview: { width: '100%', aspectRatio: 3 / 4, borderRadius: radii.lg },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
