import { Redirect } from 'expo-router';
import { useAuth } from '@/providers/auth-provider';
import { ErrorState, ScreenContainer } from '@/components/ui';
import { AppBootSkeleton } from '@/components/loading-skeletons';
import { useI18n } from '@/i18n';

export default function EntryScreen() {
  const auth = useAuth();
  const { t } = useI18n();
  if (auth.loading) return <AppBootSkeleton />;
  if (!auth.configured)
    return (
      <ScreenContainer>
        <ErrorState title={t('config.title')} body={t('config.body')} />
      </ScreenContainer>
    );
  if (!auth.session) return <Redirect href="/(auth)/login" />;
  if (!auth.profile?.onboarding_completed) return <Redirect href="/(auth)/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
