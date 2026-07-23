import { z } from 'zod';
import type {
  Cents,
  ReceiptOcrNormalizationOptions,
  ReceiptScanItem,
  ReceiptScanResult,
} from '../types';
import { DomainValidationError } from './errors';
import { assertSafeCents, sumCents } from './money';

const normalizedCentsSchema = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const confidenceSchema = z.number().finite().min(0).max(1);

export const receiptScanItemSchema = z
  .object({
    name: z.string().min(1).max(200),
    quantity: z.number().finite().positive().max(10_000),
    unitPriceCents: normalizedCentsSchema.nonnegative().nullable(),
    lineTotalCents: normalizedCentsSchema.nonnegative(),
    confidence: confidenceSchema,
  })
  .strict();

export const receiptScanResultSchema = z
  .object({
    merchantName: z.string().min(1).max(200).nullable(),
    merchantAddress: z.string().min(1).max(500).nullable(),
    occurredAt: z.string().datetime({ offset: true }).nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    subtotalCents: normalizedCentsSchema.nonnegative().nullable(),
    taxCents: normalizedCentsSchema.nonnegative().nullable(),
    tipCents: normalizedCentsSchema.nonnegative().nullable(),
    discountCents: normalizedCentsSchema.nonpositive().nullable(),
    totalCents: normalizedCentsSchema.nonnegative(),
    confidence: confidenceSchema,
    items: z.array(receiptScanItemSchema).max(500),
    warnings: z.array(z.string().min(1).max(500)).max(100),
  })
  .strict();

const rawMoneySchema = z.union([z.number().finite(), z.string().min(1).max(100)]);
const rawNumberSchema = z.union([z.number().finite(), z.string().min(1).max(50)]);

const rawItemSchema = z
  .object({
    name: z.string().max(500),
    quantity: rawNumberSchema.optional(),
    unitPrice: rawMoneySchema.nullish(),
    unitPriceCents: normalizedCentsSchema.nullish(),
    lineTotal: rawMoneySchema.optional(),
    lineTotalCents: normalizedCentsSchema.optional(),
    confidence: confidenceSchema.optional(),
  })
  .passthrough();

const rawReceiptSchema = z
  .object({
    merchantName: z.string().max(500).nullish(),
    merchantAddress: z.string().max(1_000).nullish(),
    occurredAt: z.string().max(100).nullish(),
    currency: z.string().max(20).optional(),
    subtotal: rawMoneySchema.nullish(),
    subtotalCents: normalizedCentsSchema.nullish(),
    tax: rawMoneySchema.nullish(),
    taxCents: normalizedCentsSchema.nullish(),
    tip: rawMoneySchema.nullish(),
    tipCents: normalizedCentsSchema.nullish(),
    discount: rawMoneySchema.nullish(),
    discountCents: normalizedCentsSchema.nullish(),
    total: rawMoneySchema.optional(),
    totalCents: normalizedCentsSchema.optional(),
    confidence: confidenceSchema.optional(),
    items: z.array(rawItemSchema).max(500).default([]),
    warnings: z.array(z.string().max(1_000)).max(100).default([]),
  })
  .passthrough();

function normalizedText(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trimEnd();
  return normalized || null;
}

function decimalSeparator(source: string, locale: string): '.' | ',' | null {
  const lastDot = source.lastIndexOf('.');
  const lastComma = source.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) return lastDot > lastComma ? '.' : ',';

  const separator: '.' | ',' | null = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : null;
  if (separator === null) return null;
  const occurrences = source.split(separator).length - 1;
  const digitsAfter = source.length - source.lastIndexOf(separator) - 1;
  if (occurrences > 1) return digitsAfter <= 2 ? separator : null;
  if (digitsAfter <= 2) return separator;

  const localeDecimal = new Intl.NumberFormat(locale)
    .formatToParts(1.1)
    .find(({ type }) => type === 'decimal')?.value;
  return digitsAfter !== 3 && localeDecimal === separator ? separator : null;
}

/** Converts a provider decimal amount to integer cents without float arithmetic. */
export function decimalAmountToCents(value: number | string, locale = 'es-ES'): Cents {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new DomainValidationError('invalid_ocr_amount', 'OCR amount must be finite');
  }
  let source = String(value).normalize('NFKC').trim();
  let negative = false;
  if (source.startsWith('(') && source.endsWith(')')) {
    negative = true;
    source = source.slice(1, -1).trim();
  }
  source = source
    .replace(/\p{Sc}/gu, '')
    .replace(/\b[A-Za-z]{3}\b/g, '')
    .replace(/[\s'’]/g, '');
  if (source.startsWith('+') || source.startsWith('-')) {
    negative = negative || source.startsWith('-');
    source = source.slice(1);
  }
  if (!/^\d[\d.,]*$/.test(source)) {
    throw new DomainValidationError('invalid_ocr_amount', 'OCR amount has an invalid format');
  }

  const separator = decimalSeparator(source, locale);
  let majorDigits: string;
  let fractionDigits: string;
  if (separator === null) {
    majorDigits = source.replace(/[.,]/g, '');
    fractionDigits = '';
  } else {
    const separatorIndex = source.lastIndexOf(separator);
    majorDigits = source.slice(0, separatorIndex).replace(/[.,]/g, '');
    fractionDigits = source.slice(separatorIndex + 1);
    if (fractionDigits.length > 2) {
      throw new DomainValidationError(
        'invalid_ocr_amount',
        'OCR monetary amounts cannot contain more than two decimal places',
      );
    }
  }
  if (!/^\d+$/.test(majorDigits) || (fractionDigits !== '' && !/^\d+$/.test(fractionDigits))) {
    throw new DomainValidationError('invalid_ocr_amount', 'OCR amount has an invalid format');
  }

  const absolute = BigInt(majorDigits) * 100n + BigInt(fractionDigits.padEnd(2, '0') || '0');
  const signed = negative ? -absolute : absolute;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new DomainValidationError(
      'invalid_ocr_amount',
      'OCR amount exceeds the safe cents range',
    );
  }
  return Number(signed);
}

