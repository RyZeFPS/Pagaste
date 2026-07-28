import { describe, expect, it } from 'vitest';
import {
  combineReceiptScans,
  MAX_RECEIPT_IMAGE_BYTES,
  prepareReceiptCandidates,
} from '../../src/domain/multi-receipt';
import type { ReceiptScanResult } from '../../src/types';

function scan(merchantName: string, totalCents: number, currency = 'EUR'): ReceiptScanResult {
  return {
    merchantName,
    merchantAddress: null,
    occurredAt: null,
    currency,
    subtotalCents: totalCents,
    taxCents: null,
    tipCents: null,
    discountCents: null,
    totalCents,
    confidence: 0.9,
    warnings: ['review'],
    items: [
      {
        name: `${merchantName} item`,
        quantity: 1,
        unitPriceCents: totalCents,
        lineTotalCents: totalCents,
        confidence: 0.8,
      },
    ],
  };
}

describe('multi receipt import', () => {
  it('deduplicates image selections and rejects oversized or unsupported files', () => {
    const prepared = prepareReceiptCandidates([
      {
        id: 'one',
        uri: 'file:///one.jpg',
        fileName: 'one.jpg',
        mimeType: 'image/jpeg',
        width: 1000,
        height: 2000,
        fileSize: 500,
      },
      {
        id: 'one',
        uri: 'file:///duplicate.jpg',
        mimeType: 'image/jpeg',
      },
      {
        id: 'large',
        uri: 'file:///large.png',
        mimeType: 'image/png',
        fileSize: MAX_RECEIPT_IMAGE_BYTES + 1,
      },
      {
        id: 'pdf',
        uri: 'file:///receipt.pdf',
        mimeType: 'application/pdf',
      },
    ]);

    expect(prepared.accepted).toHaveLength(1);
    expect(prepared.accepted[0]).toMatchObject({
      clientId: 'one',
      mimeType: 'image/jpeg',
    });
    expect(prepared.rejected.map((entry) => entry.reason)).toEqual([
      'duplicate',
      'too_large',
      'unsupported_type',
    ]);
  });

  it('adds totals in cents and keeps every line linked to its receipt', () => {
    const combined = combineReceiptScans([
      { receiptId: 'receipt-a', result: scan('Mercadona', 1_299) },
      { receiptId: 'receipt-b', result: scan('Lidl', 2_701) },
    ]);

    expect(combined.totalCents).toBe(4_000);
    expect(combined.currency).toBe('EUR');
    expect(combined.merchantName).toBeNull();
    expect(combined.items.map((item) => item.receiptId)).toEqual(['receipt-a', 'receipt-b']);
    expect(combined.warnings).toEqual([
      { receiptId: 'receipt-a', message: 'review' },
      { receiptId: 'receipt-b', message: 'review' },
    ]);
  });

  it('keeps a common merchant but never combines different currencies', () => {
    expect(
      combineReceiptScans([
        { receiptId: 'receipt-a', result: scan('MERCADONA', 300) },
        { receiptId: 'receipt-b', result: scan('Mercadona', 700) },
      ]).merchantName,
    ).toBe('Mercadona');

    expect(() =>
      combineReceiptScans([
        { receiptId: 'receipt-a', result: scan('Store', 300, 'EUR') },
        { receiptId: 'receipt-b', result: scan('Store', 700, 'USD') },
      ]),
    ).toThrow('different currencies');
  });

  it('rejects duplicate receipt ids and unsafe combined totals', () => {
    expect(() =>
      combineReceiptScans([
        { receiptId: 'same', result: scan('A', 100) },
        { receiptId: 'same', result: scan('B', 100) },
      ]),
    ).toThrow('duplicate id');

    expect(() =>
      combineReceiptScans([
        { receiptId: 'a', result: scan('A', Number.MAX_SAFE_INTEGER) },
        { receiptId: 'b', result: scan('B', 1) },
      ]),
    ).toThrow('safe client cents range');
  });
});
