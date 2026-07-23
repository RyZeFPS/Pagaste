import { useRouter } from 'expo-router';
import { AppButton, EmptyState, ScreenContainer } from '@/components/ui';
export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <ScreenContainer publicPage>
      <EmptyState
        title="Esta página no existe"
        body="Comprueba el enlace o vuelve al inicio."
        action={<AppButton title="Volver al inicio" onPress={() => router.replace('/')} />}
      />
    </ScreenContainer>
  );
}
