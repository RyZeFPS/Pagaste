import { File, Paths } from 'expo-file-system';
import { Platform, Share } from 'react-native';

type ExportedFile = {
  content: string | Uint8Array;
  extension: string;
  mimeType: string;
  prefix: string;
  title: string;
  androidFallback: string;
};

function safeFilenamePart(value: string): string {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || 'resumen';
}

function exportFilename(prefix: string, extension: string, now = new Date()): string {
  return `${safeFilenamePart(prefix)}-${now.toISOString().slice(0, 10)}-${now.getTime()}.${extension}`;
}

function downloadOnWeb(content: string | Uint8Array, filename: string, mimeType: string): void {
  if (typeof document === 'undefined') throw new Error('WEB_DOWNLOAD_UNAVAILABLE');
  let blobPart: BlobPart;
  if (typeof content === 'string') {
    blobPart = content;
  } else {
    const copied = new Uint8Array(content.byteLength);
    copied.set(content);
    blobPart = copied.buffer;
  }
  const blob = new Blob([blobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function exportFile({
  content,
  extension,
  mimeType,
  prefix,
  title,
  androidFallback,
}: ExportedFile): Promise<void> {
  const filename = exportFilename(prefix, extension);
  if (Platform.OS === 'web') {
    downloadOnWeb(content, filename, mimeType);
    return;
  }

  const file = new File(Paths.cache, filename);
  file.write(content);
  if (Platform.OS === 'ios') {
    await Share.share({ title, url: file.uri }, { subject: title });
    return;
  }

  // React Native's built-in Android Share module supports text only. Keep a
  // truthful fallback until expo-sharing is added to a development build.
  await Share.share({ title, message: androidFallback });
}

export async function exportActivityCsv(
  csv: string,
  title: string,
  androidFallback = csv,
): Promise<void> {
  await exportFile({
    content: csv,
    extension: 'csv',
    mimeType: 'text/csv;charset=utf-8',
    prefix: 'pagaste-actividad',
    title,
    androidFallback,
  });
}

export async function exportActivityPdf(
  pdf: Uint8Array,
  title: string,
  androidFallback: string,
): Promise<void> {
  await exportFile({
    content: pdf,
    extension: 'pdf',
    mimeType: 'application/pdf',
    prefix: 'pagaste-actividad',
    title,
    androidFallback,
  });
}

export async function exportActivityExcel(
  spreadsheetXml: string,
  title: string,
  androidFallback: string,
): Promise<void> {
  await exportFile({
    content: spreadsheetXml,
    extension: 'xml',
    mimeType: 'application/vnd.ms-excel;charset=utf-8',
    prefix: 'pagaste-actividad-excel',
    title,
    androidFallback,
  });
}

export async function exportParticipantSummaryImage(
  svg: string,
  participantName: string,
  title: string,
  androidFallback: string,
): Promise<void> {
  await exportFile({
    content: svg,
    extension: 'svg',
    mimeType: 'image/svg+xml;charset=utf-8',
    prefix: `pagaste-${participantName}`,
    title,
    androidFallback,
  });
}
