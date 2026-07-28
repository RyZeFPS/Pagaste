import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import {
  Camera,
  ChevronRight,
  ClipboardPaste,
  Image as ImageIcon,
  Keyboard,
  ReceiptText,
  Repeat2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AppButton,
  AppInput,
  AppText,
  Avatar,
  Card,
  CurrencyAmount,
  EmptyState,
  ErrorState,
  MoneyInput,
  ScreenContainer,
} from '@/components/ui';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { MerchantPicker } from '@/components/merchant-picker';
import { repository } from '@/lib/repository';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { useI18n } from '@/i18n';
import { readableError } from '@/lib/api-error';
import { repeatExpenseRepository, type RepeatableExpense } from '@/lib/repeat-expense';
import {
  equalAllocationValues,
  MANUAL_REMAINDER_CATEGORY,
  MANUAL_REMAINDER_NAME,
  splitEvenly,
} from '@/domain';
import { radii, spacing } from '@/theme';

type Mode = 'scan' | 'gallery' | 'paste' | 'manual' | 'repeat';
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
  const { formatMoney, intlLocale, t } = useI18n();
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
    async (target: 'participants' | 'scan', importSource?: 'gallery' | 'paste') => {
      if (!auth.user || !auth.profile) return;
      if (target === 'participants' && title.trim().length < 2) {
        setError(t('expense.titleRequired'));
        return;
      }
      if (target === 'participants' && totalCents <= 0) {
        setError(t('expense.totalRequired'));
        return;
      }
      setLoading(true);
      setError(undefined);
      try {
        const expense = await repository.createExpense(auth.user.id, {
          title:
            title.trim() ||
            t('expense.defaultReceiptTitle', {
              date: new Intl.DateTimeFormat(intlLocale).format(new Date()),
            }),
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
          params: {
            expenseId: expense.id,
            ...(importSource === 'gallery' ? { gallery: '1' } : {}),
            ...(importSource === 'paste' ? { paste: '1' } : {}),
          },
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
      intlLocale,
      merchant,
      params.groupId,
      router,
      title,
      totalCents,
      t,
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
        title: t('expense.scanMode'),
        body: t('expense.scanModeBody'),
        icon: Camera,
      },
      {
        mode: 'gallery',
        title: t('expense.galleryMode'),
        body: t('expense.galleryModeBody'),
        icon: ImageIcon,
      },
      {
        mode: 'paste',
        title: t('expense.pasteMode'),
        body: t('expense.pasteModeBody'),
        icon: ClipboardPaste,
      },
      {
        mode: 'manual',
        title: t('expense.manualMode'),
        body: t('expense.manualModeBody'),
        icon: Keyboard,
      },
      {
        mode: 'repeat',
        title: t('expense.repeatMode'),
        body: t('expense.repeatModeBody'),
        icon: Repeat2,
      },
    ];
    return (
      <ScreenContainer contentContainerStyle={styles.screenContent}>
        <PageHeader title={t('expense.new')} />
        <View style={styles.intro}>
          <View style={[styles.heroIcon, { backgroundColor: palette.primaryLight }]}>
            <ReceiptText color={palette.primary} size={30} />
          </View>
          <View style={styles.flex}>
            <AppText variant="screenTitle">{t('expense.chooseMode')}</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {t('expense.chooseModeBody')}
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
        <PageHeader title={t('expense.scanMode')} />
        <View style={styles.scanLoading}>
          {error ? (
            <>
              <AppText variant="heading" color={palette.danger}>
                {t('expense.scanPrepareError')}
              </AppText>
              <AppText color={palette.textSecondary} style={styles.centerText}>
                {error}
              </AppText>
              <AppButton
                title={t('common.retry')}
                onPress={() => {
                  autoScanStarted.current = true;
                  void create('scan');
                }}
              />
              <AppButton
                title={t('expense.changeMethod')}
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
              <AppText color={palette.textSecondary}>{t('expense.openingScanner')}</AppText>
            </>
          )}
        </View>
      </ScreenContainer>
    );
  if (mode === 'gallery')
    return (
      <ScreenContainer contentContainerStyle={styles.screenContent}>
        <PageHeader title={t('expense.galleryMode')} />
        <Card style={styles.prepareCard}>
          <View style={[styles.prepareIcon, { backgroundColor: palette.primaryLight }]}>
            <ImageIcon color={palette.primary} size={34} />
          </View>
          <AppText variant="screenTitle" style={styles.centerText}>
            {t('expense.chooseReceipt')}
          </AppText>
          <AppText color={palette.textSecondary} style={styles.centerText}>
            {t('expense.galleryPrivacyBody')}
          </AppText>
          <View style={styles.privacyLine}>
            <ShieldCheck color={palette.successInk} size={18} />
            <AppText variant="bodySmall" color={palette.successInk}>
              {t('expense.privateImage')}
            </AppText>
          </View>
          <AppButton
            title={t('expense.gallery')}
            size="lg"
            loading={loading}
            onPress={() => void create('scan', 'gallery')}
          />
          {error ? <AppText color={palette.danger}>{error}</AppText> : null}
        </Card>
        <AppButton
          title={t('expense.changeMethod')}
          variant="ghost"
          onPress={() => setMode(undefined)}
        />
      </ScreenContainer>
    );
  if (mode === 'paste')
    return (
      <ScreenContainer contentContainerStyle={styles.screenContent}>
        <PageHeader title={t('expense.pasteMode')} />
        <Card style={styles.prepareCard}>
          <View style={[styles.prepareIcon, { backgroundColor: palette.primaryLight }]}>
            <ClipboardPaste color={palette.primary} size={34} />
          </View>
          <AppText variant="screenTitle" style={styles.centerText}>
            {t('expense.pasteTitle')}
          </AppText>
          <AppText color={palette.textSecondary} style={styles.centerText}>
            {t('expense.pasteBody')}
          </AppText>
          <AppButton
            title={t('expense.pasteAction')}
            size="lg"
            loading={loading}
            onPress={() => void create('scan', 'paste')}
          />
          {error ? <AppText color={palette.danger}>{error}</AppText> : null}
        </Card>
        <AppButton
          title={t('expense.changeMethod')}
          variant="ghost"
          onPress={() => setMode(undefined)}
        />
      </ScreenContainer>
    );
  if (mode === 'repeat')
    return (
      <RepeatExpensePicker
        userId={auth.user!.id}
        onCancel={() => setMode(undefined)}
        onRepeated={(expenseId) =>
          router.replace({
            pathname: '/expense/[expenseId]/repeat',
            params: { expenseId },
          })
        }
      />
    );
  return (
    <ScreenContainer contentContainerStyle={styles.screenContent}>
      <PageHeader title={t('expense.manualMode')} />
      <View style={styles.formIntro}>
        <AppText variant="screenTitle">{t('expense.dataTitle')}</AppText>
        <AppText variant="bodySmall" color={palette.textSecondary}>
          {t('expense.manualIntro')}
        </AppText>
      </View>
      <Card style={styles.formCard}>
        <AppInput
          testID="expense-title"
          label={t('expense.title')}
          placeholder={t('expense.titlePlaceholder')}
          value={title}
          onChangeText={setTitle}
        />
        <MerchantPicker value={merchant} onChangeText={setMerchant} />
        <MoneyInput
          testID="expense-total"
          label={t('expense.total')}
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
              <AppText variant="label">{t('expense.quickEqualSplit')}</AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                {t('expense.quickEqualSplitHint')}
              </AppText>
            </View>
          </View>
          <View style={styles.equalPeople}>
            {previewPeople.map((person, index) => (
              <View key={person.id} style={styles.equalPerson}>
                <Avatar name={person.name} uri={person.avatar} size={42} />
                <View style={styles.equalPersonCopy}>
                  <AppText variant="bodySmall" numberOfLines={1}>
                    {person.isPayer ? t('common.you') : person.name}
                  </AppText>
                  <AppText variant="label" color={palette.primary}>
                    {formatMoney(equalPreview[index] ?? 0, auth.profile?.default_currency || 'EUR')}
                  </AppText>
                </View>
              </View>
            ))}
          </View>
          {!params.groupId ? (
            <AppText variant="caption" color={palette.textSecondary}>
              {t('expense.addPeopleNext')}
            </AppText>
          ) : groupQuery.isLoading ? (
            <AppText variant="caption" color={palette.textSecondary}>
              {t('expense.loadingGroupPeople')}
            </AppText>
          ) : null}
        </View>
        {error ? <AppText color={palette.danger}>{error}</AppText> : null}
        <AppButton
          title={t('expense.createDraft')}
          size="lg"
          loading={loading}
          onPress={() => void create('participants')}
        />
      </Card>
    </ScreenContainer>
  );
}

function RepeatExpensePicker({
  userId,
  onCancel,
  onRepeated,
}: {
  userId: string;
  onCancel: () => void;
  onRepeated: (expenseId: string) => void;
}) {
  const palette = useAppColors();
  const { formatDate, t } = useI18n();
  const [selected, setSelected] = useState<RepeatableExpense>();
  const [error, setError] = useState<string>();
  const query = useQuery({
    queryKey: ['repeatable-expenses', userId],
    queryFn: () => repeatExpenseRepository.list(userId),
  });
  const repeat = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error(t('repeat.selectError'));
      return repeatExpenseRepository.repeat(selected.id);
    },
    onSuccess: (result) => onRepeated(result.expenseId),
    onError: (cause) =>
      setError(
        readableError(cause).code === 'UNKNOWN'
          ? readableError(cause).message
          : t('repeat.prepareError'),
      ),
  });

  return (
    <ScreenContainer contentContainerStyle={styles.screenContent}>
      <PageHeader title={t('repeat.pickerTitle')} />
      <Card variant="flat" style={[styles.repeatIntro, { backgroundColor: palette.primaryLight }]}>
        <View style={[styles.prepareIcon, { backgroundColor: palette.surface }]}>
          <Repeat2 color={palette.primary} size={30} />
        </View>
        <View style={styles.flex}>
          <AppText variant="heading">{t('repeat.pickerIntroTitle')}</AppText>
          <AppText variant="bodySmall" color={palette.textSecondary}>
            {t('repeat.pickerIntroBody')}
          </AppText>
        </View>
      </Card>

      {query.isPending ? (
        <View style={styles.repeatLoading}>
          <ActivityIndicator color={palette.primary} />
          <AppText variant="bodySmall" color={palette.textSecondary}>
            {t('repeat.pickerLoading')}
          </AppText>
        </View>
      ) : query.isError ? (
        <ErrorState body={t('repeat.pickerLoadError')} onRetry={() => void query.refetch()} />
      ) : !query.data?.length ? (
        <EmptyState
          title={t('repeat.pickerEmptyTitle')}
          body={t('repeat.pickerEmptyBody')}
          action={
            <AppButton title={t('repeat.otherMethod')} variant="outline" onPress={onCancel} />
          }
        />
      ) : (
        <View style={styles.repeatList}>
          {query.data.map((expense) => {
            const isSelected = selected?.id === expense.id;
            return (
              <Pressable
                key={expense.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={`${t('expense.repeatMode')}: ${expense.title}`}
                onPress={() => {
                  setSelected(expense);
                  setError(undefined);
                }}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Card
                  variant="outlined"
                  style={[
                    styles.repeatOption,
                    {
                      borderColor: isSelected ? palette.primary : palette.border,
                      backgroundColor: isSelected ? palette.primaryLight : palette.surface,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.repeatOptionIcon,
                      { backgroundColor: isSelected ? palette.primary : palette.surface },
                    ]}
                  >
                    <ReceiptText color={isSelected ? palette.white : palette.primary} size={21} />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="label" numberOfLines={1}>
                      {expense.title}
                    </AppText>
                    <AppText variant="bodySmall" color={palette.textSecondary} numberOfLines={1}>
                      {expense.merchant_name || t('repeat.noMerchant')}
                      {expense.group?.name ? ` · ${expense.group.name}` : ''}
                    </AppText>
                    <AppText variant="caption" color={palette.textMuted}>
                      {formatDate(expense.occurred_at)}
                      {' · '}
                      {t(expense.itemCount === 1 ? 'repeat.itemCountOne' : 'repeat.itemCountMany', {
                        count: expense.itemCount,
                      })}
                      {' · '}
                      {t(
                        expense.participantCount === 1
                          ? 'repeat.personCountOne'
                          : 'repeat.personCountMany',
                        { count: expense.participantCount },
                      )}
                    </AppText>
                  </View>
                  <CurrencyAmount
                    cents={expense.total_cents}
                    currency={expense.currency}
                    variant="label"
                    color={isSelected ? palette.primary : palette.textPrimary}
                  />
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}

      {error ? <AppText color={palette.dangerInk}>{error}</AppText> : null}
      {query.data?.length ? (
        <>
          <AppButton
            title={t('repeat.repeatAction')}
            size="lg"
            disabled={!selected}
            loading={repeat.isPending}
            leftIcon={<Repeat2 color={palette.white} size={20} />}
            onPress={() => repeat.mutate()}
          />
          <AppText variant="caption" color={palette.textSecondary} style={styles.centerText}>
            {t('repeat.pickerFootnote')}
          </AppText>
          <AppButton title={t('repeat.changeMethod')} variant="ghost" onPress={onCancel} />
        </>
      ) : null}
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
  repeatIntro: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  repeatLoading: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  repeatList: { gap: spacing.sm },
  repeatOption: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
  },
  repeatOptionIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
