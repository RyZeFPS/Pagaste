-- Keep repeated expenses faithful to multi-payer templates and make price
-- edits rebalance the copied contribution proportions automatically.

create or replace function private.rescale_draft_expense_contributions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_total numeric;
  v_base_total bigint;
  v_bonus bigint;
  v_row record;
  v_amount bigint;
begin
  if new.status <> 'draft'
    or new.total_cents is not distinct from old.total_cents
    or not exists (
      select 1
      from public.expense_contributions contribution
      where contribution.expense_id = new.id
    )
  then
    return new;
  end if;

  if new.total_cents = 0 then
    delete from public.expense_contributions
    where expense_id = new.id;
    return new;
  end if;

  select sum(contribution.amount_cents)::numeric
  into v_previous_total
  from public.expense_contributions contribution
  where contribution.expense_id = new.id;

  if v_previous_total is null or v_previous_total <= 0 then
    return new;
  end if;

  select coalesce(sum(
    floor(
      contribution.amount_cents::numeric
      * new.total_cents::numeric
      / v_previous_total
    )::bigint
  ), 0)::bigint
  into v_base_total
  from public.expense_contributions contribution
  where contribution.expense_id = new.id;

  v_bonus := new.total_cents - v_base_total;

  for v_row in
    select
      contribution.id,
      floor(
        contribution.amount_cents::numeric
        * new.total_cents::numeric
        / v_previous_total
      )::bigint as base_amount,
      row_number() over (
        order by
          mod(
            contribution.amount_cents::numeric * new.total_cents::numeric,
            v_previous_total
          ) desc,
          contribution.sort_order,
          contribution.id
      )::bigint as bonus_rank
    from public.expense_contributions contribution
    where contribution.expense_id = new.id
  loop
    v_amount :=
      v_row.base_amount
      + case when v_row.bonus_rank <= v_bonus then 1 else 0 end;

    if v_amount <= 0 then
      delete from public.expense_contributions
      where id = v_row.id;
    else
      update public.expense_contributions
      set amount_cents = v_amount
      where id = v_row.id;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists expenses_rescale_draft_contributions
  on public.expenses;
create trigger expenses_rescale_draft_contributions
after update of total_cents
on public.expenses
for each row
execute function private.rescale_draft_expense_contributions();

alter function public.repeat_expense(uuid)
  rename to repeat_expense_without_contributions;

create function public.repeat_expense(p_source_expense_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_expense_id uuid;
  v_participant_map jsonb;
  v_contributions jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  -- The base function keeps all existing ownership and source-state checks.
  v_result := public.repeat_expense_without_contributions(p_source_expense_id);
  v_expense_id := (v_result ->> 'expenseId')::uuid;
  v_participant_map := coalesce(v_result -> 'participantMap', '{}'::jsonb);

  select jsonb_agg(
    jsonb_build_object(
      'participantId',
        (v_participant_map ->> contribution.participant_id::text)::uuid,
      'amountCents', contribution.amount_cents,
      'method', contribution.method
    )
    order by contribution.sort_order, contribution.id
  )
  into v_contributions
  from public.expense_contributions contribution
  where contribution.expense_id = p_source_expense_id;

  if jsonb_typeof(v_contributions) = 'array'
    and jsonb_array_length(v_contributions) > 0
  then
    perform public.save_expense_contributions(
      v_expense_id,
      v_contributions
    );
  end if;

  return v_result - 'participantMap';
end;
$$;

-- If each participant has already contributed exactly their share there is no
-- bearer link to create. Close the draft atomically as a settled expense.
create function public.settle_balanced_expense(p_expense_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_expense public.expenses%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select *
  into v_expense
  from public.expenses
  where id = p_expense_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'EXPENSE_NOT_FOUND';
  end if;
  if v_expense.created_by is distinct from v_actor then
    raise exception using errcode = '42501', message = 'NOT_EXPENSE_OWNER';
  end if;
  if v_expense.status <> 'draft' then
    raise exception using errcode = '55000', message = 'EXPENSE_NOT_DRAFT';
  end if;
  if exists (
    select 1
    from private.calculate_expense_settlements(p_expense_id)
  ) then
    raise exception using errcode = '23514', message = 'SETTLEMENTS_REQUIRED';
  end if;

  update public.expenses
  set
    recoverable_cents = 0,
    own_share_cents = total_cents,
    status = 'settled',
    sent_at = now()
  where id = p_expense_id;

  return jsonb_build_object(
    'expenseId', p_expense_id,
    'status', 'settled'
  );
end;
$$;

revoke all on function private.rescale_draft_expense_contributions()
  from public, anon, authenticated;
revoke all on function public.repeat_expense_without_contributions(uuid)
  from public, anon, authenticated;
revoke all on function public.repeat_expense(uuid)
  from public, anon, authenticated;
revoke all on function public.settle_balanced_expense(uuid)
  from public, anon, authenticated;

grant execute on function public.repeat_expense(uuid)
  to authenticated;
grant execute on function public.settle_balanced_expense(uuid)
  to authenticated;
