import type { ExpenseItem, ExpenseReceipt } from '@/lib/models';

export type ExpenseReceiptSource = {
  id: string;
  storagePath: string;
  originalName: string | null;
  merchantName: string | null;
  totalCents: number | null;
  sortOrder: number;
  createdAt: string;
  legacy: boolean;
};

export type ExpenseReceiptItemGroup = {
  key: string;
  receipt: ExpenseReceiptSource | null;
  receiptIndex: number | null;
  items: ExpenseItem[];
};

/**
 * Keeps receipt ordering deterministic even if a client receives rows with the
 * same sort order. Older single-ticket drafts remain reviewable through the
 * legacy `expenses.receipt_path` fallback.
 */
export function expenseReceiptSources(
  receipts: readonly ExpenseReceipt[],
  legacyReceiptPath: string | null,
): ExpenseReceiptSource[] {
  if (receipts.length) {
    return [...receipts]
      .sort(
        (left, right) =>
          left.sort_order - right.sort_order ||
          left.created_at.localeCompare(right.created_at) ||
          left.id.localeCompare(right.id),
      )
      .map((receipt) => ({
        id: receipt.id,
        storagePath: receipt.storage_path,
        originalName: receipt.original_name,
        merchantName: receipt.merchant_name,
        totalCents: receipt.total_cents,
        sortOrder: receipt.sort_order,
        createdAt: receipt.created_at,
        legacy: false,
      }));
  }

  return legacyReceiptPath
    ? [
        {
          id: `legacy:${legacyReceiptPath}`,
          storagePath: legacyReceiptPath,
          originalName: null,
          merchantName: null,
          totalCents: null,
          sortOrder: 0,
          createdAt: '',
          legacy: true,
        },
      ]
    : [];
}

/**
 * Groups every line with its source ticket. OCR lines from older single-ticket
 * drafts did not have a `receipt_id`, so only those OCR lines are associated
 * with the sole available ticket; user-created lines stay in the manual group.
 */
export function groupItemsByReceipt(
  items: readonly ExpenseItem[],
  receipts: readonly ExpenseReceiptSource[],
): ExpenseReceiptItemGroup[] {
  const receiptIndexes = new Map(receipts.map((receipt, index) => [receipt.id, index]));
  const receiptItems = receipts.map(() => [] as ExpenseItem[]);
  const manualItems: ExpenseItem[] = [];

  for (const item of items) {
    const explicitIndex = item.receipt_id ? receiptIndexes.get(item.receipt_id) : undefined;
    const fallbackIndex =
      explicitIndex === undefined &&
      !item.receipt_id &&
      receipts.length === 1 &&
      item.source === 'ocr'
        ? 0
        : undefined;
    const receiptIndex = explicitIndex ?? fallbackIndex;

    if (receiptIndex === undefined) manualItems.push(item);
    else receiptItems[receiptIndex].push(item);
  }

  const groups: ExpenseReceiptItemGroup[] = receipts.flatMap((receipt, receiptIndex) =>
    receiptItems[receiptIndex].length
      ? [
          {
            key: receipt.id,
            receipt,
            receiptIndex,
            items: receiptItems[receiptIndex],
          },
        ]
      : [],
  );

  if (manualItems.length) {
    groups.push({
      key: 'manual',
      receipt: null,
      receiptIndex: null,
      items: manualItems,
    });
  }

  return groups;
}
