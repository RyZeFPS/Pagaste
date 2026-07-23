import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  FileCheck2,
  FileText,
  Link2,
  Phone,
  ScanText,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react-native';
import { AppButton, AppText, Card, Divider, ListCard, ScreenContainer } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { useAppColors } from '@/providers/app-providers';
import { radii, spacing } from '@/theme';

function PrivacySection({
  icon,
  title,
  children,
  primaryText,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  primaryText?: boolean;
}) {
  const palette = useAppColors();
  return (
    <View style={styles.section}>
      <View style={[styles.iconBubble, { backgroundColor: palette.primaryLight }]}>{icon}</View>
      <View style={styles.sectionCopy}>
        <AppText variant="sectionTitle">{title}</AppText>
        <AppText color={primaryText ? palette.textPrimary : palette.textSecondary}>
          {children}
        </AppText>
      </View>
    </View>
  );
}

export default function PrivacyScreen() {
  const router = useRouter();
  const palette = useAppColors();
  return (
    <ScreenContainer publicPage>
      <PageHeader title="Privacidad" />

      <View style={[styles.hero, { backgroundColor: palette.primaryLight }]}>
        <View style={[styles.heroIcon, { backgroundColor: palette.surface }]}>
          <ShieldCheck color={palette.primary} size={30} strokeWidth={2} />
        </View>
        <View style={styles.flex}>
          <AppText variant="sectionTitle">Tus datos, bajo tu control</AppText>
          <AppText variant="bodySmall" color={palette.textSecondary}>
            Pagaste limita lo que guarda y lo que comparte con cada persona.
          </AppText>
        </View>
      </View>

      <ListCard>
        <PrivacySection
          title="Tickets privados por defecto"
          icon={<FileCheck2 color={palette.primary} size={22} />}
        >
          Las imágenes se guardan en un bucket privado. Los invitados solo reciben las líneas
          asignadas a su parte, nunca el ticket completo.
        </PrivacySection>
        <Divider inset={76} />
        <PrivacySection
          title="Enlaces individuales"
          icon={<Link2 color={palette.primary} size={22} />}
        >
          Cada enlace usa un token aleatorio. El navegador no consulta tablas directamente y nunca
          recibe hashes, correos ni identificadores internos innecesarios.
        </PrivacySection>
        <Divider inset={76} />
        <PrivacySection
          title="Tu teléfono, solo con permiso"
          icon={<Phone color={palette.primary} size={22} />}
        >
          El teléfono de cobro es opcional. Solo aparece en tus enlaces privados cuando lo has
          guardado y activas expresamente «Mostrarlo en mis solicitudes». Puedes retirar ese permiso
          desde Cuenta y datos; Pagaste no lo usa para iniciar ni verificar pagos.
        </PrivacySection>
        <Divider inset={76} />
        <PrivacySection title="OCR" icon={<ScanText color={palette.primary} size={22} />}>
          Las respuestas completas del OCR y las imágenes no se guardan en Secure Store. Tus tickets
          no se usan para entrenar modelos.
        </PrivacySection>
        <Divider inset={76} />
        <PrivacySection
          title="Tus derechos"
          icon={<UserRoundCheck color={palette.primary} size={22} />}
          primaryText
        >
          Desde Cuenta y datos puedes exportar un resumen o solicitar la eliminación de la cuenta.
        </PrivacySection>
      </ListCard>

      <Card padding="spacious" style={styles.actionsCard}>
        <View style={styles.actionHeading}>
          <View style={[styles.iconBubble, { backgroundColor: palette.successLight }]}>
            <FileText color={palette.successInk} size={22} />
          </View>
          <View style={styles.flex}>
            <AppText variant="sectionTitle">Documentos y controles</AppText>
            <AppText color={palette.textSecondary}>
              Consulta las condiciones provisionales o abre los controles de tu cuenta. Para
              gestionar datos personales tendrás que iniciar sesión.
            </AppText>
          </View>
        </View>
        <AppButton
          title="Condiciones de uso"
          variant="outline"
          size="lg"
          fullWidth
          onPress={() => router.push('./terms')}
        />
        <AppButton
          title="Cuenta y datos"
          variant="secondary"
          size="lg"
          fullWidth
          onPress={() => router.push('/settings/account')}
        />
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: {
    borderRadius: radii.card,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  heroIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  iconBubble: {
    width: 44,
    height: 44,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionCopy: { flex: 1, gap: spacing.xs },
  actionsCard: { gap: spacing.md },
  actionHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
});
