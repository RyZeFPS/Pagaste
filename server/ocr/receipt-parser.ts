import { resolveMerchantBrand } from '../../src/lib/merchant-brand';
import { isReceiptCommonExpense, receiptLineReviewThreshold } from '../../src/domain/ocr';
import type { ReceiptScanItem, ReceiptScanResult } from '../../src/types/ocr';

export type OcrLine = Readonly<{
  text: string;
  confidence: number;
  top?: number;
  left?: number;
}>;

export class ReceiptParseError extends Error {
  constructor(readonly code: 'OCR_TEXT_EMPTY' | 'OCR_TOTAL_NOT_FOUND') {
    super(code);
    this.name = 'ReceiptParseError';
  }
}

const TOTAL_LABEL = /\b(?:gran\s+total|importe\s+total|total\s+a\s+pagar|a\s+pagar|total)\b/iu;
const NON_FINAL_TOTAL =
  /\b(?:subtotal|total\s+iva|total\s+impuestos?|total\s+descuentos?|base\s+imponible)\b/iu;
const NON_PRODUCT =
  /\b(?:subtotal|total|iva|i\.v\.a|impuesto|base\s+imponible|efectivo|tarjeta|visa|mastercard|cambio|entregado|recibido|pago|operaci[oó]n|autorizaci[oó]n|ticket|factura|fecha|hora|caja|cajero|cliente|cif|nif|tel[eé]fono|gracias|www\.|@)\b/iu;
const DISCOUNT_LABEL = /\b(?:descuento|dto|dcto|promoci[oó]n|ahorro|cup[oó]n)\b/iu;
const ADDRESS_LABEL =
  /^(?:c(?:alle\b|\/)|av(?:enida|da)?\b|av\.|plaza\b|paseo\b|carretera\b|ctra\.|ronda\b)/iu;
const HEADER_LABEL =
  /\b(?:producto|descripci[oó]n|art[ií]culo|cantidad|cant\.?|precio|importe)\b/iu;
const MONEY_PATTERN = /(?:[-−]\s*)?(?:€\s*)?\d{1,7}(?:(?:[.\s]\d{3})+)?[,.]\d{2}\s*(?:€|eur)?/giu;

