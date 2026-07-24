import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import {
  Camera,
  ChevronRight,
  Image as ImageIcon,
  Keyboard,
  ReceiptText,
  Repeat2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  AppButton,
  AppInput,
  AppText,
  Avatar,
  Card,
  MoneyInput,
  ScreenContainer,
} from '@/components/ui';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { MerchantPicker } from '@/components/merchant-picker';
import { repository } from '@/lib/repository';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { readableError } from '@/lib/api-error';
import {
  equalAllocationValues,
  MANUAL_REMAINDER_CATEGORY,
  MANUAL_REMAINDER_NAME,
  splitEvenly,
} from '@/domain';
import { radii, spacing } from '@/theme';

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
  const autoScanStarted = useRef(false);
  const [mode, setMode] = useState<Mode | undefined>(params.mode);
  const [title, setTitle] = useState('');
  const [merchant, setMerchant] = useState('');
  const [totalCents, setTotalCents] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const groupQuery = useQuery({
    queryKey: ['group', params.groupId],
    enabled: Boolean(params.groupId),
    queryFn: () => repository.group(params.groupId!),
  });
  const previewPeople = useMemo(() => {
    if (!auth.profile || !auth.user) return [];
    const people = [
      {
        id: auth.user.id,
        name: auth.profile.display_name,
        avatar: auth.profile.avatar_path,
        isPayer: true,
      },
    ];
    for (const member of groupQuery.data?.members ?? []) {
      const id = member.user_id ?? member.id;
      if (
        member.status !== 'active' ||
        member.user_id === auth.user.id ||
        people.some((person) => person.id === id)
      )
        continue;
      people.push({
        id,
        name: member.display_name,
        avatar: member.avatar_path,
        isPayer: false,
      });
    }
    return people;
  }, [auth.profile, auth.user, groupQuery.data?.members]);
  const equalPreview = useMemo(
    () => (previewPeople.length ? splitEvenly(totalCents, previewPeople.length) : []),
    [previewPeople.length, totalCents],
  );
  const create = useCallback(
    async (target: 'participants' | 'scan', pickGallery = false) => {
      if (!auth.user || !auth.profile) return;
      if (target === 'participants' && title.trim().length < 2) {
        setError('Escribe un título.');
        return;
      }
      if (target === 'participants' && totalCents <= 0) {
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
          groupId: params.groupId,
        });
        const group = params.groupId
          ? (groupQuery.data ?? (await repository.group(params.groupId)))
          : null;
        const payer = await repository.addParticipant(
          expense.id,
          { displayName: auth.profile.display_name, userId: auth.user.id, isPayer: true },
          0,
        );
        const participantIds = [payer.id];
        await repository.updateExpense(expense.id, {
          payer_participant_id: payer.id,
          payer_member_id:
            group?.members.find((member) => member.user_id === auth.user?.id)?.id ?? null,
        });
        if (group) {
          const reusableMembers = group.members.filter(
            (member) => member.status === 'active' && member.user_id !== auth.user?.id,
          );
          for (const [index, member] of reusableMembers.entries()) {
            const participant = await repository.addParticipant(
              expense.id,
              { displayName: member.display_name, userId: member.user_id ?? undefined },
              index + 1,
            );
            participantIds.push(participant.id);
          }
        }
        if (target === 'participants') {
          const remainder = await repository.addItem(
            expense.id,
            {
              name: MANUAL_REMAINDER_NAME,
              lineTotalCents: totalCents,
              category: MANUAL_REMAINDER_CATEGORY,
              source: 'manual',
            },
            0,
          );
          await repository.replaceAllocations(
            remainder.id,
            equalAllocationValues(totalCents, participantIds),
          );
        }
        router.replace({
          pathname:
            target === 'participants'
              ? '/expense/[expenseId]/participants'
              : '/expense/[expenseId]/scan',
          params: { expenseId: expense.id, ...(pickGallery ? { gallery: '1' } : {}) },
        });
      } catch (cause) {
        setError(readableError(cause).message);
      } finally {
        setLoading(false);
      }
    },
    [
      auth.profile,
      auth.user,
      groupQuery.data,
      merchant,
      params.groupId,
      router,
      title,
      totalCents,
    ],
  );

  useEffect(() => {
    if (mode !== 'scan' || autoScanStarted.current) return;
    autoScanStarted.current = true;
    void create('scan');
  }, [create, mode]);
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
  if (mode === 'scan')
    return (
      <ScreenContainer contentContainerStyle={styles.screenContent}>
        <PageHeader title="Escanear ticket" />
        <View style={styles.scanLoading}>
          {error ? (
            <>
              <AppText variant="heading" color={palette.danger}>
                No hemos podido preparar el escaneo
              </AppText>
              <AppText color={palette.textSecondary} style={styles.centerText}>
                {error}
              </AppText>
              <AppButton
                title="Reintentar"
                onPress={() => {
                  autoScanStarted.current = true;
                  void create('scan');
                }}
              />
              <AppButton
                title="Cambiar método"
                variant="ghost"
                onPress={() => {
                  autoScanStarted.current = false;
                  setMode(undefined);
                }}
              />
            </>
          ) : (
            <>
              <ActivityIndicator color={palette.primary} size="large" />
              <AppText color={palette.textSecondary}>Abriendo el escáner…</AppText>
            </>
          )}
        </View>
      </ScreenContainer>
    );
  if (mode === 'gallery')
    return (
      <ScreenContainer contentContainerStyle={styles.screenContent}>
        <PageHeader title="Subir una foto" />
        <Card style={styles.prepareCard}>
          <View style={[styles.prepareIcon, { backgroundColor: palette.primaryLight }]}>
            <ImageIcon color={palette.primary} size={34} />
          </View>
          <AppText variant="screenTitle" style={styles.centerText}>
            Elige el ticket
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
            title="Elegir de la galería"
            size="lg"
            loading={loading}
            onPress={() => void create('scan', true)}
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
          Pon el total y Pagaste preparará el reparto en un momento.
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
        <View style={[styles.equalCard, { backgroundColor: palette.primaryLight }]}>
          <View style={styles.equalHeading}>
            <View style={[styles.equalIcon, { backgroundColor: palette.surface }]}>
              <Sparkles color={palette.primary} size={18} />
            </View>
            <View style={styles.flex}>
              <AppText variant="label">Reparto rápido a partes iguales</AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                Es el punto de partida; luego podrás cambiar cada producto.
              </AppText>
            </View>
          </View>
          <View style={styles.equalPeople}>
            {previewPeople.map((person, index) => (
              <View key={person.id} style={styles.equalPerson}>
                <Avatar name={person.name} uri={person.avatar} size={42} />
                <View style={styles.equalPersonCopy}>
                  <AppText variant="bodySmall" numberOfLines={1}>
                    {person.isPayer ? 'Tú' : person.name}
                  </AppText>
                  <AppText variant="label" color={palette.primary}>
                    {new Intl.NumberFormat('es-ES', {
                      style: 'currency',
                      currency: auth.profile?.default_currency || 'EUR',
                    }).format((equalPreview[index] ?? 0) / 100)}
                  </AppText>
                </View>
              </View>
            ))}
          </View>
          {!params.groupId ? (
            <AppText variant="caption" color={palette.textSecondary}>
              Podrás añadir a las demás personas en la siguiente pantalla.
            </AppText>
          ) : groupQuery.isLoading ? (
            <AppText variant="caption" color={palette.textSecondary}>
              Cargando las personas del grupo…
            </AppText>
          ) : null}
        </View>
        {error ? <AppText color={palette.danger}>{error}</AppText> : null}
        <AppButton
          title="Guardar borrador"
          size="lg"
          loading={loading}
          onPress={() => void create('participants')}
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
  scanLoading: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  formIntro: { gap: spacing.xs },
  formCard: { gap: spacing.lg },
  equalCard: { borderRadius: radii.lg, padding: spacing.md, gap: spacing.md },
  equalHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  equalIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  equalPeople: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  equalPerson: {
    minWidth: 132,
    flexGrow: 1,
    flexBasis: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  equalPersonCopy: { minWidth: 0, flex: 1 },
});
