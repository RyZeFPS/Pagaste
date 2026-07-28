import { describe, expect, it } from 'vitest';
import { expenseReceiptSources, groupItemsByReceipt } from '../../src/domain/expense-receipts';
import type { ExpenseItem, ExpenseReceipt } from '../../src/lib/models';

function receipt(
  id: string,
  sortOrder: number,
  createdAt = '2026-07-26T10:00:00.000Z',
): ExpenseReceipt {
  return {
    id,
    expense_id: 'expense-1',
    storage_path: `user/expense-1/${id}.jpg`,
    mime_type: 'image/jpeg',
    original_name: `${id}.jpg`,
    sort_order: sortOrder,
    status: 'completed',
    scan_job_id: null,
    merchant_name: null,
    total_cents: 500,
    confidence: 0.9,
    error_code: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function item(
  id: string,
  receiptId: string | null,
  source: ExpenseItem['source'] = 'ocr',
): ExpenseItem {
  return {
    id,
    expense_id: 'expense-1',
    receipt_id: receiptId,
    name: id,
    quantity: 1,
    unit_price_cents: 100,
    line_total_cents: 100,
    category: null,
    sort_order: 0,
    ocr_confidence: source === 'ocr' ? 0.9 : null,
    source,
  };
}

describe('expense receipt presentation', () => {
  it('orders receipt metadata deterministically and ignores the legacy fallback', () => {
    const sources = expenseReceiptSources(
      [
        receipt('later', 1),
        receipt('b', 0, '2026-07-26T10:00:01.000Z'),
        receipt('a', 0, '2026-07-26T10:00:00.000Z'),
      ],
      'legacy.jpg',
    );

    expect(sources.map((source) => source.id)).toEqual(['a', 'b', 'later']);
    expect(sources.every((source) => !source.legacy)).toBe(true);
  });

  it('keeps old single-ticket drafts reviewable', () => {
    expect(expenseReceiptSources([], 'user/expense/ticket.jpg')).toEqual([
      expect.objectContaining({
        id: 'legacy:user/expense/ticket.jpg',
        storagePath: 'user/expense/ticket.jpg',
        legacy: true,
      }),
    ]);
  });

  it('groups lines by ticket and keeps unlinked manual lines separate', () => {
    const sources = expenseReceiptSources([receipt('first', 0), receipt('second', 1)], null);
    const groups = groupItemsByReceipt(
      [
        item('second-line', 'second'),
        item('manual-line', null, 'manual'),
        item('first-line', 'first'),
      ],
      sources,
    );

    expect(groups.map((group) => group.key)).toEqual(['first', 'second', 'manual']);
    expect(groups.map((group) => group.items.map((line) => line.id))).toEqual([
      ['first-line'],
      ['second-line'],
      ['manual-line'],
    ]);
  });

  it('associates only legacy OCR lines with a sole ticket', () => {
    const sources = expenseReceiptSources([], 'legacy.jpg');
    const groups = groupItemsByReceipt(
      [item('ocr-line', null), item('manual-line', null, 'manual')],
      sources,
    );

    expect(groups[0].items.map((line) => line.id)).toEqual(['ocr-line']);
    expect(groups[1].key).toBe('manual');
    expect(groups[1].items.map((line) => line.id)).toEqual(['manual-line']);
  });
});
