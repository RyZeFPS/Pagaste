import type { Cents, CurrencyCode } from './money';

export interface ReceiptScanItem {
  name: string;
  quantity: number;
  unitPriceCents: Cents | null;
  lineTotalCents: Cents;
  confidence: number;
}

export interface ReceiptScanResult {
  merchantName: string | null;
  merchantAddress: string | null;
  occurredAt: string | null;
  currency: CurrencyCode;
  subtotalCents: Cents | null;
  taxCents: Cents | null;
  tipCents: Cents | null;
  discountCents: Cents | null;
  totalCents: Cents;
  confidence: number;
  items: readonly ReceiptScanItem[];
  warnings: readonly string[];
}

export interface ReceiptOcrProvider {
  scanReceipt(input: {
    imageUrl: string;
    locale: string;
    currencyHint?: string;
  }): Promise<ReceiptScanResult>;
}

export interface ReceiptOcrNormalizationOptions {
  /** Used only when the provider response omits a valid currency. */
  currencyHint?: CurrencyCode;
  /** Helps disambiguate a single thousands/decimal separator. */
  locale?: string;
}
