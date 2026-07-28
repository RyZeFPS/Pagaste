import { useRouter } from 'expo-router';
import { AppButton, EmptyState, ScreenContainer } from '@/components/ui';
import { useI18n } from '@/i18n';
export default function NotFoundScreen() {
  const router = useRouter();
  const { t } = useI18n();
  return (
    <ScreenContainer publicPage>
      <EmptyState
        title={t('notFound.title')}
        body={t('notFound.body')}
        action={<AppButton title={t('notFound.action')} onPress={() => router.replace('/')} />}
      />
    </ScreenContainer>
  );
}
