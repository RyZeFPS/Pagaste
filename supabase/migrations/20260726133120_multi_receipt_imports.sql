create table public.expense_receipts (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  storage_path text not null unique
    check (char_length(storage_path) between 10 and 700),
  mime_type text not null default 'image/jpeg'
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  original_name text
    check (original_name is null or char_length(original_name) between 1 and 255),
  sort_order integer not null default 0
    check (sort_order between 0 and 19),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  scan_job_id uuid,
  merchant_name text
    check (merchant_name is null or char_length(merchant_name) between 1 and 120),
  total_cents bigint
    check (total_cents is null or total_cents between 1 and 9007199254740991),
  confidence numeric
    check (confidence is null or confidence between 0 and 1),
  error_code text
    check (error_code is null or char_length(error_code) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (expense_id, sort_order),
  unique (id, expense_id),
  unique (scan_job_id)
);

alter table public.receipt_scan_jobs
  add constraint receipt_scan_jobs_id_expense_unique
    unique (id, expense_id);

alter table public.expense_receipts
  add constraint expense_receipts_scan_job_expense_fkey
    foreign key (scan_job_id, expense_id)
    references public.receipt_scan_jobs(id, expense_id)
    on delete set null (scan_job_id);

create index expense_receipts_expense_status_idx
  on public.expense_receipts (expense_id, status, sort_order);

create trigger expense_receipts_set_updated_at
before update on public.expense_receipts
for each row execute function private.set_updated_at();

alter table public.expense_receipts enable row level security;

create policy expense_receipts_select_authorized
on public.expense_receipts
for select
to authenticated
using ((select private.owns_expense(expense_id)));

create policy expense_receipts_insert_draft_owner
on public.expense_receipts
for insert
to authenticated
with check (
  private.owns_draft_expense(expense_id)
  and storage_path like (select auth.uid())::text || '/' || expense_id::text || '/%'
);

create policy expense_receipts_update_draft_owner
on public.expense_receipts
for update
to authenticated
using (private.owns_draft_expense(expense_id))
with check (
  private.owns_draft_expense(expense_id)
  and storage_path like (select auth.uid())::text || '/' || expense_id::text || '/%'
);

create policy expense_receipts_delete_draft_owner
on public.expense_receipts
for delete
to authenticated
using (private.owns_draft_expense(expense_id));

revoke all on public.expense_receipts from public, anon, authenticated;
grant select, insert, update, delete on public.expense_receipts to authenticated;
grant all on public.expense_receipts to service_role;

alter table public.expense_items
  add column receipt_id uuid,
  add constraint expense_items_receipt_expense_fk
    foreign key (receipt_id, expense_id)
    references public.expense_receipts(id, expense_id)
    on delete cascade;

create index expense_items_receipt_idx
  on public.expense_items (receipt_id, sort_order)
  where receipt_id is not null;

create or replace function public.apply_multi_receipt_result(
  p_expense_id uuid,
  p_receipt_ids uuid[],
  p_result jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_items jsonb := p_result -> 'items';
  v_total bigint;
  v_currency text;
  v_expected_count integer;
  v_receipt_count integer;
  v_receipts_total bigint;
  v_sort_offset integer;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception using errcode = '22023', message = 'INVALID_MULTI_RECEIPT_RESULT';
  end if;

  if coalesce(jsonb_typeof(v_items), '') <> 'array'
    or jsonb_array_length(v_items) = 0
    or jsonb_array_length(v_items) > 1000
    or coalesce(array_length(p_receipt_ids, 1), 0) = 0
    or coalesce(array_length(p_receipt_ids, 1), 0) > 20
  then
    raise exception using errcode = '22023', message = 'INVALID_MULTI_RECEIPT_RESULT';
  end if;

  begin
    v_total := (p_result ->> 'totalCents')::bigint;
    v_currency := p_result ->> 'currency';
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'INVALID_MULTI_RECEIPT_RESULT';
  end;

  if v_total not between 1 and 9007199254740991
    or coalesce(v_currency, '') !~ '^[A-Z]{3}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_MULTI_RECEIPT_RESULT';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_items) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or char_length(trim(coalesce(item.value ->> 'name', ''))) not between 1 and 160
      or coalesce(item.value ->> 'quantity', '')
        !~ '^[0-9]{1,9}([.][0-9]{1,3})?$'
      or (item.value ->> 'quantity')::numeric <= 0
      or coalesce(item.value ->> 'lineTotalCents', '') !~ '^-?[0-9]+$'
      or (item.value ->> 'lineTotalCents')::numeric
        not between -9007199254740991 and 9007199254740991
      or (item.value ->> 'lineTotalCents')::numeric = 0
      or coalesce(item.value ->> 'confidence', '')
        !~ '^(0([.][0-9]{1,4})?|1([.]0{1,4})?)$'
      or case
        when item.value -> 'unitPriceCents' is null
          or jsonb_typeof(item.value -> 'unitPriceCents') = 'null'
          then false
        when coalesce(item.value ->> 'unitPriceCents', '') ~ '^-?[0-9]+$'
          then (item.value ->> 'unitPriceCents')::numeric
            not between -9007199254740991 and 9007199254740991
        else true
      end
      or coalesce(item.value ->> 'receiptId', '')
        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or not ((item.value ->> 'receiptId')::uuid = any (p_receipt_ids))
  ) then
    raise exception using errcode = '22023', message = 'INVALID_MULTI_RECEIPT_ITEM';
  end if;

  perform 1
  from public.expenses
  where id = p_expense_id
    and status = 'draft'
    and created_by = (select auth.uid())
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'EXPENSE_NOT_EDITABLE';
  end if;

  select count(*), count(distinct id), sum(total_cents)
  into v_expected_count, v_receipt_count, v_receipts_total
  from public.expense_receipts
  where expense_id = p_expense_id
    and id = any (p_receipt_ids)
    and status = 'completed';

  if v_expected_count <> coalesce(array_length(p_receipt_ids, 1), 0)
    or v_receipt_count <> coalesce(array_length(p_receipt_ids, 1), 0)
    or v_receipts_total <> v_total
    or (
      select count(distinct (item.value ->> 'receiptId')::uuid)
      from jsonb_array_elements(v_items) as item(value)
    ) <> coalesce(array_length(p_receipt_ids, 1), 0)
  then
    raise exception using errcode = '22023', message = 'RECEIPT_SET_INCOMPLETE';
  end if;

  delete from public.expense_items
  where expense_id = p_expense_id
    and source = 'ocr';

  select coalesce(max(sort_order) + 1, 0)
  into v_sort_offset
  from public.expense_items
  where expense_id = p_expense_id;

  insert into public.expense_items (
    expense_id,
    receipt_id,
    name,
    quantity,
    unit_price_cents,
    line_total_cents,
    category,
    sort_order,
    ocr_confidence,
    source
  )
  select
    p_expense_id,
    (item.value ->> 'receiptId')::uuid,
    trim(item.value ->> 'name'),
    (item.value ->> 'quantity')::numeric,
    nullif(item.value ->> 'unitPriceCents', '')::bigint,
    (item.value ->> 'lineTotalCents')::bigint,
    null,
    v_sort_offset + item.ordinality::integer - 1,
    (item.value ->> 'confidence')::numeric,
    'ocr'
  from jsonb_array_elements(v_items) with ordinality as item(value, ordinality);

  update public.expenses
  set
    merchant_name = nullif(left(p_result ->> 'merchantName', 120), ''),
    currency = v_currency,
    total_cents = v_total,
    own_share_cents = v_total,
    recoverable_cents = 0,
    receipt_path = (
      select storage_path
      from public.expense_receipts
      where expense_id = p_expense_id
        and id = any (p_receipt_ids)
      order by sort_order
      limit 1
    ),
    scan_status = 'completed'
  where id = p_expense_id;
end;
$$;

revoke execute on function public.apply_multi_receipt_result(uuid, uuid[], jsonb)
from public, anon, authenticated;
grant execute on function public.apply_multi_receipt_result(uuid, uuid[], jsonb)
to authenticated;

comment on table public.expense_receipts is
  'Private ordered receipt assets imported into one expense draft.';
comment on function public.apply_multi_receipt_result(uuid, uuid[], jsonb) is
  'Atomically replaces OCR lines with the validated combination of completed receipt scans.';
