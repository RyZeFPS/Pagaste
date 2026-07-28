import { decimalAmountToCents } from './ocr';
import { sumCents } from './money';

export type DigitalReceiptItem = Readonly<{
  name: string;
  quantity: number;
  lineTotalCents: number;
}>;

export type DigitalReceipt = Readonly<{
  merchantName: string | null;
  totalCents: number;
  items: readonly DigitalReceiptItem[];
  warnings: readonly ('total_inferred' | 'items_do_not_match_total')[];
}>;

const amountAtEndPattern =
  /(?:^|\s)([-+]?(?:\d{1,3}(?:[.\s]\d{3})+|\d+)(?:[.,]\d{1,2})?)\s*(?:€|EUR|euros?)?\s*$/iu;
const totalLinePattern =
  /\b(?:total(?:\s+a\s+pagar)?|importe(?:\s+total)?|amount(?:\s+due)?|grand\s+total)\b/iu;
const nonProductLinePattern =
  /\b(?:pedido|order|ticket|factura|invoice|fecha|date|hora|tel(?:éfono)?|cif|nif|subtotal|iva|vat|forma\s+de\s+pago|payment)\b/iu;
const quantityPrefixPattern = /^\s*(\d+(?:[.,]\d+)?)\s*(?:x|×|ud(?:s)?\.?)\s+/iu;

function cleanLine(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/[ \t]+/gu, ' ')
    .trim();
}

function parseAmount(value: string, locale: string): number | null {
  try {
    return decimalAmountToCents(value, locale);
  } catch {
    return null;
  }
}

function merchantCandidate(lines: readonly string[]): string | null {
  const candidate = lines.find(
    (line) =>
      line.length >= 2 &&
      line.length <= 80 &&
      !amountAtEndPattern.test(line) &&
      !totalLinePattern.test(line) &&
      !nonProductLinePattern.test(line) &&
      !/^(?:https?:\/\/|www\.|[@#]|\d[\d\s/:.-]+$)/iu.test(line),
  );
  return candidate ?? null;
}

/**
 * Converts copied text from a delivery app, email or digital receipt into an
 * editable draft. Ambiguous lines are omitted instead of inventing products.
 */
export function parseDigitalReceiptText(source: string, locale = 'es-ES'): DigitalReceipt {
  const text = source.normalize('NFKC').trim();
  if (!text) throw new Error('digital_receipt_empty');
  if (text.length > 100_000) throw new Error('digital_receipt_too_large');

  const lines = text.split(/\r?\n/gu).map(cleanLine).filter(Boolean).slice(0, 1_000);

  let declaredTotal: number | null = null;
  const items: DigitalReceiptItem[] = [];

  for (const line of lines) {
    const amountMatch = line.match(amountAtEndPattern);
    if (!amountMatch?.[1]) continue;
    const lineTotalCents = parseAmount(amountMatch[1], locale);
    if (lineTotalCents === null) continue;

    const label = cleanLine(line.slice(0, amountMatch.index));
    if (totalLinePattern.test(label)) {
      declaredTotal = lineTotalCents;
      continue;
    }
    if (!label || nonProductLinePattern.test(label)) continue;

    const quantityMatch = label.match(quantityPrefixPattern);
    const rawQuantity = quantityMatch?.[1]?.replace(',', '.');
    const quantity = rawQuantity ? Number(rawQuantity) : 1;
    const name = cleanLine(quantityMatch ? label.slice(quantityMatch[0].length) : label)
      .replace(/^[·•\-–—:]+\s*/u, '')
      .slice(0, 200)
      .trim();
    if (
      !name ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 10_000 ||
      !Number.isSafeInteger(lineTotalCents) ||
      lineTotalCents === 0
    ) {
      continue;
    }
    items.push({ name, quantity, lineTotalCents });
  }

  if (!items.length) throw new Error('digital_receipt_no_items');
  const itemsTotal = sumCents(
    items.map((item) => item.lineTotalCents),
    'Digital receipt items total',
  );
  const totalCents = declaredTotal ?? itemsTotal;
  const warnings: DigitalReceipt['warnings'][number][] = [];
  if (declaredTotal === null) warnings.push('total_inferred');
  if (totalCents !== itemsTotal) warnings.push('items_do_not_match_total');

  return {
    merchantName: merchantCandidate(lines),
    totalCents,
    items,
    warnings,
  };
}
