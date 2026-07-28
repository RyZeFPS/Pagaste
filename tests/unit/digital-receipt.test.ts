import { describe, expect, it } from 'vitest';
import { parseDigitalReceiptText } from '../../src/domain/digital-receipt';

describe('digital receipt text import', () => {
  it('parses a copied Spanish order with quantities and an explicit total', () => {
    expect(
      parseDigitalReceiptText(`
        Bella Napoli
        Pedido 481
        2 x Pizza barbacoa     21,00 €
        Coca Cola               2,50 €
        Descuento              -1,50 €
        TOTAL                  22,00 €
      `),
    ).toEqual({
      merchantName: 'Bella Napoli',
      totalCents: 2_200,
      items: [
        { name: 'Pizza barbacoa', quantity: 2, lineTotalCents: 2_100 },
        { name: 'Coca Cola', quantity: 1, lineTotalCents: 250 },
        { name: 'Descuento', quantity: 1, lineTotalCents: -150 },
      ],
      warnings: [],
    });
  });

  it('infers a total without inventing lines', () => {
    const result = parseDigitalReceiptText('Coffee Place\nLatte 3.25\nCookie 2.00', 'en-US');
    expect(result.totalCents).toBe(525);
    expect(result.warnings).toEqual(['total_inferred']);
    expect(result.merchantName).toBe('Coffee Place');
  });

  it('reports a mismatch and rejects empty or unstructured clipboard text', () => {
    const result = parseDigitalReceiptText('Tienda\nProducto 4,00 €\nTotal 5,00 €');
    expect(result.warnings).toEqual(['items_do_not_match_total']);
    expect(() => parseDigitalReceiptText('   ')).toThrow('digital_receipt_empty');
    expect(() => parseDigitalReceiptText('Esto no contiene importes')).toThrow(
      'digital_receipt_no_items',
    );
  });
});
