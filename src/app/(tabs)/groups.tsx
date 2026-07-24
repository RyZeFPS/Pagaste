import { Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown, FadeInRight, ReduceMotion } from 'react-native-reanimated';
import { ChevronRight, Plus } from 'lucide-react-native';
import {
  AppButton,
  AppText,
  Avatar,
  Card,
  EmptyState,
  ErrorState,
  ScreenContainer,
} from '@/components/ui';
import { ListRowsSkeleton } from '@/components/loading-skeletons';
import { ThreeDIcon } from '@/components/three-d-icon';
import { repository } from '@/lib/repository';
import type { Group } from '@/lib/models';
import { useAppColors } from '@/providers/app-providers';
import { radii, shadows, spacing } from '@/theme';

const groupTypeLabels: Record<string, string> = {
  friends: 'Amigos',
  household: 'Hogar',
  couple: 'Pareja',
  trip: 'Viaje',
  work: 'Trabajo',
};

const headerEnter = FadeInDown.duration(330).reduceMotion(ReduceMotion.System);
const cardEnter = (index: number) =>
  FadeInRight.duration(360)
    .delay(65 + Math.min(index, 5) * 55)
    .reduceMotion(ReduceMotion.System);

export default function GroupsScreen() {
  const router = useRouter();
  const palette = useAppColors();
  const query = useQuery({
    queryKey: ['groups'],
    queryFn: repository.listGroups,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });

  return (
    <ScreenContainer floatingTabs>
      <View style={styles.screen}>
        <Animated.View entering={headerEnter} style={styles.header}>
          <View style={styles.headerCopy}>
            <AppText variant="display" style={styles.title}>
              Grupos
            </AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              Ten a mano a las personas con las que más compartes.
            </AppText>
          </View>
          <View style={styles.headerActions}>
            <AppButton
              title="Nuevo"
              variant="ghost"
              size="sm"
              leftIcon={<Plus color={palette.primary} size={18} strokeWidth={2.2} />}
              onPress={() => router.push('/group/new')}
            />
          </View>
        </Animated.View>

        {query.isPending && query.data === undefined ? (
          <Animated.View entering={cardEnter(0)}>
            <ListRowsSkeleton count={3} rowHeight={112} />
          </Animated.View>
        ) : query.isError ? (
          <Animated.View entering={cardEnter(0)}>
            <Card variant="grouped">
              <ErrorState
                body="No hemos podido cargar tus grupos."
                onRetry={() => void query.refetch()}
              />
            </Card>
          </Animated.View>
        ) : !query.data?.length ? (
          <Animated.View entering={cardEnter(0)}>
            <Card variant="grouped" style={styles.emptyCard}>
              <View style={[styles.emptyIcon, { backgroundColor: palette.primaryLight }]}>
                <ThreeDIcon name="groupPeople" size={64} accessibilityLabel="Grupo de personas" />
              </View>
              <EmptyState
                title="Tu gente, siempre a mano"
                body="Crea un grupo para añadir a las personas habituales en segundos."
                action={
                  <AppButton
                    title="Crear mi primer grupo"
                    size="md"
                    onPress={() => router.push('/group/new')}
                  />
                }
              />
            </Card>
          </Animated.View>
        ) : (
          <View style={styles.groupList}>
            {query.data.map((group, index) => (
              <Animated.View key={group.id} entering={cardEnter(index)}>
                <GroupPreviewCard
                  group={group}
                  index={index}
                  onPress={() => router.push(`/group/${group.id}`)}
                />
              </Animated.View>
            ))}
          </View>
        )}
      </View>
    </ScreenContainer>
  );
}

function GroupPreviewCard({
  group,
  index,
  onPress,
}: {
  group: Group;
  index: number;
  onPress: () => void;
}) {
  const palette = useAppColors();
  const type = group.type.toLowerCase();
  const tone =
    type === 'household'
      ? { surface: palette.successLight, accent: palette.success }
      : type === 'couple'
        ? { surface: palette.dangerLight, accent: palette.danger }
        : type === 'trip'
          ? { surface: palette.warningLight, accent: palette.warning }
          : { surface: palette.primaryLight, accent: palette.primary };
  const typeLabel = groupTypeLabels[type] || 'Grupo compartido';

  return (
    <Card
      variant="elevated"
      padding="none"
      style={[styles.groupCard, { borderColor: palette.border, shadowColor: tone.accent }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Abrir grupo ${group.name}`}
        onPress={onPress}
        style={({ pressed }) => [styles.groupCardPressable, pressed && styles.groupCardPressed]}
      >
        <View pointerEvents="none" style={[styles.cardRail, { backgroundColor: tone.accent }]} />
        <View
          pointerEvents="none"
          style={[
            styles.cardGlow,
            index % 2 ? styles.cardGlowLower : styles.cardGlowUpper,
            { backgroundColor: tone.surface },
          ]}
        />
        <View style={[styles.avatarStage, { backgroundColor: tone.surface }]}>
          <Avatar name={group.name} uri={group.avatar_url} size={56} />
        </View>
        <View style={styles.groupCopy}>
          <View style={styles.groupTitleRow}>
            <AppText numberOfLines={1} style={styles.groupName}>
              {group.name}
            </AppText>
            <View style={[styles.currencyChip, { backgroundColor: tone.surface }]}>
              <View style={[styles.currencyDot, { backgroundColor: tone.accent }]} />
              <AppText variant="caption" color={palette.textPrimary} style={styles.currency}>
                {group.currency}
              </AppText>
            </View>
          </View>
          <AppText numberOfLines={1} variant="label" color={tone.accent}>
            {typeLabel}
          </AppText>
          <AppText numberOfLines={1} variant="caption" color={palette.textSecondary}>
            {group.description?.trim() || 'Toca para ver gastos, personas y racha'}
          </AppText>
        </View>
        <View style={[styles.chevronBubble, { backgroundColor: tone.surface }]}>
          <ChevronRight color={tone.accent} size={20} strokeWidth={2} />
        </View>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { width: '100%', gap: spacing.xl },
  header: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerCopy: { minWidth: 0, flex: 1, gap: spacing.xs },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { letterSpacing: -0.7 },
  emptyCard: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
    alignItems: 'center',
    gap: 0,
  },
  emptyIcon: {
    width: 70,
    height: 70,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupList: { gap: spacing.md },
  groupCard: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    shadowOpacity: shadows.card.shadowOpacity,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 7 },
  },
  groupCardPressable: {
    position: 'relative',
    minHeight: 116,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    paddingVertical: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    overflow: 'hidden',
  },
  groupCardPressed: { opacity: 0.86, transform: [{ scale: 0.992 }] },
  cardRail: { position: 'absolute', left: 0, top: 18, bottom: 18, width: 5, borderRadius: 3 },
  cardGlow: { position: 'absolute', width: 112, height: 112, borderRadius: 56, opacity: 0.58 },
  cardGlowUpper: { right: -50, top: -54 },
  cardGlowLower: { right: -46, bottom: -62 },
  avatarStage: {
    width: 68,
    height: 68,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupCopy: { minWidth: 0, flex: 1, gap: 3 },
  groupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  groupName: { minWidth: 0, flex: 1, fontSize: 18, lineHeight: 23, fontWeight: '700' },
  currencyChip: {
    minHeight: 26,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  currencyDot: { width: 6, height: 6, borderRadius: 3 },
  currency: { fontVariant: ['tabular-nums'], fontWeight: '700' },
  chevronBubble: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
