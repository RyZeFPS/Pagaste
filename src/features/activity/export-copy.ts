import type { Locale } from '@/i18n';

export type ActivityExportCopy = {
  reportTitle: string;
  reportSubtitle: (count: number) => string;
  generatedAt: (date: string) => string;
  overview: string;
  pendingToReceive: string;
  pendingToPay: string;
  received: string;
  issues: string;
  movements: string;
  noAmount: string;
  page: (current: number, total: number) => string;
  pdfAction: string;
  pdfHint: string;
  excelAction: string;
  excelHint: string;
  visualSummaryAction: (name: string) => string;
  visualSummaryHint: string;
  visualSummaryFooter: string;
  androidFileFallback: string;
};

const copy: Record<Locale, ActivityExportCopy> = {
  es: {
    reportTitle: 'Actividad de Pagaste',
    reportSubtitle: (count) => `${count} ${count === 1 ? 'movimiento' : 'movimientos'}`,
    generatedAt: (date) => `Generado el ${date}`,
    overview: 'Resumen',
    pendingToReceive: 'Pendiente a tu favor',
    pendingToPay: 'Pendiente por pagar',
    received: 'Recibido',
    issues: 'En revisión',
    movements: 'Movimientos',
    noAmount: '—',
    page: (current, total) => `Página ${current} de ${total}`,
    pdfAction: 'Informe PDF',
    pdfHint: 'Documento visual listo para guardar o compartir',
    excelAction: 'Abrir en Excel',
    excelHint: 'Libro XML compatible con Excel y LibreOffice',
    visualSummaryAction: (name) => `Compartir resumen visual de ${name}`,
    visualSummaryHint: 'Imagen visual con totales y movimientos de esta persona',
    visualSummaryFooter: 'Pagaste calcula, organiza y permite confirmar manualmente los cobros.',
    androidFileFallback:
      'El archivo se ha preparado. En Android se comparte este resumen en texto porque la app todavía no incluye el módulo nativo para adjuntar archivos.',
  },
  en: {
    reportTitle: 'Pagaste activity',
    reportSubtitle: (count) => `${count} ${count === 1 ? 'entry' : 'entries'}`,
    generatedAt: (date) => `Generated on ${date}`,
    overview: 'Overview',
    pendingToReceive: 'Owed to you',
    pendingToPay: 'You owe',
    received: 'Received',
    issues: 'Under review',
    movements: 'Entries',
    noAmount: '—',
    page: (current, total) => `Page ${current} of ${total}`,
    pdfAction: 'PDF report',
    pdfHint: 'Visual document ready to save or share',
    excelAction: 'Open in Excel',
    excelHint: 'XML workbook compatible with Excel and LibreOffice',
    visualSummaryAction: (name) => `Share ${name}'s visual summary`,
    visualSummaryHint: 'Visual image with this person’s totals and entries',
    visualSummaryFooter:
      'Pagaste calculates, organises and lets recipients confirm payments manually.',
    androidFileFallback:
      'The file has been prepared. On Android this text summary is shared because the app does not yet include the native attachment module.',
  },
};

export function getActivityExportCopy(locale: Locale): ActivityExportCopy {
  return copy[locale];
}
