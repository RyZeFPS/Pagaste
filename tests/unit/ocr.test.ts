import { describe, expect, it } from 'vitest';
import {
  decimalAmountToCents,
  normalizeReceiptOcrResponse,
  parseReceiptScanResult,
} from '../../src/domain';

describe('OCR normalization', () => {
  it('parses locale-aware decimal money without float arithmetic', () => {
    expect(decimalAmountToCents('1.234,56 €', 'es-ES')).toBe(123_456);
    expect(decimalAmountToCents('$1,234.56', 'en-US')).toBe(123_456);
    expect(decimalAmountToCents('(2,40 €)', 'es-ES')).toBe(-240);
    expect(decimalAmountToCents(12.5)).toBe(1_250);
    expect(decimalAmountToCents('1.234', 'es-ES')).toBe(123_400);
    expect(() => decimalAmountToCents('12,3456', 'es-ES')).toThrowError(
      expect.objectContaining({ code: 'invalid_ocr_amount' }),
    );
  });

  it('validates and converts a provider response into normalized cents', () => {
    const result = normalizeReceiptOcrResponse(
      {
        providerRequestId: 'discarded',
        merchantName: '  Café\nCentral ',
        merchantAddress: ' Calle Mayor 1 ',
        occurredAt: '2026-07-22T12:00:00+02:00',
        currency: 'eur',
        subtotal: '10,00',
        tax: '1,00',
        tip: '0,50',
        discount: '0,50',
        total: '11,00',
        confidence: 0.92,
        warnings: ['  low   contrast '],
        items: [
          {
            externalId: 'discarded',
            name: ' Café ',
            quantity: '2',
            unitPrice: '4,50',
            lineTotal: '9,00',
            confidence: 0.8,
          },
        ],
      },
      { locale: 'es-ES' },
    );

    expect(result).toEqual({
      merchantName: 'Café Central',
      merchantAddress: 'Calle Mayor 1',
      occurredAt: '2026-07-22T10:00:00.000Z',
      currency: 'EUR',
      subtotalCents: 1_000,
      taxCents: 100,
      tipCents: 50,
      discountCents: -50,
      totalCents: 1_100,
      confidence: 0.92,
      items: [
        {
          name: 'Café',
          quantity: 2,
          unitPriceCents: 450,
          lineTotalCents: 900,
          confidence: 0.8,
        },
      ],
      warnings: ['low contrast', 'items_do_not_match_subtotal'],
    });
  });

  it('preserves already-normalized cents and uses a currency hint', () => {
    const result = normalizeReceiptOcrResponse(
      {
        totalCents: 850,
        confidence: 1,
        items: [
          {
            name: 'Pizza',
            quantity: 1,
            unitPriceCents: 850,
            lineTotalCents: 850,
          },
        ],
      },
      { currencyHint: 'usd' },
    );
    expect(result.currency).toBe('USD');
    expect(result.totalCents).toBe(850);
    expect(parseReceiptScanResult(result)).toEqual(result);
  });

  it('rejects missing required amounts, invalid confidence and negative prices', () => {
    expect(() => normalizeReceiptOcrResponse({ items: [] })).toThrowError(
      expect.objectContaining({ code: 'missing_ocr_amount' }),
    );
    expect(() => normalizeReceiptOcrResponse({ total: '10', confidence: 2, items: [] })).toThrow();
    expect(() =>
      normalizeReceiptOcrResponse({
        total: '10',
        items: [{ name: 'Bad', lineTotal: '-1' }],
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_ocr_amount' }));
  });
});
