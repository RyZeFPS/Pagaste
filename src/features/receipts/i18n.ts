export type ReceiptImportCopy = Readonly<{
  selectedTitle: (count: number) => string;
  selectedBody: string;
  addMore: string;
  readAll: (count: number) => string;
  combineReady: (count: number) => string;
  queued: string;
  compressing: string;
  uploading: string;
  processing: string;
  completed: string;
  failed: string;
  retry: string;
  remove: string;
  receiptA11y: (index: number) => string;
  someRejected: string;
  duplicateRejected: string;
  oversizedRejected: string;
  unsupportedRejected: string;
  limitRejected: string;
  partialFailure: string;
  allFailed: string;
  currencyMismatch: string;
  saveFailed: string;
  pdfUnavailable: string;
}>;

const es: ReceiptImportCopy = {
  selectedTitle: (count) =>
    count === 1 ? '1 ticket seleccionado' : `${count} tickets seleccionados`,
  selectedBody: 'Se leerán por separado y se combinarán en un único borrador editable.',
  addMore: 'Añadir más',
  readAll: (count) => (count === 1 ? 'Leer ticket' : `Leer ${count} tickets`),
  combineReady: (count) =>
    count === 1 ? 'Ticket listo para revisar' : `${count} tickets combinados y listos para revisar`,
  queued: 'En cola',
  compressing: 'Preparando',
  uploading: 'Subiendo',
  processing: 'Leyendo',
  completed: 'Listo',
  failed: 'No leído',
  retry: 'Reintentar',
  remove: 'Quitar',
  receiptA11y: (index) => `Vista previa del ticket ${index}`,
  someRejected: 'Algunos archivos no se han añadido.',
  duplicateRejected: 'Ya habías añadido uno de esos tickets.',
  oversizedRejected: 'Alguna imagen supera el límite de 10 MB.',
  unsupportedRejected: 'Solo se admiten imágenes JPG, PNG o WebP en esta versión.',
  limitRejected: 'Puedes combinar hasta 20 tickets en una misma sesión.',
  partialFailure:
    'Los tickets correctos siguen guardados. Reintenta o quita los que no se han podido leer.',
  allFailed: 'No se ha podido leer ningún ticket. Revisa las imágenes o añádelo manualmente.',
  currencyMismatch: 'Los tickets usan monedas distintas y no se pueden combinar.',
  saveFailed: 'No se ha podido guardar la combinación. Ninguna línea anterior se ha eliminado.',
  pdfUnavailable:
    'La importación PDF requiere el lector nativo de la aplicación. En esta versión puedes usar una captura, una imagen o pegar el texto del pedido.',
};

const en: ReceiptImportCopy = {
  selectedTitle: (count) => (count === 1 ? '1 receipt selected' : `${count} receipts selected`),
  selectedBody: 'Each receipt will be read separately and merged into one editable draft.',
  addMore: 'Add more',
  readAll: (count) => (count === 1 ? 'Read receipt' : `Read ${count} receipts`),
  combineReady: (count) =>
    count === 1 ? 'Receipt ready to review' : `${count} receipts merged and ready to review`,
  queued: 'Queued',
  compressing: 'Preparing',
  uploading: 'Uploading',
  processing: 'Reading',
  completed: 'Ready',
  failed: 'Not read',
  retry: 'Retry',
  remove: 'Remove',
  receiptA11y: (index) => `Receipt ${index} preview`,
  someRejected: 'Some files were not added.',
  duplicateRejected: 'One of those receipts was already in the queue.',
  oversizedRejected: 'An image exceeds the 10 MB limit.',
  unsupportedRejected: 'This version accepts JPG, PNG or WebP images only.',
  limitRejected: 'You can combine up to 20 receipts in one session.',
  partialFailure:
    'Successful receipts are still safe. Retry or remove the ones that could not be read.',
  allFailed: 'No receipt could be read. Check the images or enter the items manually.',
  currencyMismatch: 'The receipts use different currencies and cannot be combined.',
  saveFailed: 'The combination could not be saved. No previous line was removed.',
  pdfUnavailable:
    'PDF import requires the app native reader. In this version, use a screenshot, an image or paste the order text.',
};

export function receiptImportCopy(locale: string): ReceiptImportCopy {
  return locale.toLowerCase().startsWith('en') ? en : es;
}
