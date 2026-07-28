create index if not exists expense_collaboration_guests_participant_idx
  on public.expense_collaboration_guests (participant_id);

create index if not exists expense_items_receipt_expense_idx
  on public.expense_items (receipt_id, expense_id);

create index if not exists expense_receipts_scan_job_expense_idx
  on public.expense_receipts (scan_job_id, expense_id);
