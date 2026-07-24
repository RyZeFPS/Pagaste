import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ShieldCheck, UsersRound } from 'lucide-react-native';
import { AppButton, AppText, Card, LoadingSkeleton, ScreenContainer } from '@/components/ui';
import { BrandLogo } from '@/components/brand-logo';
import { LoadingRegion } from '@/components/loading-skeletons';
import { repository } from '@/lib/repository';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { radii, spacing } from '@/theme';

export default function InviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const auth = useAuth();
  const router = useRouter();
  const palette = useAppColors();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <ScreenContainer publicPage contentContainerStyle={{ justifyContent: 'center' }}>
      <View style={styles.brand}>
        <BrandLogo variant="horizontal" width={190} testID="pagaste-brand-logo" />
        <AppText variant="caption" color={palette.textSecondary}>
          Escanea, reparte y cobra.
        </AppText>
      </View>
      <Card style={styles.card}>
        <View style={[styles.icon, { backgroundColor: palette.primaryLight }]}>
          <UsersRound color={palette.primary} size={34} />
        </View>
        <AppText variant="screenTitle" style={styles.centerText}>
          Te han invitado a Pagaste
        </AppText>
        <AppText color={palette.textSecondary} style={styles.centerText}>
          Inicia sesión para aceptar la invitación y participar en el grupo. El enlace no muestra
          datos del grupo antes de identificarte.
        </AppText>
        <View style={styles.privacy}>
          <ShieldCheck color={palette.successInk} size={18} />
          <AppText variant="bodySmall" color={palette.successInk}>
            Invitación privada y segura
          </AppText>
        </View>
        {auth.loading ? (
          <LoadingRegion
            label="Comprobando tu sesión"
            testID="invite-auth-skeleton"
            style={styles.action}
          >
            <LoadingSkeleton height={56} borderRadius={radii.control} />
          </LoadingRegion>
        ) : !auth.session ? (
          <AppButton
            title="Iniciar sesión"
            size="lg"
            fullWidth
            onPress={() =>
              router.push({ pathname: '/(auth)/login', params: { next: `/invite/${token}` } })
            }
          />
        ) : (
          <AppButton
            title="Aceptar invitación"
            size="lg"
            fullWidth
            loading={loading}
            onPress={async () => {
              setLoading(true);
              setError(undefined);
              try {
                const result = await repository.acceptInvite(token);
                router.replace(`/group/${result.groupId}`);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'La invitación no es válida.');
              } finally {
                setLoading(false);
              }
            }}
          />
        )}
        {error ? <AppText color={palette.dangerInk}>{error}</AppText> : null}
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', gap: spacing.xs },
  card: { alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.xxl },
  icon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  action: { width: '100%' },
});
