import type { Cents, ReceiptScanResult } from '@/types';
import { DomainValidationError } from './errors';
import { assertSafeCents, sumCents } from './money';

export const MAX_RECEIPTS_PER_IMPORT = 20;
export const MAX_RECEIPT_ITEMS_PER_IMPORT = 1_000;
export const MAX_RECEIPT_IMAGE_BYTES = 10 * 1024 * 1024;

export type ReceiptImportCandidate = Readonly<{
  clientId: string;
  uri: string;
  fileName: string | null;
  mimeType: string;
  width: number;
  height: number;
  fileSize: number | null;
}>;

export type ReceiptCandidateInput = Readonly<{
  id?: string | null;
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
}>;

export type PreparedReceiptCandidates = Readonly<{
  accepted: readonly ReceiptImportCandidate[];
  rejected: readonly {
    input: ReceiptCandidateInput;
    reason: 'unsupported_type' | 'too_large' | 'duplicate' | 'limit_reached';
  }[];
}>;

export type ScannedReceipt = Readonly<{
  receiptId: string;
  result: ReceiptScanResult;
}>;

export type CombinedReceiptItem = Readonly<{
  receiptId: string;
  name: string;
  quantity: number;
  unitPriceCents: Cents | null;
  lineTotalCents: Cents;
  confidence: number;
}>;

export type CombinedReceiptResult = Readonly<{
  merchantName: string | null;
  currency: string;
  totalCents: Cents;
  confidence: number;
  items: readonly CombinedReceiptItem[];
  warnings: readonly { receiptId: string; message: string }[];
}>;

function normalizedMimeType(input: ReceiptCandidateInput): string {
  const explicit = input.mimeType?.trim().toLowerCase();
  if (explicit) return explicit;
  const extension = input.fileName?.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function candidateKey(input: ReceiptCandidateInput): string {
  return input.id?.trim() || input.uri.trim();
}

/**
 * Sanitises gallery/camera results before any upload. The function deliberately
 * accepts only formats understood by the current OCR endpoint; a PDF picker can
 * be enabled later without silently treating a PDF as an image.
 */
export function prepareReceiptCandidates(
  inputs: readonly ReceiptCandidateInput[],
  existing: readonly ReceiptImportCandidate[] = [],
): PreparedReceiptCandidates {
  const accepted: ReceiptImportCandidate[] = [];
  const rejected: PreparedReceiptCandidates['rejected'][number][] = [];
  const seen = new Set(existing.map((candidate) => candidate.clientId));

  for (const input of inputs) {
    const key = candidateKey(input);
    const mimeType = normalizedMimeType(input);
    if (!key || !input.uri.trim() || !/^image\/(?:jpeg|png|webp)$/u.test(mimeType)) {
      rejected.push({ input, reason: 'unsupported_type' });
      continue;
    }
    if (seen.has(key)) {
      rejected.push({ input, reason: 'duplicate' });
      continue;
    }
    if (existing.length + accepted.length >= MAX_RECEIPTS_PER_IMPORT) {
      rejected.push({ input, reason: 'limit_reached' });
      continue;
    }
    if (
      input.fileSize !== null &&
      input.fileSize !== undefined &&
      input.fileSize > MAX_RECEIPT_IMAGE_BYTES
    ) {
      rejected.push({ input, reason: 'too_large' });
      continue;
    }
    seen.add(key);
    accepted.push({
      clientId: key,
      uri: input.uri.trim(),
      fileName: input.fileName?.trim() || null,
      mimeType,
      width: Math.max(0, Math.trunc(input.width ?? 0)),
      height: Math.max(0, Math.trunc(input.height ?? 0)),
      fileSize: input.fileSize ?? null,
    });
  }

  return { accepted, rejected };
}

function normalisedMerchant(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('es-ES');
}

/**
 * Combines independently scanned receipts without performing currency
 * conversion or floating-point arithmetic. Every line keeps its source receipt
 * so the review screen can point back to the right image.
 */
export function combineReceiptScans(scans: readonly ScannedReceipt[]): CombinedReceiptResult {
  if (!scans.length) {
    throw new DomainValidationError('multi_receipt_empty', 'At least one receipt is required');
  }
  if (scans.length > MAX_RECEIPTS_PER_IMPORT) {
    throw new DomainValidationError(
      'multi_receipt_limit',
      `No more than ${MAX_RECEIPTS_PER_IMPORT} receipts can be combined`,
    );
  }

  const receiptIds = new Set<string>();
  const currencies = new Set<string>();
  const merchantNames = new Map<string, string>();
  const items: CombinedReceiptItem[] = [];
  const warnings: CombinedReceiptResult['warnings'][number][] = [];
  const confidences: number[] = [];

  for (const [scanIndex, scan] of scans.entries()) {
    const receiptId = scan.receiptId.trim();
    if (!receiptId || receiptIds.has(receiptId)) {
      throw new DomainValidationError(
        'multi_receipt_duplicate',
        `Receipt ${scanIndex} has an invalid or duplicate id`,
      );
    }
    receiptIds.add(receiptId);
    const currency = scan.result.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/u.test(currency)) {
      throw new DomainValidationError(
        'multi_receipt_currency',
        `Receipt ${scanIndex} has an invalid currency`,
      );
    }
    currencies.add(currency);
    assertSafeCents(scan.result.totalCents, `receipts[${scanIndex}].totalCents`);
    if (scan.result.totalCents <= 0) {
      throw new DomainValidationError(
        'multi_receipt_total',
        `Receipt ${scanIndex} total must be positive`,
      );
    }
    if (scan.result.merchantName?.trim()) {
      const merchant = scan.result.merchantName.trim();
      merchantNames.set(normalisedMerchant(merchant), merchant);
    }
    if (Number.isFinite(scan.result.confidence)) confidences.push(scan.result.confidence);
    warnings.push(
      ...scan.result.warnings.map((message) => ({ receiptId, message: message.trim() })),
    );

    for (const [itemIndex, item] of scan.result.items.entries()) {
      assertSafeCents(
        item.lineTotalCents,
        `receipts[${scanIndex}].items[${itemIndex}].lineTotalCents`,
      );
      if (!item.name.trim() || item.lineTotalCents === 0) {
        throw new DomainValidationError(
          'multi_receipt_item',
          `Receipt ${scanIndex} item ${itemIndex} is invalid`,
        );
      }
      items.push({
        receiptId,
        name: item.name.trim(),
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        lineTotalCents: item.lineTotalCents,
        confidence: item.confidence,
      });
    }
  }

  if (currencies.size !== 1) {
    throw new DomainValidationError(
      'multi_receipt_currency_mismatch',
      'Receipts in different currencies cannot be combined',
    );
  }
  if (!items.length || items.length > MAX_RECEIPT_ITEMS_PER_IMPORT) {
    throw new DomainValidationError(
      'multi_receipt_item_limit',
      'The combined receipt item count is invalid',
    );
  }

  const totalCents = sumCents(
    scans.map((scan) => scan.result.totalCents),
    'Combined receipt total',
  );
  const confidence =
    confidences.length > 0
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : 0;

  return {
    merchantName: merchantNames.size === 1 ? [...merchantNames.values()][0]! : null,
    currency: [...currencies][0]!,
    totalCents,
    confidence,
    items,
    warnings: warnings.filter((warning) => warning.message.length > 0),
  };
}
