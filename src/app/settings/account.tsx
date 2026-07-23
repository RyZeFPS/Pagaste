import { Share, StyleSheet, Switch, View } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Download, Phone, ShieldCheck, Trash2, UserRound } from 'lucide-react-native';
import { AppButton, AppInput, AppText, Card, ScreenContainer } from '@/components/ui';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import {
  isValidPaymentPhoneE164,
  normalizePaymentPhoneE164,
  validatePaymentPhone,
} from '@/domain/payment-phone';
import { repository } from '@/lib/repository';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { radii, spacing } from '@/theme';

export default function AccountScreen() {
  return (
    <RequireAuth>
      <AccountContent />
    </RequireAuth>
  );
}
function AccountContent() {
  const auth = useAuth();
  const router = useRouter();
  const palette = useAppColors();
  const [name, setName] = useState(auth.profile?.display_name ?? '');
  const [paymentPhone, setPaymentPhone] = useState(auth.profile?.payment_phone_e164 ?? '');
  const [sharePaymentPhone, setSharePaymentPhone] = useState(
    auth.profile?.share_payment_phone ?? false,
  );
  const [phoneError, setPhoneError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [message, setMessage] = useState<string>();
  const expenses = useQuery({ queryKey: ['expenses'], queryFn: repository.listExpenses });
  const groups = useQuery({ queryKey: ['groups'], queryFn: repository.listGroups });
  const messageIsSuccess = Boolean(message?.includes('guardados'));
  return (
    <ScreenContainer>
      <PageHeader title="Cuenta y datos" />

      <Card padding="spacious" style={styles.card}>
        <View style={styles.sectionHeading}>
          <View style={[styles.iconBubble, { backgroundColor: palette.primaryLight }]}>
            <UserRound color={palette.primary} size={22} />
          </View>
          <View style={styles.flex}>
            <AppText variant="sectionTitle">Tu perfil</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              La información que verán las personas con las que repartas gastos.
            </AppText>
          </View>
        </View>
        <View style={styles.fields}>
          <AppInput label="Nombre visible" value={name} onChangeText={setName} />
          <AppInput label="Correo" value={auth.user?.email ?? ''} editable={false} />
        </View>

        <View style={[styles.paymentSection, { borderTopColor: palette.divider }]}>
          <View style={styles.sectionHeading}>
            <View style={[styles.iconBubble, { backgroundColor: palette.successLight }]}>
              <Phone color={palette.successInk} size={22} />
            </View>
            <View style={styles.flex}>
              <AppText variant="sectionTitle">Teléfono para cobrar</AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                Añádelo solo si quieres facilitar un Bizum o una transferencia fuera de Pagaste.
              </AppText>
            </View>
          </View>
          <AppInput
            testID="payment-phone"
            label="Teléfono de cobro (opcional)"
            placeholder="+34600111222"
            value={paymentPhone}
            onChangeText={(value) => {
              setPaymentPhone(value);
              setPhoneError(undefined);
              if (!normalizePaymentPhoneE164(value)) setSharePaymentPhone(false);
            }}
            keyboardType="phone-pad"
            autoComplete="tel"
            autoCorrect={false}
            error={phoneError}
            hint="Formato internacional con prefijo de país."
          />
          <View
            style={[
              styles.consentRow,
              { backgroundColor: palette.background, borderColor: palette.border },
            ]}
          >
            <View style={styles.consentCopy}>
              <AppText variant="label">Mostrarlo en mis solicitudes</AppText>
              <AppText variant="caption" color={palette.textSecondary}>
                Al activarlo autorizas que el número aparezca en cada enlace privado de cobro
                mientras esta opción siga activa.
              </AppText>
            </View>
            <Switch
              testID="share-payment-phone"
              accessibilityLabel="Mostrar mi teléfono en enlaces privados de cobro"
              value={sharePaymentPhone}
              onValueChange={(value) => {
                setMessage(undefined);
                if (value && !isValidPaymentPhoneE164(paymentPhone)) {
                  setPhoneError(validatePaymentPhone(paymentPhone, true));
                  return;
                }
                setPhoneError(undefined);
                setSharePaymentPhone(value);
              }}
              ios_backgroundColor={palette.divider}
              thumbColor={palette.surface}
              trackColor={{ false: palette.disabled, true: palette.primary }}
            />
          </View>
          <AppText variant="caption" color={palette.textSecondary}>
            Pagaste no inicia, procesa ni verifica el pago. Puedes retirar este permiso cuando
            quieras.
          </AppText>
        </View>
        <AppButton
          title="Guardar cambios"
          size="lg"
          fullWidth
          loading={saving}
          onPress={async () => {
            if (name.trim().length < 2) {
              setMessage('Escribe un nombre válido.');
              return;
            }
            const normalizedPhone = normalizePaymentPhoneE164(paymentPhone);
            const nextPhoneError = validatePaymentPhone(paymentPhone, sharePaymentPhone);
            if (nextPhoneError) {
              setPhoneError(nextPhoneError);
              setMessage('Revisa el teléfono de cobro.');
              return;
            }
            setSaving(true);
            try {
              await auth.saveProfile({
                displayName: name.trim(),
                locale: auth.profile?.locale,
                paymentPhoneE164: normalizedPhone || null,
                sharePaymentPhone: sharePaymentPhone && Boolean(normalizedPhone),
              });
              setPaymentPhone(normalizedPhone);
              setMessage('Cambios guardados.');
            } catch {
              setMessage('No se han podido guardar los cambios.');
            } finally {
              setSaving(false);
            }
          }}
        />
        {message ? (
          <View
            style={[
              styles.feedback,
              {
                backgroundColor: messageIsSuccess ? palette.successLight : palette.dangerLight,
              },
            ]}
          >
            <ShieldCheck
              color={messageIsSuccess ? palette.successInk : palette.dangerInk}
              size={18}
            />
            <AppText
              variant="bodySmall"
              color={messageIsSuccess ? palette.successInk : palette.dangerInk}
              style={styles.flex}
            >
              {message}
            </AppText>
          </View>
        ) : null}
      </Card>

      <Card padding="spacious" style={styles.card}>
        <View style={styles.sectionHeading}>
          <View style={[styles.iconBubble, { backgroundColor: palette.successLight }]}>
            <Download color={palette.successInk} size={22} />
          </View>
          <View style={styles.flex}>
            <AppText variant="sectionTitle">Exportar mis datos</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              Conserva una copia legible de la información que tienes en Pagaste.
            </AppText>
          </View>
        </View>
        <AppText color={palette.textSecondary}>
          Genera un resumen local de tu perfil, gastos y grupos visibles. No incluye enlaces
          privados ni imágenes del ticket.
        </AppText>
        <AppButton
          title="Exportar resumen"
          variant="outline"
          size="lg"
          fullWidth
          disabled={expenses.isLoading || groups.isLoading}
          onPress={() =>
            void Share.share({
              message: JSON.stringify(
                {
                  exportedAt: new Date().toISOString(),
                  profile: auth.profile,
                  expenses: expenses.data ?? [],
                  groups: groups.data ?? [],
                },
                null,
                2,
              ),
            })
          }
        />
      </Card>

      <Card
        variant="outlined"
        padding="spacious"
        style={[styles.card, { borderColor: palette.danger, backgroundColor: palette.dangerLight }]}
      >
        <View style={styles.sectionHeading}>
          <View style={[styles.iconBubble, { backgroundColor: palette.surface }]}>
            <Trash2 color={palette.dangerInk} size={22} />
          </View>
          <View style={styles.flex}>
            <AppText variant="sectionTitle" color={palette.dangerInk}>
              Eliminar cuenta
            </AppText>
            <AppText variant="caption" color={palette.dangerInk}>
              Acción irreversible
            </AppText>
          </View>
        </View>
        <AppText color={palette.textPrimary}>
          Esta acción es irreversible. Elimina tu perfil, tus grupos y gastos propios, las fotos de
          tus tickets y tus tokens de notificación. En gastos compartidos de otras personas, tu
          vínculo se anonimiza para no alterar sus cuentas.
        </AppText>
        <AppInput
          label="Escribe ELIMINAR para confirmar"
          value={deleteConfirmation}
          onChangeText={setDeleteConfirmation}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <AppButton
          title="Eliminar mi cuenta y datos"
          variant="danger"
          size="lg"
          fullWidth
          disabled={deleteConfirmation !== 'ELIMINAR'}
          loading={deleting}
          onPress={async () => {
            if (deleteConfirmation !== 'ELIMINAR') return;
            setDeleting(true);
            setMessage(undefined);
            try {
              await repository.deleteAccount();
              await auth.signOut().catch(() => undefined);
              router.replace('/(auth)/login');
            } catch {
              setMessage(
                'No se ha podido eliminar la cuenta. No repitas la acción hasta comprobar la conexión.',
              );
              setDeleting(false);
            }
          }}
        />
      </Card>
    </ScreenContainer>
  );
}
const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: spacing.lg },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconBubble: {
    width: 44,
    height: 44,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fields: { gap: spacing.md },
  paymentSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  consentRow: {
    minHeight: 84,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  consentCopy: { minWidth: 0, flex: 1, gap: spacing.xs },
  feedback: {
    minHeight: 44,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
