import { Redirect } from 'expo-router';
import { useAuth } from '@/providers/auth-provider';
import { ErrorState, ScreenContainer } from '@/components/ui';
import { AppBootSkeleton } from '@/components/loading-skeletons';

export default function EntryScreen() {
  const auth = useAuth();
  if (auth.loading) return <AppBootSkeleton />;
  if (!auth.configured)
    return (
      <ScreenContainer>
        <ErrorState
          title="Falta configurar Pagaste"
          body="Añade EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY en tu entorno."
        />
      </ScreenContainer>
    );
  if (!auth.session) return <Redirect href="/(auth)/login" />;
  if (!auth.profile?.onboarding_completed) return <Redirect href="/(auth)/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
