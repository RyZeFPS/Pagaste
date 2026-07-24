-- Qualify the calculated amount column so it cannot be confused with the
-- amount_cents output parameter of this table-returning PL/pgSQL function.

create or replace function public.create_claims_transaction(p_expense_id uuid, p_claims jsonb)
returns table (claim_id uuid, debtor_participant_id uuid, amount_cents bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_expense public.expenses%rowtype;
  v_payer uuid;
  v_item_total bigint;
  v_own_share bigint;
  v_recoverable bigint;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if jsonb_typeof(p_claims) <> 'array'
    or jsonb_array_length(p_claims) = 0
    or jsonb_array_length(p_claims) > 100 then
    raise exception using errcode = '22023', message = 'INVALID_CLAIMS';
  end if;

  select * into v_expense
  from public.expenses
  where id = p_expense_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'EXPENSE_NOT_FOUND'; end if;
  if v_expense.created_by is distinct from v_actor then
    raise exception using errcode = '42501', message = 'NOT_EXPENSE_OWNER';
  end if;
  if v_expense.status <> 'draft' then
    raise exception using errcode = '55000', message = 'EXPENSE_NOT_DRAFT';
  end if;
  if v_expense.total_cents <= 0 then
    raise exception using errcode = '23514', message = 'INVALID_TOTAL';
  end if;

  select id into v_payer
  from public.expense_participants
  where expense_id = p_expense_id and is_payer;
  if v_payer is null then
    raise exception using errcode = '23514', message = 'PAYER_REQUIRED';
  end if;

  select coalesce(sum(line_total_cents), 0) into v_item_total
  from public.expense_items
  where expense_id = p_expense_id;
  if v_item_total <> v_expense.total_cents then
    raise exception using errcode = '23514', message = 'ITEM_TOTAL_MISMATCH';
  end if;

  if exists (
    select 1
    from public.expense_items i
    left join public.item_allocations a on a.item_id = i.id
    where i.expense_id = p_expense_id
    group by i.id, i.line_total_cents
    having coalesce(sum(a.amount_cents), 0) <> i.line_total_cents
  ) then
    raise exception using errcode = '23514', message = 'ALLOCATIONS_MISMATCH';
  end if;

  if exists (
    select 1
    from public.expense_items i
    join public.item_allocations a on a.item_id = i.id
    where i.expense_id = p_expense_id
    group by i.id, i.line_total_cents
    having count(distinct a.method) <> 1
      or bool_or(sign(a.amount_cents) <> sign(i.line_total_cents))
      or (
        min(a.method::text) = 'percentage'
        and sum(a.percentage) <> 100
      )
  ) then
    raise exception using errcode = '23514', message = 'ALLOCATION_METHOD_MISMATCH';
  end if;

  if exists (
    select 1
    from public.item_allocations a
    join public.expense_items i on i.id = a.item_id
    join public.expense_participants p on p.id = a.participant_id
    where i.expense_id = p_expense_id
      and p.expense_id <> p_expense_id
  ) then
    raise exception using errcode = '23514', message = 'ALLOCATION_PARTICIPANT_MISMATCH';
  end if;

  with supplied as (
    select
      (x."debtorParticipantId")::uuid as debtor_id,
      x."amountCents" as amount_cents,
      lower(x."tokenHash") as token_hash
    from jsonb_to_recordset(p_claims)
      as x("debtorParticipantId" text, "amountCents" bigint, "tokenHash" text)
  ), calculated as (
    select a.participant_id as debtor_id, sum(a.amount_cents)::bigint as amount_cents
    from public.item_allocations a
    join public.expense_items i on i.id = a.item_id
    where i.expense_id = p_expense_id
      and a.participant_id <> v_payer
    group by a.participant_id
    having sum(a.amount_cents) > 0
  )
  select
    coalesce((
      select sum(a.amount_cents)
      from public.item_allocations a
      join public.expense_items i on i.id = a.item_id
      where i.expense_id = p_expense_id and a.participant_id = v_payer
    ), 0),
    coalesce((select sum(calculated.amount_cents) from calculated), 0)
  into v_own_share, v_recoverable;

  if v_own_share + v_recoverable <> v_expense.total_cents then
    raise exception using errcode = '23514', message = 'DEBT_TOTAL_MISMATCH';
  end if;

  if exists (
    with supplied as (
      select
        (x."debtorParticipantId")::uuid as debtor_id,
        x."amountCents" as amount_cents,
        lower(x."tokenHash") as token_hash
      from jsonb_to_recordset(p_claims)
        as x("debtorParticipantId" text, "amountCents" bigint, "tokenHash" text)
    ), calculated as (
      select a.participant_id as debtor_id, sum(a.amount_cents)::bigint as amount_cents
      from public.item_allocations a
      join public.expense_items i on i.id = a.item_id
      where i.expense_id = p_expense_id
        and a.participant_id <> v_payer
      group by a.participant_id
      having sum(a.amount_cents) > 0
    )
    select 1
    from calculated c
    full join supplied s using (debtor_id)
    where c.debtor_id is null
      or s.debtor_id is null
      or c.amount_cents <> s.amount_cents
      or s.amount_cents is null
      or s.amount_cents <= 0
      or s.token_hash is null
      or s.token_hash !~ '^[0-9a-f]{64}$'
  ) or (
    select count(*) <> count(distinct (x."debtorParticipantId")::uuid)
    from jsonb_to_recordset(p_claims) as x("debtorParticipantId" text)
  ) then
    raise exception using errcode = '23514', message = 'CLAIM_AMOUNTS_MISMATCH';
  end if;

  update public.expenses set
    payer_participant_id = v_payer,
    own_share_cents = v_own_share,
    recoverable_cents = v_recoverable,
    status = 'sent',
    sent_at = now()
  where id = p_expense_id;

  return query
  with supplied as (
    select
      (x."debtorParticipantId")::uuid as debtor_id,
      x."amountCents" as amount_cents,
      lower(x."tokenHash") as token_hash
    from jsonb_to_recordset(p_claims)
      as x("debtorParticipantId" text, "amountCents" bigint, "tokenHash" text)
  ), inserted as (
    insert into public.claims (
      expense_id,
      debtor_participant_id,
      creditor_participant_id,
      amount_cents,
      status,
      public_token_hash,
      sent_at
    )
    select
      p_expense_id,
      s.debtor_id,
      v_payer,
      s.amount_cents,
      'pending',
      s.token_hash,
      now()
    from supplied s
    returning id, claims.debtor_participant_id, claims.amount_cents
  ), events as (
    insert into public.claim_events (claim_id, actor_type, actor_user_id, event_type)
    select i.id, 'owner', v_actor, 'claim_sent'
    from inserted i
  )
  select i.id, i.debtor_participant_id, i.amount_cents
  from inserted i;
end;
$$;
