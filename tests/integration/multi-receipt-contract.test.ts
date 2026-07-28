import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = readFileSync(
  join(root, 'supabase', 'migrations', '20260726133120_multi_receipt_imports.sql'),
  'utf8',
);
const scanFunction = readFileSync(
  join(root, 'supabase', 'functions', 'scan-receipt', 'index.ts'),
  'utf8',
);
const scanScreen = readFileSync(
  join(root, 'src', 'app', 'expense', '[expenseId]', 'scan.tsx'),
  'utf8',
);

describe('multi receipt security and persistence contract', () => {
  it('keeps receipt metadata behind explicit grants and row-level policies', () => {
    expect(migration).toContain('alter table public.expense_receipts enable row level security');
    expect(migration).toContain(
      'revoke all on public.expense_receipts from public, anon, authenticated',
    );
    expect(migration).toContain(
      'grant select, insert, update, delete on public.expense_receipts to authenticated',
    );
    expect(migration).toMatch(
      /create policy expense_receipts_select_authorized[\s\S]*?to authenticated[\s\S]*?private\.owns_expense\(expense_id\)/u,
    );
  });

  it('binds every stored path to the authenticated owner and exact expense', () => {
    const ownershipPredicate =
      /storage_path like \(select auth\.uid\(\)\)::text \|\| '\/' \|\| expense_id::text \|\| '\/%'/gu;
    expect([...migration.matchAll(ownershipPredicate)]).toHaveLength(2);
    expect(migration).toContain("check (mime_type in ('image/jpeg', 'image/png', 'image/webp'))");
    expect(migration).toContain('check (char_length(storage_path) between 10 and 700)');
  });

  it('prevents an OCR line from referencing a receipt in another expense', () => {
    expect(migration).toMatch(
      /foreign key \(receipt_id, expense_id\)[\s\S]*?references public\.expense_receipts\(id, expense_id\)/u,
    );
    expect(migration).toContain("not ((item.value ->> 'receiptId')::uuid = any (p_receipt_ids))");
    expect(migration).toMatch(
      /foreign key \(scan_job_id, expense_id\)[\s\S]*?references public\.receipt_scan_jobs\(id, expense_id\)/u,
    );
  });

  it('uses one invoker transaction and validates optional unit prices', () => {
    expect(migration).toMatch(
      /function public\.apply_multi_receipt_result[\s\S]*?security invoker/u,
    );
    expect(migration).not.toMatch(
      /function public\.apply_multi_receipt_result[\s\S]*?security definer/u,
    );
    expect(migration).toContain("item.value -> 'unitPriceCents'");
    expect(migration).toContain('not between -9007199254740991 and 9007199254740991');
    expect(migration).toContain("!~ '^[0-9]{1,9}([.][0-9]{1,3})?$'");
    expect(migration).toContain(
      'revoke execute on function public.apply_multi_receipt_result(uuid, uuid[], jsonb)',
    );
  });

  it('scans queue items without replacing the draft until the final merge', () => {
    expect(scanFunction).toContain('persistResult: z.boolean().default(true)');
    expect(scanFunction).toContain('if (input.persistResult)');
    expect(scanScreen).toContain('allowsMultipleSelection: true');
    expect(scanScreen).toContain('persistResult: false');
    expect(scanScreen).toContain('applyMultiReceiptResult');
  });
});
