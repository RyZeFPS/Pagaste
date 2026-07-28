-- Repeat a completed expense as a fresh draft without copying its claims,
-- receipt or delivery state. The function is security-invoker so every read
-- and write remains subject to the existing expense RLS policies.
create function public.repeat_expense(p_source_expense_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_source public.expenses%rowtype;
  v_source_participant public.expense_participants%rowtype;
  v_source_item public.expense_items%rowtype;
  v_source_allocation public.item_allocations%rowtype;
  v_expense_id uuid := gen_random_uuid();
  v_participant_id uuid;
  v_item_id uuid;
  v_payer_participant_id uuid;
  v_mapped_participant_id uuid;
  v_participant_map jsonb := '{}'::jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_source_expense_id is null then
    raise exception using errcode = '22023', message = 'INVALID_SOURCE_EXPENSE';
  end if;

  select *
    into v_source
  from public.expenses
  where id = p_source_expense_id;

  -- The explicit ownership check prevents a group member from turning another
  -- person's expense into a template and avoids leaking whether an inaccessible
  -- expense exists.
  if not found or v_source.created_by is distinct from v_actor then
    raise exception using errcode = '42501', message = 'EXPENSE_REPEAT_FORBIDDEN';
  end if;
  if v_source.status not in ('sent', 'settled') then
    raise exception using errcode = '55000', message = 'EXPENSE_NOT_REPEATABLE';
  end if;
  if v_source.group_id is not null and not private.is_group_member(v_source.group_id) then
    raise exception using errcode = '42501', message = 'GROUP_NO_LONGER_AVAILABLE';
  end if;
  if not exists (
    select 1 from public.expense_items where expense_id = v_source.id
  ) then
    raise exception using errcode = '55000', message = 'SOURCE_EXPENSE_HAS_NO_ITEMS';
  end if;

  insert into public.expenses (
    id,
    group_id,
    created_by,
    payer_member_id,
    payer_participant_id,
    title,
    merchant_name,
    occurred_at,
    currency,
    total_cents,
    recoverable_cents,
    own_share_cents,
    receipt_path,
    status,
    scan_status,
    notes
  )
  values (
    v_expense_id,
    v_source.group_id,
    v_actor,
    v_source.payer_member_id,
    null,
    v_source.title,
    v_source.merchant_name,
    now(),
    v_source.currency,
    v_source.total_cents,
    0,
    v_source.total_cents,
    null,
    'draft',
    'idle',
    null
  );

  for v_source_participant in
    select *
    from public.expense_participants
    where expense_id = v_source.id
    order by sort_order, id
  loop
    v_participant_id := gen_random_uuid();
    insert into public.expense_participants (
      id,
      expense_id,
      user_id,
      display_name,
      avatar_path,
      email,
      phone_e164,
      is_payer,
      sort_order
    )
    values (
      v_participant_id,
      v_expense_id,
      v_source_participant.user_id,
      v_source_participant.display_name,
      v_source_participant.avatar_path,
      v_source_participant.email,
      v_source_participant.phone_e164,
      v_source_participant.is_payer,
      v_source_participant.sort_order
    );
    v_participant_map :=
      v_participant_map ||
      jsonb_build_object(v_source_participant.id::text, v_participant_id::text);
    if v_source_participant.id = v_source.payer_participant_id
      or v_source_participant.is_payer then
      v_payer_participant_id := v_participant_id;
    end if;
  end loop;

  if v_payer_participant_id is null then
    raise exception using errcode = '55000', message = 'SOURCE_EXPENSE_HAS_NO_PAYER';
  end if;

  update public.expenses
  set payer_participant_id = v_payer_participant_id
  where id = v_expense_id;

  for v_source_item in
    select *
    from public.expense_items
    where expense_id = v_source.id
    order by sort_order, id
  loop
    if not exists (
      select 1
      from public.item_allocations
      where item_id = v_source_item.id
    ) then
      raise exception using errcode = '55000', message = 'SOURCE_ITEM_HAS_NO_ALLOCATIONS';
    end if;

    v_item_id := gen_random_uuid();
    insert into public.expense_items (
      id,
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
    values (
      v_item_id,
      v_expense_id,
      v_source_item.name,
      v_source_item.quantity,
      v_source_item.unit_price_cents,
      v_source_item.line_total_cents,
      v_source_item.category,
      v_source_item.sort_order,
      null,
      case when v_source_item.source = 'adjustment' then 'adjustment' else 'manual' end
    );

    for v_source_allocation in
      select *
      from public.item_allocations
      where item_id = v_source_item.id
      order by id
    loop
      v_mapped_participant_id :=
        (v_participant_map ->> v_source_allocation.participant_id::text)::uuid;
      if v_mapped_participant_id is null then
        raise exception using errcode = '55000', message = 'SOURCE_ALLOCATION_PARTICIPANT_MISSING';
      end if;
      insert into public.item_allocations (
        item_id,
        participant_id,
        method,
        shares,
        percentage,
        units,
        amount_cents
      )
      values (
        v_item_id,
        v_mapped_participant_id,
        v_source_allocation.method,
        v_source_allocation.shares,
        v_source_allocation.percentage,
        v_source_allocation.units,
        v_source_allocation.amount_cents
      );
    end loop;
  end loop;

  return jsonb_build_object(
    'expenseId', v_expense_id,
    'sourceExpenseId', v_source.id,
    -- Consumed only by the hardened wrapper in the following migration. Keeping
    -- the exact mapping avoids ever pairing contributors by regenerated UUIDs.
    'participantMap', v_participant_map
  );
end;
$$;

-- Atomically change a copied line price, keep its participant/method metadata
-- and replace only the calculated allocation amounts.
create function public.update_repeated_expense_item(
  p_expense_id uuid,
  p_item_id uuid,
  p_line_total_cents bigint,
  p_allocations jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_expense public.expenses%rowtype;
  v_item public.expense_items%rowtype;
  v_total bigint;
  v_allocation_count integer;
  v_allocation_total bigint;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_expense_id is null
    or p_item_id is null
    or p_line_total_cents is null
    or p_line_total_cents = 0 then
    raise exception using errcode = '22023', message = 'INVALID_REPEATED_ITEM';
  end if;
  if jsonb_typeof(p_allocations) <> 'array'
    or jsonb_array_length(p_allocations) = 0 then
    raise exception using errcode = '22023', message = 'ALLOCATIONS_REQUIRED';
  end if;

  select *
    into v_expense
  from public.expenses
  where id = p_expense_id
  for update;

  if not found
    or v_expense.created_by is distinct from v_actor
    or v_expense.status <> 'draft' then
    raise exception using errcode = '42501', message = 'DRAFT_EXPENSE_REQUIRED';
  end if;

  select *
    into v_item
  from public.expense_items
  where id = p_item_id and expense_id = p_expense_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ITEM_NOT_FOUND';
  end if;
  if (v_item.source = 'adjustment' and p_line_total_cents > 0)
    or (v_item.source <> 'adjustment' and p_line_total_cents < 0) then
    raise exception using errcode = '22023', message = 'ITEM_SIGN_MISMATCH';
  end if;

  with allocation_rows as (
    select *
    from jsonb_to_recordset(p_allocations) as value(
      participant_id uuid,
      method public.allocation_method,
      shares numeric,
      percentage numeric,
      units numeric,
      amount_cents bigint
    )
  )
  select count(*), coalesce(sum(amount_cents), 0)
    into v_allocation_count, v_allocation_total
  from allocation_rows;

  if v_allocation_count <> jsonb_array_length(p_allocations)
    or v_allocation_total <> p_line_total_cents
    or exists (
      select 1
      from jsonb_to_recordset(p_allocations) as value(
        participant_id uuid,
        method public.allocation_method,
        shares numeric,
        percentage numeric,
        units numeric,
        amount_cents bigint
      )
      where value.participant_id is null
        or value.method is null
        or value.amount_cents is null
        or value.amount_cents = 0
    )
    or exists (
      select value.participant_id
      from jsonb_to_recordset(p_allocations) as value(
        participant_id uuid,
        method public.allocation_method,
        shares numeric,
        percentage numeric,
        units numeric,
        amount_cents bigint
      )
      group by value.participant_id
      having count(*) > 1
    )
    or exists (
      select 1
      from jsonb_to_recordset(p_allocations) as value(
        participant_id uuid,
        method public.allocation_method,
        shares numeric,
        percentage numeric,
        units numeric,
        amount_cents bigint
      )
      left join public.expense_participants participant
        on participant.id = value.participant_id
       and participant.expense_id = p_expense_id
      where participant.id is null
    ) then
    raise exception using errcode = '22023', message = 'INVALID_ALLOCATIONS';
  end if;

  update public.expense_items
  set
    line_total_cents = p_line_total_cents,
    unit_price_cents = case
      when trunc(quantity) = quantity
        and mod(p_line_total_cents, quantity::bigint) = 0
      then p_line_total_cents / quantity::bigint
      else null
    end
  where id = p_item_id;

  delete from public.item_allocations where item_id = p_item_id;
  insert into public.item_allocations (
    item_id,
    participant_id,
    method,
    shares,
    percentage,
    units,
    amount_cents
  )
  select
    p_item_id,
    value.participant_id,
    value.method,
    value.shares,
    value.percentage,
    value.units,
    value.amount_cents
  from jsonb_to_recordset(p_allocations) as value(
    participant_id uuid,
    method public.allocation_method,
    shares numeric,
    percentage numeric,
    units numeric,
    amount_cents bigint
  );

  select coalesce(sum(line_total_cents), 0)
    into v_total
  from public.expense_items
  where expense_id = p_expense_id;
  if v_total <= 0 then
    raise exception using errcode = '22023', message = 'EXPENSE_TOTAL_MUST_BE_POSITIVE';
  end if;

  update public.expenses
  set total_cents = v_total, recoverable_cents = 0, own_share_cents = v_total
  where id = p_expense_id;

  return jsonb_build_object(
    'expenseId', p_expense_id,
    'itemId', p_item_id,
    'totalCents', v_total
  );
end;
$$;

create function public.delete_repeated_expense_item(
  p_expense_id uuid,
  p_item_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_expense public.expenses%rowtype;
  v_total bigint;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select *
    into v_expense
  from public.expenses
  where id = p_expense_id
  for update;
  if not found
    or v_expense.created_by is distinct from v_actor
    or v_expense.status <> 'draft' then
    raise exception using errcode = '42501', message = 'DRAFT_EXPENSE_REQUIRED';
  end if;
  if not exists (
    select 1 from public.expense_items where id = p_item_id and expense_id = p_expense_id
  ) then
    raise exception using errcode = 'P0002', message = 'ITEM_NOT_FOUND';
  end if;
  if (
    select count(*) from public.expense_items where expense_id = p_expense_id
  ) <= 1 then
    raise exception using errcode = '55000', message = 'LAST_ITEM_REQUIRED';
  end if;

  delete from public.expense_items
  where id = p_item_id and expense_id = p_expense_id;

  select coalesce(sum(line_total_cents), 0)
    into v_total
  from public.expense_items
  where expense_id = p_expense_id;
  if v_total <= 0 then
    raise exception using errcode = '22023', message = 'EXPENSE_TOTAL_MUST_BE_POSITIVE';
  end if;

  update public.expenses
  set total_cents = v_total, recoverable_cents = 0, own_share_cents = v_total
  where id = p_expense_id;

  return jsonb_build_object(
    'expenseId', p_expense_id,
    'itemId', p_item_id,
    'totalCents', v_total
  );
end;
$$;

revoke all on function public.repeat_expense(uuid) from public, anon, authenticated;
revoke all on function public.update_repeated_expense_item(uuid, uuid, bigint, jsonb)
  from public, anon, authenticated;
revoke all on function public.delete_repeated_expense_item(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.repeat_expense(uuid) to authenticated;
grant execute on function public.update_repeated_expense_item(uuid, uuid, bigint, jsonb)
  to authenticated;
grant execute on function public.delete_repeated_expense_item(uuid, uuid)
  to authenticated;
