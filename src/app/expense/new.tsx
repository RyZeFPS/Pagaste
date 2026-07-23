import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  Camera,
  ChevronRight,
  Image as ImageIcon,
  Keyboard,
  ReceiptText,
  Repeat2,
  ShieldCheck,
} from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AppButton, AppInput, AppText, Card, MoneyInput, ScreenContainer } from '@/components/ui';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { MerchantPicker } from '@/components/merchant-picker';
import { repository } from '@/lib/repository';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { readableError } from '@/lib/api-error';
import { spacing } from '@/theme';

type Mode = 'scan' | 'gallery' | 'manual' | 'repeat';
export default function NewExpenseScreen() {
  return (
    <RequireAuth>
      <NewExpenseContent />
    </RequireAuth>
  );
}
function NewExpenseContent() {
  const params = useLocalSearchParams<{ mode?: Mode; groupId?: string }>();
  const router = useRouter();
  const auth = useAuth();
  const palette = useAppColors();
  const [mode, setMode] = useState<Mode | undefined>(params.mode);
  const [title, setTitle] = useState('');
  const [merchant, setMerchant] = useState('');
  const [notes, setNotes] = useState('');
  const [totalCents, setTotalCents] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const create = async (target: 'items' | 'scan', pickGallery = false) => {
    if (!auth.user || !auth.profile) return;
    if (target === 'items' && title.trim().length < 2) {
      setError('Escribe un título.');
      return;
    }
    if (target === 'items' && totalCents <= 0) {
      setError('El total debe ser mayor que cero.');
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const expense = await repository.createExpense(auth.user.id, {
        title: title.trim() || `Ticket del ${new Intl.DateTimeFormat('es-ES').format(new Date())}`,
        merchantName: merchant.trim(),
        totalCents,
        currency: auth.profile.default_currency || 'EUR',
        notes: notes.trim(),
        groupId: params.groupId,
      });
      const group = params.groupId ? await repository.group(params.groupId) : null;
      const payer = await repository.addParticipant(
        expense.id,
        { displayName: auth.profile.display_name, userId: auth.user.id, isPayer: true },
        0,
      );
      await repository.updateExpense(expense.id, {
        payer_participant_id: payer.id,
        payer_member_id:
          group?.members.find((member) => member.user_id === auth.user?.id)?.id ?? null,
      });
      if (group) {
        const reusableMembers = group.members.filter(
          (member) => member.status === 'active' && member.user_id !== auth.user?.id,
        );
        for (const [index, member] of reusableMembers.entries())
          await repository.addParticipant(
            expense.id,
            { displayName: member.display_name, userId: member.user_id ?? undefined },
            index + 1,
          );
      }
      router.replace({
        pathname: target === 'items' ? '/expense/[expenseId]/items' : '/expense/[expenseId]/scan',
        params: { expenseId: expense.id, ...(pickGallery ? { gallery: '1' } : {}) },
      });
    } catch (cause) {
      setError(readableError(cause).message);
    } finally {
      setLoading(false);
    }
  };
  if (!mode) {
    const options: { mode: Mode; title: string; body: string; icon: typeof Camera }[] = [
      {
        mode: 'scan',
        title: 'Escanear un ticket',
        body: 'Haz una foto y revisa los productos.',
        icon: Camera,
      },
      {
        mode: 'gallery',
        title: 'Subir una foto',
        body: 'Elige un ticket de tu galería.',
        icon: ImageIcon,
      },
      {
        mode: 'manual',
        title: 'Introducir manualmente',
        body: 'Añade el total y los productos tú mismo.',
        icon: Keyboard,
      },
      {
        mode: 'repeat',
        title: 'Repetir un gasto anterior',
        body: 'Usa los datos como punto de partida.',
        icon: Repeat2,
      },
    ];
    return (
      <ScreenContainer contentContainerStyle={styles.screenContent}>
        <PageHeader title="Nuevo gasto" />
        <View style={styles.intro}>
          <View style={[styles.heroIcon, { backgroundColor: palette.primaryLight }]}>
            <ReceiptText color={palette.primary} size={30} />
          </View>
          <View style={styles.flex}>
            <AppText variant="screenTitle">¿Cómo quieres añadirlo?</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              Escanea un ticket o crea el gasto a mano.
            </AppText>
          </View>
        </View>
        {options.map(({ mode: value, title: optionTitle, body, icon: Icon }) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            onPress={() => setMode(value)}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Card style={styles.option}>
              <View style={[styles.icon, { backgroundColor: palette.primaryLight }]}>
                <Icon color={palette.primary} size={22} />
              </View>
              <View style={styles.flex}>
                <AppText variant="label">{optionTitle}</AppText>
                <AppText variant="bodySmall" color={palette.textSecondary}>
                  {body}
                </AppText>
              </View>
              <ChevronRight color={palette.textMuted} size={20} />
            </Card>
          </Pressable>
        ))}
      </ScreenContainer>
    );
  }
  if (mode === 'scan' || mode === 'gallery')
    return (
      <ScreenContainer contentContainerStyle={styles.screenContent}>
        <PageHeader title={mode === 'scan' ? 'Escanear ticket' : 'Subir una foto'} />
        <Card style={styles.prepareCard}>
          <View style={[styles.prepareIcon, { backgroundColor: palette.primaryLight }]}>
            {mode === 'scan' ? (
              <Camera color={palette.primary} size={34} />
            ) : (
              <ImageIcon color={palette.primary} size={34} />
            )}
          </View>
          <AppText variant="screenTitle" style={styles.centerText}>
            {mode === 'scan' ? 'Fotografía el ticket' : 'Elige el ticket'}
          </AppText>
          <AppText color={palette.textSecondary} style={styles.centerText}>
            Lo comprimiremos antes de enviarlo y solo será visible para ti.
          </AppText>
          <View style={styles.privacyLine}>
            <ShieldCheck color={palette.successInk} size={18} />
            <AppText variant="bodySmall" color={palette.successInk}>
              Imagen privada y enlace temporal
            </AppText>
          </View>
          <AppButton
            title={mode === 'scan' ? 'Preparar cámara' : 'Elegir de la galería'}
            size="lg"
            loading={loading}
            onPress={() => void create('scan', mode === 'gallery')}
          />
          {error ? <AppText color={palette.danger}>{error}</AppText> : null}
        </Card>
        <AppButton title="Cambiar método" variant="ghost" onPress={() => setMode(undefined)} />
      </ScreenContainer>
    );
  return (
    <ScreenContainer contentContainerStyle={styles.screenContent}>
      <PageHeader title={mode === 'repeat' ? 'Repetir gasto' : 'Gasto manual'} />
      <View style={styles.formIntro}>
        <AppText variant="screenTitle">Datos del gasto</AppText>
        <AppText variant="bodySmall" color={palette.textSecondary}>
          Después podrás añadir y corregir cada producto.
        </AppText>
      </View>
      <Card style={styles.formCard}>
        <AppInput
          testID="expense-title"
          label="Título"
          placeholder="Cena del viernes"
          value={title}
          onChangeText={setTitle}
        />
        <MerchantPicker value={merchant} onChangeText={setMerchant} />
        <MoneyInput
          testID="expense-total"
          label="Total"
          valueCents={totalCents}
          onChangeCents={setTotalCents}
          currency="EUR"
        />
        <AppInput
          label="Notas (opcional)"
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
        />
        {error ? <AppText color={palette.danger}>{error}</AppText> : null}
        <AppButton
          title="Guardar borrador"
          size="lg"
          loading={loading}
          onPress={() => void create('items')}
        />
      </Card>
    </ScreenContainer>
  );
}
const styles = StyleSheet.create({
  screenContent: { gap: spacing.lg },
  intro: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  option: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
  prepareCard: { alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.xxl },
  prepareIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerText: { textAlign: 'center' },
  privacyLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  formIntro: { gap: spacing.xs },
  formCard: { gap: spacing.lg },
});
