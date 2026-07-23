import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AlertTriangle, FileText, Scale } from 'lucide-react-native';
import { AppButton, AppText, Card, Divider, ListCard, ScreenContainer } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { useAppColors } from '@/providers/app-providers';
import { radii, spacing } from '@/theme';

function LegalSection({
  number,
  title,
  children,
  action,
}: {
  number: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const palette = useAppColors();
  return (
    <View style={styles.legalSection}>
      <View style={[styles.number, { backgroundColor: palette.primaryLight }]}>
        <AppText variant="caption" color={palette.primary} tabular>
          {number}
        </AppText>
      </View>
      <View style={styles.legalCopy}>
        <AppText variant="sectionTitle">{title}</AppText>
        <AppText color={palette.textSecondary}>{children}</AppText>
        {action}
      </View>
    </View>
  );
}

export default function TermsScreen() {
  const router = useRouter();
  const palette = useAppColors();

  return (
    <ScreenContainer publicPage>
      <PageHeader title="Condiciones de uso" subtitle="Versión provisional del MVP" />

      <Card
        variant="outlined"
        padding="spacious"
        style={[
          styles.notice,
          { borderColor: palette.warning, backgroundColor: palette.warningLight },
        ]}
      >
        <View style={[styles.noticeIcon, { backgroundColor: palette.surface }]}>
          <FileText color={palette.warningInk} size={24} />
        </View>
        <View style={styles.flex}>
          <AppText variant="sectionTitle" color={palette.warningInk}>
            Documento provisional
          </AppText>
          <AppText color={palette.textPrimary}>
            Estas condiciones describen el funcionamiento actual de Pagaste y deben revisarse por un
            profesional antes de publicar el servicio. Última actualización provisional: 22 de julio
            de 2026.
          </AppText>
        </View>
      </Card>

      <ListCard>
        <LegalSection number="01" title="Qué hace Pagaste">
          Pagaste ayuda a leer tickets, repartir gastos y comunicar cuánto corresponde a cada
          persona. Pagaste no es un banco, una entidad de pago ni un servicio de envío de dinero. No
          inicia transferencias, cargos ni operaciones de Bizum: cualquier pago se realiza fuera de
          Pagaste, desde el medio elegido por las personas implicadas. Tampoco lee notificaciones
          bancarias ni detecta o verifica que un pago se haya realizado.
        </LegalSection>
        <Divider inset={68} />
        <LegalSection number="02" title="Pago externo y recepción">
          Quien crea un gasto es responsable de revisar el ticket, las personas, los importes y el
          reparto antes de compartirlo. Quien recibe una solicitud consulta su parte y paga fuera de
          Pagaste; no tiene que volver ni indicar que ha pagado. Tras comprobar su propia cuenta, la
          persona que adelantó el gasto marca manualmente el cobro como recibido. Esa marca organiza
          el gasto, pero no es una comprobación ni un justificante bancario.
        </LegalSection>
        <Divider inset={68} />
        <LegalSection number="03" title="Enlaces privados">
          Cada solicitud usa un enlace individual que permite ver y actuar sobre la parte asignada
          sin crear una cuenta. Quien tenga el enlace puede abrirlo: no lo publiques ni lo reenvíes.
          El creador del gasto puede revocarlo, y Pagaste puede limitarlo o hacerlo caducar por
          seguridad. El teléfono de cobro solo se muestra si su titular lo ha guardado y ha
          autorizado expresamente compartirlo en esos enlaces.
        </LegalSection>
        <Divider inset={68} />
        <LegalSection number="04" title="Uso aceptable">
          Debes usar información veraz y contar con base legítima para compartir los datos de otras
          personas. No puedes usar Pagaste para fraude, suplantación, acoso, cobros ilícitos,
          contenido dañino ni para intentar eludir límites, acceder a datos ajenos o interferir con
          el servicio. Podemos restringir el acceso ante abuso o riesgo para otras personas.
        </LegalSection>
        <Divider inset={68} />
        <LegalSection number="05" title="Responsabilidad y disponibilidad">
          El OCR y los repartos automáticos pueden equivocarse; debes comprobarlos antes de enviar
          una solicitud. Pagaste no responde de acuerdos entre usuarios, pagos externos, comisiones
          bancarias, obligaciones fiscales ni errores introducidos por una persona. Durante el MVP,
          el servicio puede cambiar o interrumpirse y no se garantiza disponibilidad continua. Nada
          de esto limita responsabilidades que la ley aplicable no permita excluir.
        </LegalSection>
        <Divider inset={68} />
        <LegalSection
          number="06"
          title="Privacidad y cambios"
          action={
            <AppButton
              title="Leer privacidad"
              variant="outline"
              size="lg"
              fullWidth
              onPress={() => router.push('/settings/privacy')}
            />
          }
        >
          El tratamiento de datos se explica en la información de privacidad. Si estas condiciones
          cambian de forma relevante, se mostrará una versión actualizada antes de que resulte
          aplicable.
        </LegalSection>
      </ListCard>

      <Card
        variant="outlined"
        padding="spacious"
        style={[
          styles.notice,
          { borderColor: palette.warning, backgroundColor: palette.warningLight },
        ]}
      >
        <View style={[styles.noticeIcon, { backgroundColor: palette.surface }]}>
          <AlertTriangle color={palette.warningInk} size={24} />
        </View>
        <View style={styles.flex}>
          <View style={styles.contactHeading}>
            <Scale color={palette.warningInk} size={19} />
            <AppText variant="sectionTitle" color={palette.warningInk}>
              Contacto legal
            </AppText>
          </View>
          <AppText color={palette.textSecondary}>
            PLACEHOLDER NO OPERATIVO — sustituir antes de producción: legal@pagaste.example. También
            deben añadirse aquí la identidad legal, domicilio y canal efectivo de atención.
          </AppText>
        </View>
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: spacing.xs },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  noticeIcon: {
    width: 46,
    height: 46,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legalSection: {
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  number: {
    width: 40,
    height: 32,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legalCopy: { flex: 1, gap: spacing.md },
  contactHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
