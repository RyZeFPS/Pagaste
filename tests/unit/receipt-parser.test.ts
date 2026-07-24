import { describe, expect, it } from 'vitest';
import { parseReceiptLines, ReceiptParseError } from '../../server/ocr/receipt-parser';

describe('receipt text parser', () => {
  it('extracts a known merchant, quantities, discounts and a reconciled total', () => {
    const result = parseReceiptLines(
      [
        { text: 'MERCADONA S.A.', confidence: 96 },
        { text: 'C/ MAYOR, 12', confidence: 91 },
        { text: '2 x AGUA MINERAL 0,75 1,50', confidence: 92 },
        { text: 'PAN INTEGRAL 2,40', confidence: 94 },
        { text: 'DESCUENTO CUPON -0,40', confidence: 88 },
        { text: 'TOTAL 3,50 EUR', confidence: 98 },
      ],
      { pageConfidence: 94, currencyHint: 'EUR' },
    );

    expect(result.merchantName).toBe('Mercadona');
    expect(result.merchantAddress).toBe('C/ MAYOR, 12');
    expect(result.totalCents).toBe(350);
    expect(result.items).toEqual([
      expect.objectContaining({
        name: 'AGUA MINERAL',
        quantity: 2,
        unitPriceCents: 75,
        lineTotalCents: 150,
      }),
      expect.objectContaining({
        name: 'PAN INTEGRAL',
        quantity: 1,
        lineTotalCents: 240,
      }),
      expect.objectContaining({
        name: 'DESCUENTO CUPON',
        lineTotalCents: -40,
      }),
    ]);
    expect(result.warnings).not.toContain(
      'La suma de productos no coincide con el total. Revisa las líneas detectadas.',
    );
  });

  it('warns instead of inventing missing product lines', () => {
    const result = parseReceiptLines([
      { text: 'CAFETERIA CENTRAL', confidence: 84 },
      { text: 'TOTAL A PAGAR 12,00 €', confidence: 91 },
    ]);

    expect(result.totalCents).toBe(1_200);
    expect(result.items).toEqual([
      expect.objectContaining({
        name: 'Total del ticket — revisar productos',
        lineTotalCents: 1_200,
      }),
    ]);
    expect(result.warnings).toContain(
      'No se han distinguido los productos. Revisa y sustituye la línea total.',
    );
  });

  it('falls back to a likely total but makes the uncertainty visible', () => {
    const result = parseReceiptLines([
      { text: 'BAR CENTRAL', confidence: 80 },
      { text: 'CAFE 1,50', confidence: 85 },
      { text: 'BOCADILLO 4,50', confidence: 86 },
      { text: '6,00', confidence: 70 },
    ]);

    expect(result.totalCents).toBe(600);
    expect(result.warnings).toContain(
      'No se ha leído claramente la palabra TOTAL; confirma el importe.',
    );
  });

  it('rejects empty or amount-less OCR output', () => {
    expect(() => parseReceiptLines([])).toThrowError(
      expect.objectContaining<Partial<ReceiptParseError>>({ code: 'OCR_TEXT_EMPTY' }),
    );
    expect(() => parseReceiptLines([{ text: 'SIN IMPORTES', confidence: 90 }])).toThrowError(
      expect.objectContaining<Partial<ReceiptParseError>>({ code: 'OCR_TOTAL_NOT_FOUND' }),
    );
  });
});
