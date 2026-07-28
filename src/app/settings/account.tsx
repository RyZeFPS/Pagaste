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
import { useI18n } from '@/i18n';
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
  const { locale, t } = useI18n();
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
  const messageIsSuccess = message === t('account.saved');
  const deleteKeyword = locale === 'en' ? 'DELETE' : 'ELIMINAR';
  return (
    <ScreenContainer>
      <PageHeader title={t('settings.accountTitle')} />

      <Card padding="spacious" style={styles.card}>
        <View style={styles.sectionHeading}>
          <View style={[styles.iconBubble, { backgroundColor: palette.primaryLight }]}>
            <UserRound color={palette.primary} size={22} />
          </View>
          <View style={styles.flex}>
            <AppText variant="sectionTitle">{t('account.profileTitle')}</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {t('account.profileBody')}
            </AppText>
          </View>
        </View>
        <View style={styles.fields}>
          <AppInput label={t('account.name')} value={name} onChangeText={setName} />
          <AppInput label={t('account.email')} value={auth.user?.email ?? ''} editable={false} />
        </View>

        <View style={[styles.paymentSection, { borderTopColor: palette.divider }]}>
          <View style={styles.sectionHeading}>
            <View style={[styles.iconBubble, { backgroundColor: palette.successLight }]}>
              <Phone color={palette.successInk} size={22} />
            </View>
            <View style={styles.flex}>
              <AppText variant="sectionTitle">{t('account.phoneTitle')}</AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                {t('account.phoneBody')}
              </AppText>
            </View>
          </View>
          <AppInput
            testID="payment-phone"
            label={t('account.phoneLabel')}
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
            hint={t('account.phoneHint')}
          />
          <View
            style={[
              styles.consentRow,
              { backgroundColor: palette.background, borderColor: palette.border },
            ]}
          >
            <View style={styles.consentCopy}>
              <AppText variant="label">{t('account.sharePhone')}</AppText>
              <AppText variant="caption" color={palette.textSecondary}>
                {t('account.sharePhoneBody')}
              </AppText>
            </View>
            <Switch
              testID="share-payment-phone"
              accessibilityLabel={t('account.sharePhoneA11y')}
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
            {t('account.paymentDisclaimer')}
          </AppText>
        </View>
        <AppButton
          title={t('account.save')}
          size="lg"
          fullWidth
          loading={saving}
          onPress={async () => {
            if (name.trim().length < 2) {
              setMessage(t('account.invalidName'));
              return;
            }
            const normalizedPhone = normalizePaymentPhoneE164(paymentPhone);
            const nextPhoneError = validatePaymentPhone(paymentPhone, sharePaymentPhone);
            if (nextPhoneError) {
              setPhoneError(nextPhoneError);
              setMessage(t('account.reviewPhone'));
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
              setMessage(t('account.saved'));
            } catch {
              setMessage(t('account.saveError'));
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
            <AppText variant="sectionTitle">{t('account.exportTitle')}</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {t('account.exportBody')}
            </AppText>
          </View>
        </View>
        <AppText color={palette.textSecondary}>{t('account.exportDescription')}</AppText>
        <AppButton
          title={t('account.exportAction')}
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
              {t('account.deleteTitle')}
            </AppText>
            <AppText variant="caption" color={palette.dangerInk}>
              {t('account.irreversible')}
            </AppText>
          </View>
        </View>
        <AppText color={palette.textPrimary}>{t('account.deleteBody')}</AppText>
        <AppInput
          label={t('account.deleteConfirm', { keyword: deleteKeyword })}
          value={deleteConfirmation}
          onChangeText={setDeleteConfirmation}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <AppButton
          title={t('account.deleteAction')}
          variant="danger"
          size="lg"
          fullWidth
          disabled={deleteConfirmation !== deleteKeyword}
          loading={deleting}
          onPress={async () => {
            if (deleteConfirmation !== deleteKeyword) return;
            setDeleting(true);
            setMessage(undefined);
            try {
              await repository.deleteAccount();
              await auth.signOut().catch(() => undefined);
              router.replace('/(auth)/login');
            } catch {
              setMessage(t('account.deleteError'));
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