type AmountToken = Readonly<{
  raw: string;
  cents: number;
  index: number;
  end: number;
}>;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function cleanLine(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[|¦]/gu, ' ')
    .replace(/[“”]/gu, '"')
    .replace(/[’`]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

function parseMoneyToken(raw: string): number | null {
  let source = raw
    .normalize('NFKC')
    .replace(/[€\s]/gu, '')
    .replace(/eur/giu, '')
    .replace(/−/gu, '-')
    .trim();
  const negative = source.startsWith('-');
  source = source.replace(/^-+/u, '');
  const separatorIndex = Math.max(source.lastIndexOf(','), source.lastIndexOf('.'));
  if (separatorIndex < 1 || source.length - separatorIndex - 1 !== 2) return null;
  const major = source.slice(0, separatorIndex).replace(/[.,]/gu, '');
  const minor = source.slice(separatorIndex + 1);
  if (!/^\d+$/u.test(major) || !/^\d{2}$/u.test(minor)) return null;
  const cents = Number(BigInt(major) * 100n + BigInt(minor));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

function amountsInLine(line: string): AmountToken[] {
  const numericFriendly = line.replace(/(?<=[\d,.])[oO](?=\s*(?:€|EUR)?(?:\s|$))/gu, '0');
  const amounts: AmountToken[] = [];
  for (const match of numericFriendly.matchAll(MONEY_PATTERN)) {
    const raw = match[0];
    const index = match.index;
    const cents = parseMoneyToken(raw);
    if (index === undefined || cents === null) continue;
    amounts.push({ raw, cents, index, end: index + raw.length });
  }
  return amounts;
}

function normalizedConfidence(value: number): number {
  return clamp(value > 1 ? value / 100 : value);
}

function meaningfulLines(lines: readonly OcrLine[]): OcrLine[] {
  return lines
    .map((line) => ({ ...line, text: cleanLine(line.text) }))
    .filter((line) => line.text.length > 1 && /[\p{Letter}\p{Number}]/u.test(line.text))
    .slice(0, 400);
}

function merchantFrom(lines: readonly OcrLine[]): string | null {
  const header = lines.slice(0, 12);
  for (const line of header) {
    const brand = resolveMerchantBrand(line.text);
    if (brand) return brand.displayName;
  }
  const candidate = header
    .filter((line) => {
      const letters = line.text.match(/\p{Letter}/gu)?.length ?? 0;
      const digits = line.text.match(/\d/gu)?.length ?? 0;
      return (
        letters >= 3 &&
        digits <= Math.max(2, letters / 2) &&
        !NON_PRODUCT.test(line.text) &&
        !ADDRESS_LABEL.test(line.text) &&
        amountsInLine(line.text).length === 0 &&
        line.text.length <= 100
      );
    })
    .sort((left, right) => {
      const upperLeft = left.text === left.text.toLocaleUpperCase('es-ES') ? 1 : 0;
      const upperRight = right.text === right.text.toLocaleUpperCase('es-ES') ? 1 : 0;
      return upperRight - upperLeft || right.confidence - left.confidence;
    })[0];
  return candidate?.text ?? null;
}

function addressFrom(lines: readonly OcrLine[]): string | null {
  return lines.slice(0, 16).find((line) => ADDRESS_LABEL.test(line.text))?.text ?? null;
}

function findTotal(lines: readonly OcrLine[]): { cents: number; index: number; explicit: boolean } {
  const explicit: { cents: number; index: number }[] = [];
  lines.forEach((line, index) => {
    if (!TOTAL_LABEL.test(line.text) || NON_FINAL_TOTAL.test(line.text)) return;
    const amount = amountsInLine(line.text).at(-1);
    if (amount && amount.cents > 0) explicit.push({ cents: amount.cents, index });
  });
  const selected = explicit.at(-1);
  if (selected) return { ...selected, explicit: true };

  const start = Math.floor(lines.length * 0.45);
  const candidates = lines.slice(start).flatMap((line, relativeIndex) => {
    if (/\b(?:cambio|entregado|recibido)\b/iu.test(line.text)) return [];
    return amountsInLine(line.text)
      .filter((amount) => amount.cents > 0)
      .map((amount) => ({ cents: amount.cents, index: start + relativeIndex }));
  });
  const fallback = candidates.sort(
    (left, right) => right.cents - left.cents || right.index - left.index,
  )[0];
  if (!fallback) throw new ReceiptParseError('OCR_TOTAL_NOT_FOUND');
  return { ...fallback, explicit: false };
}

function quantityAndName(
  line: string,
  amounts: readonly AmountToken[],
): { quantity: number; name: string; unitPriceCents: number | null } {
  let source = line;
  const quantityMatch = /^\s*(\d{1,3}(?:[,.]\d{1,3})?)\s*(?:x|×|\*)\s*/iu.exec(source);
  const quantity = quantityMatch ? Number(quantityMatch[1]?.replace(',', '.')) : 1;
  if (quantityMatch) source = source.slice(quantityMatch[0].length);

  for (const amount of [...amounts].reverse()) {
    const localIndex = source.lastIndexOf(amount.raw);
    if (localIndex >= 0)
      source = `${source.slice(0, localIndex)} ${source.slice(localIndex + amount.raw.length)}`;
  }
  const name = source
    .replace(/^\s*(?:\d{4,14}|[A-Z]?\d{3,14}[A-Z]?)\s+/iu, '')
    .replace(/^[#*.:;\-–—]+\s*/u, '')
    .replace(/\s*[.:;\-–—]+\s*$/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 160);

  const finalAmount = amounts.at(-1)?.cents ?? 0;
  const possibleUnit = amounts.length > 1 ? amounts.at(-2)?.cents : undefined;
  const unitPriceCents =
    possibleUnit !== undefined &&
    quantity > 0 &&
    Math.abs(possibleUnit * quantity - finalAmount) <= 2
      ? possibleUnit
      : quantity > 0 && Number.isInteger(finalAmount / quantity)
        ? finalAmount / quantity
        : null;
  return {
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    name,
    unitPriceCents,
  };
}

function productsFrom(lines: readonly OcrLine[], totalIndex: number): ReceiptScanItem[] {
  const items: ReceiptScanItem[] = [];
  const upperBound = Math.min(lines.length, totalIndex + 1);
  for (let index = 0; index < upperBound; index += 1) {
    const line = lines[index];
    if (!line || HEADER_LABEL.test(line.text) || NON_PRODUCT.test(line.text)) continue;
    const amounts = amountsInLine(line.text);
    const finalAmount = amounts.at(-1);
    if (!finalAmount || finalAmount.cents === 0) continue;
    const parsed = quantityAndName(line.text, amounts);
    if (
      parsed.name.length < 2 ||
      !/\p{Letter}/u.test(parsed.name) ||
      /^\p{Letter}{0,2}\d+$/iu.test(parsed.name)
    ) {
      continue;
    }
    const isDiscount = DISCOUNT_LABEL.test(parsed.name) || finalAmount.cents < 0;
    items.push({
      name: parsed.name,
      quantity: parsed.quantity,
      unitPriceCents:
        parsed.unitPriceCents === null
          ? null
          : isDiscount
            ? -Math.abs(parsed.unitPriceCents)
            : Math.abs(parsed.unitPriceCents),
      lineTotalCents: isDiscount ? -Math.abs(finalAmount.cents) : Math.abs(finalAmount.cents),
      confidence: normalizedConfidence(line.confidence),
    });
  }
  return items.filter(
    (item, index) =>
      index === 0 ||
      !items
        .slice(0, index)
        .some(
          (previous) =>
            previous.name.toLocaleLowerCase('es-ES') === item.name.toLocaleLowerCase('es-ES') &&
            previous.lineTotalCents === item.lineTotalCents,
        ),
  );
}

export function parseReceiptLines(
  rawLines: readonly OcrLine[],
  options: Readonly<{
    currencyHint?: string;
    locale?: string;
    pageConfidence?: number;
    qualityWarnings?: readonly string[];
  }> = {},
): ReceiptScanResult {
  const lines = meaningfulLines(rawLines);
  if (!lines.length) throw new ReceiptParseError('OCR_TEXT_EMPTY');
  const total = findTotal(lines);
  let items = productsFrom(lines, total.index);
  const warnings: string[] = [...(options.qualityWarnings ?? [])];

  if (!items.length) {
    items = [
      {
        name: options.locale?.toLowerCase().startsWith('en')
          ? 'Receipt total — review items'
          : 'Total del ticket — revisar productos',
        quantity: 1,
        unitPriceCents: total.cents,
        lineTotalCents: total.cents,
        confidence: 0.25,
      },
    ];
    warnings.push('products_not_detected');
  }

  const itemTotal = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const difference = total.cents - itemTotal;
  if (difference !== 0 && Math.abs(difference) <= 2 && items.length) {
    const last = items.at(-1);
    if (last) {
      items = [
        ...items.slice(0, -1),
        {
          ...last,
          lineTotalCents: last.lineTotalCents + difference,
          unitPriceCents:
            last.unitPriceCents === null || last.quantity === 0
              ? null
              : last.unitPriceCents + difference / last.quantity,
        },
      ];
      warnings.push('rounding_adjusted');
    }
  } else if (difference !== 0) {
    warnings.push('items_do_not_match_total');
  }
  if (!total.explicit) {
    warnings.push('total_label_not_found');
  }

  const lowConfidenceLines = items.filter(
    (item) => item.confidence < receiptLineReviewThreshold,
  ).length;
  if (lowConfidenceLines > 0) warnings.push(`low_confidence_lines:${lowConfidenceLines}`);

  const averageLineConfidence =
    items.reduce((sum, item) => sum + item.confidence, 0) / Math.max(items.length, 1);
  const pageConfidence = normalizedConfidence(options.pageConfidence ?? averageLineConfidence);
  const reconciled =
    items.reduce((sum, item) => sum + item.lineTotalCents, 0) === total.cents ? 0.12 : -0.18;
  const confidence = clamp(pageConfidence * 0.55 + averageLineConfidence * 0.45 + reconciled);
  if (confidence < 0.62) {
    warnings.push('page_low_confidence');
  }

  const currency = (options.currencyHint ?? 'EUR').trim().toUpperCase();
  const subtotalCents = items
    .filter((item) => item.lineTotalCents > 0 && !isReceiptCommonExpense(item))
    .reduce((sum, item) => sum + item.lineTotalCents, 0);
  const discountCents = items
    .filter((item) => item.lineTotalCents < 0)
    .reduce((sum, item) => sum + item.lineTotalCents, 0);
  const tipCents = items
    .filter((item) => item.lineTotalCents > 0 && /\bpropina\b/iu.test(item.name))
    .reduce((sum, item) => sum + item.lineTotalCents, 0);
  return {
    merchantName: merchantFrom(lines),
    merchantAddress: addressFrom(lines),
    occurredAt: null,
    currency: /^[A-Z]{3}$/u.test(currency) ? currency : 'EUR',
    subtotalCents: subtotalCents || null,
    taxCents: null,
    tipCents: tipCents || null,
    discountCents: discountCents || null,
    totalCents: total.cents,
    confidence,
    items,
    warnings: [...new Set(warnings)].slice(0, 30),
  };
}
