-- Optional correction learning stores only aggregate OCR text pairs. It never
-- stores a profile, expense, receipt, merchant, token or request identifier.

alter table public.profiles
  add column if not exists ocr_learning_consent boolean not null default false;

create table private.ocr_correction_patterns (
  ocr_text text not null
    check (char_length(ocr_text) between 1 and 160),
  corrected_text text not null
    check (char_length(corrected_text) between 1 and 160),
  correction_count bigint not null default 1
    check (correction_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (ocr_text, corrected_text),
  check (ocr_text <> lower(corrected_text))
);

revoke all on table private.ocr_correction_patterns
  from public, anon, authenticated, service_role;

create or replace function public.submit_anonymous_ocr_correction(
  p_item_id uuid,
  p_corrected_text text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_original text;
  v_corrected text;
  v_item_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_item_id is null or p_corrected_text is null then
    raise exception using errcode = '22023', message = 'INVALID_OCR_CORRECTION';
  end if;
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = v_actor
      and profile.ocr_learning_consent
  ) then
    return false;
  end if;

  select
    item.id,
    lower(trim(item.name)),
    trim(p_corrected_text)
  into v_item_id, v_original, v_corrected
  from public.expense_items item
  join public.expenses expense on expense.id = item.expense_id
  where item.id = p_item_id
    and item.source = 'ocr'
    and expense.status = 'draft'
    and expense.created_by = v_actor
  for update of item;

  if not found then
    return false;
  end if;
  if char_length(v_corrected) not between 1 and 160
    or v_original = lower(v_corrected)
  then
    return false;
  end if;

  insert into private.ocr_correction_patterns (
    ocr_text,
    corrected_text
  ) values (
    v_original,
    v_corrected
  )
  on conflict (ocr_text, corrected_text)
  do update set
    correction_count =
      private.ocr_correction_patterns.correction_count + 1,
    last_seen_at = now();

  -- Make submission and correction one transaction. Besides avoiding a failed
  -- UI update after a successful vote, changing the source prevents repeated
  -- calls for the same OCR line from poisoning the aggregate count.
  update public.expense_items
  set
    name = v_corrected,
    source = 'manual',
    ocr_confidence = null
  where id = v_item_id;

  return true;
end;
$$;

revoke all on function public.submit_anonymous_ocr_correction(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_anonymous_ocr_correction(uuid, text)
  to authenticated;

create or replace function public.suggest_anonymous_ocr_corrections(
  p_ocr_texts text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_ocr_texts is null
    or cardinality(p_ocr_texts) > 300
    or exists (
      select 1
      from unnest(p_ocr_texts) value
      where value is null
        or char_length(trim(value)) not between 1 and 160
    )
  then
    raise exception using errcode = '22023', message = 'INVALID_OCR_CORRECTION_LOOKUP';
  end if;

  with requested as (
    select distinct lower(trim(value)) as ocr_text
    from unnest(p_ocr_texts) value
  ),
  ranked as (
    select
      pattern.ocr_text,
      pattern.corrected_text,
      pattern.correction_count,
      sum(pattern.correction_count) over (
        partition by pattern.ocr_text
      ) as total_count,
      row_number() over (
        partition by pattern.ocr_text
        order by
          pattern.correction_count desc,
          pattern.last_seen_at desc,
          pattern.corrected_text
      ) as preference
    from private.ocr_correction_patterns pattern
    join requested on requested.ocr_text = pattern.ocr_text
  )
  select coalesce(
    jsonb_object_agg(ranked.ocr_text, ranked.corrected_text),
    '{}'::jsonb
  )
  into v_result
  from ranked
  where ranked.preference = 1
    and ranked.correction_count >= 3
    and ranked.correction_count * 5 >= ranked.total_count * 4;

  return v_result;
end;
$$;

revoke all on function public.suggest_anonymous_ocr_corrections(text[])
  from public, anon, authenticated, service_role;
grant execute on function public.suggest_anonymous_ocr_corrections(text[])
  to service_role;
