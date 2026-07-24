create or replace function public.apply_receipt_scan_result(
  p_job_id uuid,
  p_expense_id uuid,
  p_result jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total bigint;
  v_confidence numeric;
  v_items jsonb := p_result -> 'items';
begin
  if p_result is null
    or jsonb_typeof(p_result) <> 'object'
    or jsonb_typeof(v_items) <> 'array'
    or jsonb_array_length(v_items) = 0
  then
    raise exception using errcode = '22023', message = 'INVALID_OCR_RESULT';
  end if;

  begin
    v_total := (p_result ->> 'totalCents')::bigint;
    v_confidence := (p_result ->> 'confidence')::numeric;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'INVALID_OCR_RESULT';
  end;

  if v_total <= 0
    or v_confidence not between 0 and 1
    or coalesce(p_result ->> 'currency', '') !~ '^[A-Z]{3}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_OCR_RESULT';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_items) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or char_length(trim(coalesce(item.value ->> 'name', ''))) not between 1 and 160
      or coalesce(item.value ->> 'quantity', '') !~ '^[0-9]+([.][0-9]+)?$'
      or (item.value ->> 'quantity')::numeric <= 0
      or coalesce(item.value ->> 'lineTotalCents', '') !~ '^-?[0-9]+$'
      or (item.value ->> 'lineTotalCents')::bigint = 0
      or coalesce(item.value ->> 'confidence', '') !~ '^(0([.][0-9]+)?|1([.]0+)?)$'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_OCR_ITEM';
  end if;

  perform 1
  from public.expenses
  where id = p_expense_id
    and status = 'draft'
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'EXPENSE_NOT_EDITABLE';
  end if;

  perform 1
  from public.receipt_scan_jobs
  where id = p_job_id
    and expense_id = p_expense_id
    and status = 'processing'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SCAN_JOB_NOT_FOUND';
  end if;

  delete from public.expense_items
  where expense_id = p_expense_id
    and source = 'ocr';

  insert into public.expense_items (
    expense_id,
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
    trim(item.value ->> 'name'),
    (item.value ->> 'quantity')::numeric,
    (item.value ->> 'unitPriceCents')::bigint,
    (item.value ->> 'lineTotalCents')::bigint,
    null,
    item.ordinality::integer - 1,
    (item.value ->> 'confidence')::numeric,
    'ocr'
  from jsonb_array_elements(v_items) with ordinality as item(value, ordinality);

  update public.expenses
  set
    merchant_name = nullif(left(p_result ->> 'merchantName', 120), ''),
    occurred_at = coalesce(nullif(p_result ->> 'occurredAt', '')::timestamptz, occurred_at),
    currency = p_result ->> 'currency',
    total_cents = v_total,
    own_share_cents = v_total,
    recoverable_cents = 0,
    scan_status = 'completed'
  where id = p_expense_id;

  update public.receipt_scan_jobs
  set
    status = 'completed',
    confidence = v_confidence,
    warnings = coalesce(p_result -> 'warnings', '[]'::jsonb),
    completed_at = now(),
    error_code = null
  where id = p_job_id
    and expense_id = p_expense_id;
end;
$$;

revoke execute on function public.apply_receipt_scan_result(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.apply_receipt_scan_result(uuid, uuid, jsonb)
to service_role;

comment on function public.apply_receipt_scan_result(uuid, uuid, jsonb) is
  'Atomically persists validated OCR items and completes a receipt scan job.';
