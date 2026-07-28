import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, CheckSquare2, Square } from 'lucide-react-native';
import { BrandLogo } from '@/components/brand-logo';
import {
  AppButton,
  AppInput,
  AppText,
  Card,
  EmptyState,
  ErrorState,
  ScreenContainer,
} from '@/components/ui';
import { ScreenLoadingSkeleton } from '@/components/loading-skeletons';
import {
  collaborationSelectionTotal,
  toggleCollaborationItem,
} from '@/domain/expense-collaboration';
import { collaborationCopy } from '@/features/collaboration/i18n';
import { normalizeLocale, useI18n } from '@/i18n';
import { repository } from '@/lib/repository';
import { useAppColors } from '@/providers/app-providers';
import { radii, spacing } from '@/theme';

export default function PublicExpenseCollaborationScreen() {
  const { token, lang } = useLocalSearchParams<{ token: string; lang?: string }>();
  const palette = useAppColors();
  const { locale, setLocale, formatMoney } = useI18n();
  const copy = collaborationCopy(locale);
  const [displayName, setDisplayName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (lang) setLocale(normalizeLocale(lang));
  }, [lang, setLocale]);

  const query = useQuery({
    queryKey: ['public-expense-collaboration', token],
    queryFn: () => repository.publicExpenseCollaboration(token),
    enabled: Boolean(token),
    retry: 1,
  });
  const selectedTotal = useMemo(
    () => (query.data ? collaborationSelectionTotal(query.data, selected) : 0),
    [query.data, selected],
  );
  const submit = useMutation({
    mutationFn: async () => {
      const name = displayName.trim();
      if (!name) throw new Error('NAME_REQUIRED');
      if (!selected.length) throw new Error('SELECTION_REQUIRED');
      return repository.submitExpenseCollaboration(token, name, selected);
    },
    onError: (cause) => {
      setError(
        cause instanceof Error && cause.message === 'NAME_REQUIRED'
          ? copy.nameError
          : cause instanceof Error && cause.message === 'SELECTION_REQUIRED'
            ? copy.selectionError
            : copy.submitError,
      );
    },
  });

  if (query.isPending && !query.data) return <ScreenLoadingSkeleton variant="publicClaim" />;
  if (!query.data || query.isError) {
    return (
      <ScreenContainer publicPage>
        <View style={styles.brand}>
          <BrandLogo variant="horizontal" width={180} />
        </View>
        <ErrorState title={copy.invalidTitle} body={copy.invalidBody} />
      </ScreenContainer>
    );
  }
  if (submit.isSuccess) {
    return (
      <ScreenContainer publicPage contentContainerStyle={styles.successPage}>
        <BrandLogo variant="horizontal" width={180} />
        <View style={[styles.successIcon, { backgroundColor: palette.successLight }]}>
          <CheckCircle2 color={palette.successInk} size={40} />
        </View>
        <AppText variant="screenTitle" style={styles.center}>
          {copy.sentTitle}
        </AppText>
        <AppText color={palette.textSecondary} style={styles.center}>
          {copy.sentBody}
        </AppText>
      </ScreenContainer>
    );
  }

  const collaboration = query.data;

  return (
    <ScreenContainer publicPage contentContainerStyle={styles.content}>
      <View style={styles.brand}>
        <BrandLogo variant="horizontal" width={180} />
        <AppText variant="caption" color={palette.textSecondary}>
          {copy.publicPrivate}
        </AppText>
      </View>

      <Card style={[styles.hero, { backgroundColor: palette.primaryLight }]}>
        <AppText variant="screenTitle">{copy.publicTitle}</AppText>
        <AppText color={palette.textSecondary}>{copy.publicIntro}</AppText>
        <View style={styles.expenseMeta}>
          <AppText variant="heading">{collaboration.title}</AppText>
          {collaboration.merchantName ? (
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {collaboration.merchantName}
            </AppText>
          ) : null}
        </View>
      </Card>

      {!collaboration.items.length ? (
        <EmptyState title={copy.noProductsTitle} body={copy.noProductsBody} />
      ) : (
        <>
          <AppInput
            label={copy.name}
            placeholder={copy.namePlaceholder}
            value={displayName}
            onChangeText={(value) => {
              setDisplayName(value);
              setError(undefined);
            }}
            maxLength={80}
            autoComplete="name"
            textContentType="name"
          />

          <View style={styles.sectionHeading}>
            <AppText variant="sectionTitle">{copy.selection}</AppText>
            <AppText variant="label" color={palette.primary}>
              {selected.length}
            </AppText>
          </View>
          <View style={styles.items}>
            {collaboration.items.map((item) => {
              const checked = selected.includes(item.id);
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  onPress={() => {
                    setSelected((current) => toggleCollaborationItem(current, item.id));
                    setError(undefined);
                  }}
                  style={({ pressed }) => [
                    styles.item,
                    {
                      backgroundColor: checked ? palette.primaryLight : palette.surface,
                      borderColor: checked ? palette.primary : palette.border,
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  {checked ? (
                    <CheckSquare2 color={palette.primary} size={24} />
                  ) : (
                    <Square color={palette.textMuted} size={24} />
                  )}
                  <View style={styles.flex}>
                    <AppText variant="label">{item.name}</AppText>
                    {item.quantity !== 1 ? (
                      <AppText variant="caption" color={palette.textSecondary}>
                        ×{item.quantity}
                      </AppText>
                    ) : null}
                  </View>
                  <AppText variant="label">
                    {formatMoney(item.lineTotalCents, collaboration.currency)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <Card variant="flat" style={[styles.total, { backgroundColor: palette.background }]}>
            <AppText variant="label">{copy.selectedTotal}</AppText>
            <AppText variant="metric" color={palette.primary}>
              {formatMoney(selectedTotal, collaboration.currency)}
            </AppText>
          </Card>

          {error ? <AppText color={palette.danger}>{error}</AppText> : null}
          <AppButton
            title={copy.submit}
            disabled={!displayName.trim() || !selected.length}
            loading={submit.isPending}
            onPress={() => submit.mutate()}
          />
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  brand: { alignItems: 'center', gap: spacing.xs },
  hero: { gap: spacing.sm },
  expenseMeta: { gap: spacing.xxs, marginTop: spacing.sm },
  sectionHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  items: { gap: spacing.sm },
  item: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pressed: { opacity: 0.76 },
  total: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  successPage: { alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  successIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