export const normalizeOcrAmountToCents = decimalAmountToCents;

function pickAmount(
  cents: Cents | null | undefined,
  decimal: number | string | null | undefined,
  locale: string,
  required: boolean,
): Cents | null {
  if (cents !== null && cents !== undefined) {
    assertSafeCents(cents, 'OCR cents');
    return cents;
  }
  if (decimal !== null && decimal !== undefined) return decimalAmountToCents(decimal, locale);
  if (required) {
    throw new DomainValidationError(
      'missing_ocr_amount',
      'OCR response is missing a required amount',
    );
  }
  return null;
}

function normalizedQuantity(value: number | string | undefined): number {
  if (value === undefined) return 1;
  const quantity = typeof value === 'number' ? value : Number(value.replace(',', '.'));
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10_000) {
    throw new DomainValidationError('invalid_ocr_quantity', 'OCR quantity must be positive');
  }
  return quantity;
}

function normalizedTimestamp(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new DomainValidationError('invalid_ocr_date', 'OCR date is invalid');
  }
  return new Date(timestamp).toISOString();
}

function normalizedCurrency(value: string | undefined, fallback: string | undefined): string {
  const currency = (value || fallback || 'EUR').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new DomainValidationError('invalid_ocr_currency', 'OCR currency must be an ISO code');
  }
  return currency;
}

function normalizeWarning(value: string): string | null {
  return normalizedText(value, 500);
}

export function normalizeReceiptOcrResponse(
  input: unknown,
  options: ReceiptOcrNormalizationOptions = {},
): ReceiptScanResult {
  const raw = rawReceiptSchema.parse(input);
  const locale = options.locale ?? 'es-ES';
  const responseConfidence = raw.confidence ?? 0;
  const totalCents = pickAmount(raw.totalCents, raw.total, locale, true);
  if (totalCents === null || totalCents < 0) {
    throw new DomainValidationError('invalid_ocr_amount', 'OCR total cannot be negative');
  }

  const items: ReceiptScanItem[] = raw.items.map((item, index) => {
    const name = normalizedText(item.name, 200);
    if (name === null) {
      throw new DomainValidationError('invalid_ocr_item', `OCR item ${index} needs a name`);
    }
    const lineTotalCents = pickAmount(item.lineTotalCents, item.lineTotal, locale, true);
    const unitPriceCents = pickAmount(item.unitPriceCents, item.unitPrice, locale, false);
    if (
      lineTotalCents === null ||
      lineTotalCents < 0 ||
      (unitPriceCents !== null && unitPriceCents < 0)
    ) {
      throw new DomainValidationError(
        'invalid_ocr_amount',
        `OCR item ${index} cannot contain a negative price`,
      );
    }
    return {
      name,
      quantity: normalizedQuantity(item.quantity),
      unitPriceCents,
      lineTotalCents,
      confidence: item.confidence ?? responseConfidence,
    };
  });

  const subtotalCents = pickAmount(raw.subtotalCents, raw.subtotal, locale, false);
  const taxCents = pickAmount(raw.taxCents, raw.tax, locale, false);
  const tipCents = pickAmount(raw.tipCents, raw.tip, locale, false);
  const rawDiscount = pickAmount(raw.discountCents, raw.discount, locale, false);
  if (
    (subtotalCents !== null && subtotalCents < 0) ||
    (taxCents !== null && taxCents < 0) ||
    (tipCents !== null && tipCents < 0)
  ) {
    throw new DomainValidationError(
      'invalid_ocr_amount',
      'Subtotal, tax and tip cannot be negative',
    );
  }
  const discountCents =
    rawDiscount === null ? null : rawDiscount === 0 ? 0 : -Math.abs(rawDiscount);

  const warnings = raw.warnings
    .map(normalizeWarning)
    .filter((warning): warning is string => warning !== null);
  if (subtotalCents !== null) {
    try {
      const itemsTotal = sumCents(
        items.map(({ lineTotalCents }) => lineTotalCents),
        'OCR item total',
      );
      if (itemsTotal !== subtotalCents && !warnings.includes('items_do_not_match_subtotal')) {
        warnings.push('items_do_not_match_subtotal');
      }
    } catch {
      if (!warnings.includes('items_total_out_of_range')) {
        warnings.push('items_total_out_of_range');
      }
    }
  }

  return receiptScanResultSchema.parse({
    merchantName: normalizedText(raw.merchantName, 200),
    merchantAddress: normalizedText(raw.merchantAddress, 500),
    occurredAt: normalizedTimestamp(raw.occurredAt),
    currency: normalizedCurrency(raw.currency, options.currencyHint),
    subtotalCents,
    taxCents,
    tipCents,
    discountCents,
    totalCents,
    confidence: responseConfidence,
    items,
    warnings,
  });
}

export const normalizeOcrResponse = normalizeReceiptOcrResponse;

export function parseReceiptScanResult(input: unknown): ReceiptScanResult {
  return receiptScanResultSchema.parse(input);
}
