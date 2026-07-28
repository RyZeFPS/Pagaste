const groupedClaimsCopy = {
  es: {
    sectionTitle: 'Cobros agrupados',
    sectionBody:
      'Comparte un único resumen cuando una misma persona tenga varios gastos pendientes.',
    expenseCount: (count: number) => `${count} gastos pendientes`,
    share: 'Compartir resumen',
    shareA11y: (name: string) => `Compartir cobros pendientes de ${name}`,
    summaryTitle: (name: string) => `Cobros pendientes de ${name}`,
    summaryTotal: (amount: string, count: number) =>
      `Total pendiente: ${amount} en ${count} gastos`,
    summaryMovements: 'Desglose',
    summaryItem: (date: string, title: string, amount: string) => `${date} · ${title} · ${amount}`,
    summaryContext: (merchant: string | null, group: string | null) => {
      const values = [merchant, group].filter(Boolean);
      return values.length ? values.join(' · ') : null;
    },
    summaryFooter:
      'Pagaste no procesa ni verifica el pago. Cada cobro conserva su estado independiente.',
    shareError: 'No hemos podido abrir el menú para compartir.',
  },
  en: {
    sectionTitle: 'Grouped collections',
    sectionBody: 'Share one summary when the same person has several outstanding expenses.',
    expenseCount: (count: number) => `${count} outstanding expenses`,
    share: 'Share summary',
    shareA11y: (name: string) => `Share outstanding collections for ${name}`,
    summaryTitle: (name: string) => `Outstanding collections for ${name}`,
    summaryTotal: (amount: string, count: number) =>
      `Outstanding total: ${amount} across ${count} expenses`,
    summaryMovements: 'Breakdown',
    summaryItem: (date: string, title: string, amount: string) => `${date} · ${title} · ${amount}`,
    summaryContext: (merchant: string | null, group: string | null) => {
      const values = [merchant, group].filter(Boolean);
      return values.length ? values.join(' · ') : null;
    },
    summaryFooter:
      'Pagaste does not process or verify payments. Each collection keeps its independent status.',
    shareError: 'We could not open the share menu.',
  },
} as const;

export function getGroupedClaimsCopy(locale: string) {
  return locale === 'en' ? groupedClaimsCopy.en : groupedClaimsCopy.es;
}
