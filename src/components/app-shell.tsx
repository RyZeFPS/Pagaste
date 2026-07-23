import { useEffect, type PropsWithChildren, type ReactNode } from 'react';
import { useRouter, useSegments } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { AppText, ErrorState, IconButton } from '@/components/ui';
import { AppBootSkeleton } from '@/components/loading-skeletons';
import { spacing } from '@/theme';

export function RequireAuth({ children }: PropsWithChildren) {
  const auth = useAuth();
  const router = useRouter();
  const segments = useSegments();
  useEffect(() => {
    if (!auth.loading && auth.configured && !auth.session) router.replace('/(auth)/login');
    if (!auth.loading && auth.session && !auth.profile?.onboarding_completed)
      router.replace('/(auth)/onboarding');
  }, [auth.configured, auth.loading, auth.profile?.onboarding_completed, auth.session, router]);
  if (auth.loading)
    return <AppBootSkeleton showTabBar={(segments[0] as string | undefined) === '(tabs)'} />;
  if (!auth.configured)
    return (
      <ErrorState
        title="Falta configurar Pagaste"
        body="Añade las variables públicas de Supabase para conectar la aplicación."
      />
    );
  if (!auth.session || !auth.profile?.onboarding_completed) return null;
  return children;
}

export function PageHeader({
  title,
  subtitle,
  back = true,
  action,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  action?: ReactNode;
}) {
  const router = useRouter();
  const palette = useAppColors();
  return (
    <View style={styles.header}>
      <View style={styles.side}>
        {back ? (
          <IconButton
            label="Volver"
            variant="plain"
            icon={<ChevronLeft color={palette.textPrimary} size={24} strokeWidth={2} />}
            onPress={() => router.back()}
          />
        ) : null}
      </View>
      <View style={styles.heading}>
        <AppText variant="navTitle" numberOfLines={2} style={styles.title}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="bodySmall" color={palette.textSecondary} style={styles.title}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View style={[styles.side, styles.action]}>{action}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
  },
  side: { width: 72, minHeight: 44, justifyContent: 'center', alignItems: 'flex-start' },
  action: { alignItems: 'flex-end' },
  heading: { flex: 1, minWidth: 0, gap: spacing.xs, alignItems: 'center' },
  title: { textAlign: 'center' },
});
