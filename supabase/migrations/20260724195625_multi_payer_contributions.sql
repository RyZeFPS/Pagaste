-- A participant's consumption is represented by item_allocations. This ledger
-- records what each participant actually advanced (card, cash, a reservation,
-- or another method). Net balances are calculated from both ledgers.

create table public.expense_contributions (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  participant_id uuid not null,
  amount_cents bigint not null
    check (amount_cents between 1 and 9007199254740991),
  method text not null default 'card'
    check (method in ('card', 'cash', 'reservation', 'other')),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_contributions_participant_fkey
    foreign key (expense_id, participant_id)
    references public.expense_participants (expense_id, id)
    on delete cascade,
  constraint expense_contributions_one_row_per_participant
    unique (expense_id, participant_id)
);

create index expense_contributions_expense_idx
  on public.expense_contributions (expense_id, sort_order, id);
create index expense_contributions_participant_idx
  on public.expense_contributions (participant_id);

create trigger expense_contributions_set_updated_at
before update on public.expense_contributions
for each row execute function private.set_updated_at();

-- Preserve the existing single-payer behaviour for every current expense.
insert into public.expense_contributions (
  expense_id,
  participant_id,
  amount_cents,
  method,
  sort_order
)
select
  participant.expense_id,
  participant.id,
  expense.total_cents,
  'card',
  0
from public.expense_participants participant
join public.expenses expense on expense.id = participant.expense_id
where participant.is_payer
  and expense.total_cents > 0
  and not exists (
    select 1
    from public.expense_contributions contribution
    where contribution.expense_id = participant.expense_id
  );

alter table public.expense_contributions enable row level security;

create policy expense_contributions_select_authorized
on public.expense_contributions
for select
to authenticated
using ((select private.can_read_expense(expense_id)));

-- A group member who can read an expense, its lines and its allocations also
-- needs the participant identities to understand those ledgers.
drop policy if exists participants_select_authorized
  on public.expense_participants;
create policy participants_select_authorized
on public.expense_participants
for select
to authenticated
using ((select private.can_read_expense(expense_id)));

-- One account represents one person inside an expense. This also prevents the
-- settlement engine from creating a debt from a user to that same user through
-- two different participant rows.
create unique index expense_participants_expense_user_unique
  on public.expense_participants (expense_id, user_id)
  where user_id is not null;

-- Keep cross-expense references impossible even for privileged maintenance
-- code. The Data API policies already enforce this for normal clients, but the
-- invariant belongs in the database as well.
create or replace function private.validate_expense_ledger_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_expense_id uuid;
  v_debtor_expense_id uuid;
  v_creditor_expense_id uuid;
begin
  if tg_table_name = 'item_allocations' then
    select item.expense_id
      into v_item_expense_id
    from public.expense_items item
    where item.id = new.item_id;

    if not exists (
      select 1
      from public.expense_participants participant
      where participant.id = new.participant_id
        and participant.expense_id = v_item_expense_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'ALLOCATION_PARTICIPANT_MISMATCH';
    end if;
    return new;
  end if;

  select participant.expense_id
    into v_debtor_expense_id
  from public.expense_participants participant
  where participant.id = new.debtor_participant_id;
  select participant.expense_id
    into v_creditor_expense_id
  from public.expense_participants participant
  where participant.id = new.creditor_participant_id;

  if v_debtor_expense_id is distinct from new.expense_id
    or v_creditor_expense_id is distinct from new.expense_id
  then
    raise exception using
      errcode = '23514',
      message = 'CLAIM_PARTICIPANT_MISMATCH';
  end if;
  return new;
end;
$$;

drop trigger if exists item_allocations_validate_expense
  on public.item_allocations;
create trigger item_allocations_validate_expense
before insert or update of item_id, participant_id
on public.item_allocations
for each row execute function private.validate_expense_ledger_relationship();

drop trigger if exists claims_validate_expense
  on public.claims;
create trigger claims_validate_expense
before insert or update of expense_id, debtor_participant_id, creditor_participant_id
on public.claims
for each row execute function private.validate_expense_ledger_relationship();

revoke all on table public.expense_contributions
  from public, anon, authenticated;
grant select on table public.expense_contributions to authenticated;
grant all on table public.expense_contributions to service_role;

-- A debtor may reimburse several creditors. The former uniqueness constraint
-- prevented that legitimate case.
alter table public.claims
  drop constraint if exists claims_expense_id_debtor_participant_id_key;

alter table public.claims
  add constraint claims_expense_debtor_creditor_key
  unique (expense_id, debtor_participant_id, creditor_participant_id);

-- Calculate transfers by intersecting cumulative debtor and creditor ranges.
-- This is equivalent to a stable greedy settlement, but set-based: participant
-- sort_order then UUID are the deterministic tie-breakers.
create or replace function private.calculate_expense_settlements(p_expense_id uuid)
returns table (
  debtor_participant_id uuid,
  creditor_participant_id uuid,
  amount_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_expense public.expenses%rowtype;
  v_contribution_count integer;
  v_contribution_total bigint;
  v_item_total bigint;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select *
    into v_expense
  from public.expenses
  where id = p_expense_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'EXPENSE_NOT_FOUND';
  end if;
  if v_expense.created_by is distinct from v_actor then
    raise exception using errcode = '42501', message = 'NOT_EXPENSE_OWNER';
  end if;

  select count(*)::integer, coalesce(sum(amount_cents), 0)::bigint
    into v_contribution_count, v_contribution_total
  from public.expense_contributions
  where expense_id = p_expense_id;

  if v_contribution_count = 0 then
    if not exists (
      select 1
      from public.expense_participants
      where expense_id = p_expense_id and is_payer
    ) then
      raise exception using errcode = '23514', message = 'PAYER_REQUIRED';
    end if;
    v_contribution_total := v_expense.total_cents;
  elsif v_contribution_total <> v_expense.total_cents then
    raise exception using errcode = '23514', message = 'CONTRIBUTIONS_MISMATCH';
  end if;

  select coalesce(sum(line_total_cents), 0)::bigint
    into v_item_total
  from public.expense_items
  where expense_id = p_expense_id;
  if v_item_total <> v_expense.total_cents then
    raise exception using errcode = '23514', message = 'ITEM_TOTAL_MISMATCH';
  end if;

  if exists (
    select 1
    from public.expense_items item
    left join public.item_allocations allocation on allocation.item_id = item.id
    where item.expense_id = p_expense_id
    group by item.id, item.line_total_cents
    having coalesce(sum(allocation.amount_cents), 0) <> item.line_total_cents
  ) then
    raise exception using errcode = '23514', message = 'ALLOCATIONS_MISMATCH';
  end if;

  return query
  with participant_shares as (
    select
      participant.id as participant_id,
      participant.sort_order,
      coalesce(sum(allocation.amount_cents), 0)::bigint as share_cents
    from public.expense_participants participant
    left join (
      select expense_allocation.*
      from public.item_allocations expense_allocation
      join public.expense_items expense_item
        on expense_item.id = expense_allocation.item_id
      where expense_item.expense_id = p_expense_id
    ) allocation on allocation.participant_id = participant.id
    where participant.expense_id = p_expense_id
    group by participant.id, participant.sort_order
  ),
  participant_paid as (
    select
      participant.id as participant_id,
      case
        when v_contribution_count = 0 and participant.is_payer
          then v_expense.total_cents
        when v_contribution_count = 0
          then 0::bigint
        else coalesce(sum(contribution.amount_cents), 0)::bigint
      end as paid_cents
    from public.expense_participants participant
    left join public.expense_contributions contribution
      on contribution.expense_id = participant.expense_id
      and contribution.participant_id = participant.id
    where participant.expense_id = p_expense_id
    group by participant.id, participant.is_payer
  ),
  balances as (
    select
      share.participant_id,
      share.sort_order,
      paid.paid_cents - share.share_cents as net_cents
    from participant_shares share
    join participant_paid paid using (participant_id)
  ),
  debtors as (
    select
      participant_id,
      sort_order,
      -net_cents as debt_cents,
      coalesce(
        sum(-net_cents) over (
          order by sort_order, participant_id
          rows between unbounded preceding and 1 preceding
        ),
        0
      )::bigint as range_start,
      sum(-net_cents) over (
        order by sort_order, participant_id
        rows between unbounded preceding and current row
      )::bigint as range_end
    from balances
    where net_cents < 0
  ),
  creditors as (
    select
      participant_id,
      sort_order,
      net_cents as credit_cents,
      coalesce(
        sum(net_cents) over (
          order by sort_order, participant_id
          rows between unbounded preceding and 1 preceding
        ),
        0
      )::bigint as range_start,
      sum(net_cents) over (
        order by sort_order, participant_id
        rows between unbounded preceding and current row
      )::bigint as range_end
    from balances
    where net_cents > 0
  ),
  transfers as (
    select
      debtor.participant_id as debtor_id,
      creditor.participant_id as creditor_id,
      (
        least(debtor.range_end, creditor.range_end)
        - greatest(debtor.range_start, creditor.range_start)
      )::bigint as transfer_cents,
      debtor.sort_order as debtor_sort_order,
      creditor.sort_order as creditor_sort_order
    from debtors debtor
    cross join creditors creditor
    where least(debtor.range_end, creditor.range_end)
      > greatest(debtor.range_start, creditor.range_start)
  )
  select
    transfer.debtor_id,
    transfer.creditor_id,
    transfer.transfer_cents
  from transfers transfer
  where transfer.transfer_cents > 0
  order by
    transfer.debtor_sort_order,
    transfer.debtor_id,
    transfer.creditor_sort_order,
    transfer.creditor_id;
end;
$$;

create or replace function public.preview_expense_settlements(p_expense_id uuid)
returns table (
  debtor_participant_id uuid,
  creditor_participant_id uuid,
  amount_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    settlement.debtor_participant_id,
    settlement.creditor_participant_id,
    settlement.amount_cents
  from private.calculate_expense_settlements(p_expense_id) settlement;
$$;

-- Replace every contribution in one short, all-or-nothing transaction.
create or replace function public.save_expense_contributions(
  p_expense_id uuid,
  p_contributions jsonb
)
returns setof public.expense_contributions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_expense public.expenses%rowtype;
  v_count integer;
  v_total bigint;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if jsonb_typeof(p_contributions) <> 'array'
    or jsonb_array_length(p_contributions) = 0
    or jsonb_array_length(p_contributions) > 100 then
    raise exception using errcode = '22023', message = 'INVALID_CONTRIBUTIONS';
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

  with contribution_rows as (
    select
      (entry.value ->> 'participantId')::uuid as participant_id,
      (entry.value ->> 'amountCents')::bigint as amount_cents,
      entry.value ->> 'method' as method,
      (entry.ordinality - 1)::integer as sort_order
    from jsonb_array_elements(p_contributions)
      with ordinality as entry(value, ordinality)
  )
  select count(*)::integer, coalesce(sum(amount_cents), 0)::bigint
    into v_count, v_total
  from contribution_rows;

  if v_count <> jsonb_array_length(p_contributions)
    or v_total <> v_expense.total_cents then
    raise exception using errcode = '23514', message = 'CONTRIBUTIONS_MISMATCH';
  end if;

  if (
    select count(*) <> count(distinct participant_id)
    from (
      select (entry.value ->> 'participantId')::uuid as participant_id
      from jsonb_array_elements(p_contributions) entry(value)
    ) supplied
  ) then
    raise exception using errcode = '23514', message = 'DUPLICATE_CONTRIBUTOR';
  end if;

  if exists (
    with contribution_rows as (
      select
        (entry.value ->> 'participantId')::uuid as participant_id,
        (entry.value ->> 'amountCents')::bigint as amount_cents,
        entry.value ->> 'method' as method
      from jsonb_array_elements(p_contributions) entry(value)
    )
    select 1
    from contribution_rows contribution
    left join public.expense_participants participant
      on participant.id = contribution.participant_id
      and participant.expense_id = p_expense_id
    where participant.id is null
      or participant.user_id is null
      or contribution.amount_cents <= 0
      or contribution.amount_cents > 9007199254740991
      or contribution.method not in ('card', 'cash', 'reservation', 'other')
  ) then
    raise exception using errcode = '23514', message = 'INVALID_CONTRIBUTIONS';
  end if;

  perform 1
  from public.expense_participants
  where expense_id = p_expense_id
  order by id
  for update;

  delete from public.expense_contributions
  where expense_id = p_expense_id;

  insert into public.expense_contributions (
    expense_id,
    participant_id,
    amount_cents,
    method,
    sort_order
  )
  select
    p_expense_id,
    (entry.value ->> 'participantId')::uuid,
    (entry.value ->> 'amountCents')::bigint,
    entry.value ->> 'method',
    (entry.ordinality - 1)::integer
  from jsonb_array_elements(p_contributions)
    with ordinality as entry(value, ordinality);

  return query
  select contribution.*
  from public.expense_contributions contribution
  where contribution.expense_id = p_expense_id
  order by contribution.sort_order, contribution.id;
end;
$$;

-- The response now includes the creditor, so PostgreSQL requires replacing the
-- function rather than changing the existing table return type in place.
drop function if exists public.create_claims_transaction(uuid, jsonb);

create function public.create_claims_transaction(
  p_expense_id uuid,
  p_claims jsonb
)
returns table (
  claim_id uuid,
  debtor_participant_id uuid,
  creditor_participant_id uuid,
  amount_cents bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_expense public.expenses%rowtype;
  v_primary_payer uuid;
  v_item_total bigint;
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
  if v_expense.total_cents <= 0 then
    raise exception using errcode = '23514', message = 'INVALID_TOTAL';
  end if;

  perform 1
  from public.expense_participants
  where expense_id = p_expense_id
  order by id
  for update;

  select id
    into v_primary_payer
  from public.expense_participants
  where expense_id = p_expense_id and is_payer
  order by sort_order, id
  limit 1;
  if v_primary_payer is null then
    raise exception using errcode = '23514', message = 'PAYER_REQUIRED';
  end if;

  select coalesce(sum(line_total_cents), 0)::bigint
    into v_item_total
  from public.expense_items
  where expense_id = p_expense_id;
  if v_item_total <> v_expense.total_cents then
    raise exception using errcode = '23514', message = 'ITEM_TOTAL_MISMATCH';
  end if;

  if exists (
    select 1
    from public.expense_items item
    left join public.item_allocations allocation on allocation.item_id = item.id
    where item.expense_id = p_expense_id
    group by item.id, item.line_total_cents
    having coalesce(sum(allocation.amount_cents), 0) <> item.line_total_cents
  ) then
    raise exception using errcode = '23514', message = 'ALLOCATIONS_MISMATCH';
  end if;

  if exists (
    select 1
    from public.expense_items item
    join public.item_allocations allocation on allocation.item_id = item.id
    where item.expense_id = p_expense_id
    group by item.id, item.line_total_cents
    having count(distinct allocation.method) <> 1
      or bool_or(sign(allocation.amount_cents) <> sign(item.line_total_cents))
      or (
        min(allocation.method::text) = 'percentage'
        and sum(allocation.percentage) <> 100
      )
  ) then
    raise exception using errcode = '23514', message = 'ALLOCATION_METHOD_MISMATCH';
  end if;

  if exists (
    select 1
    from public.item_allocations allocation
    join public.expense_items item on item.id = allocation.item_id
    join public.expense_participants participant
      on participant.id = allocation.participant_id
    where item.expense_id = p_expense_id
      and participant.expense_id <> p_expense_id
  ) then
    raise exception using errcode = '23514', message = 'ALLOCATION_PARTICIPANT_MISMATCH';
  end if;

  if exists (
    with supplied as (
      select
        (entry.value ->> 'debtorParticipantId')::uuid as debtor_id,
        (entry.value ->> 'creditorParticipantId')::uuid as creditor_id,
        (entry.value ->> 'amountCents')::bigint as supplied_amount_cents,
        lower(entry.value ->> 'tokenHash') as token_hash
      from jsonb_array_elements(p_claims) entry(value)
    ),
    expected as (
      select *
      from private.calculate_expense_settlements(p_expense_id)
    )
    select 1
    from expected
    full join supplied
      on supplied.debtor_id = expected.debtor_participant_id
      and supplied.creditor_id = expected.creditor_participant_id
    where expected.debtor_participant_id is null
      or supplied.debtor_id is null
      or expected.amount_cents <> supplied.supplied_amount_cents
      or supplied.supplied_amount_cents <= 0
      or supplied.token_hash is null
      or supplied.token_hash !~ '^[0-9a-f]{64}$'
  ) or (
    with supplied as (
      select
        (entry.value ->> 'debtorParticipantId')::uuid as debtor_id,
        (entry.value ->> 'creditorParticipantId')::uuid as creditor_id,
        lower(entry.value ->> 'tokenHash') as token_hash
      from jsonb_array_elements(p_claims) entry(value)
    )
    select
      count(*) <> count(distinct (debtor_id, creditor_id))
      or count(*) <> count(distinct token_hash)
    from supplied
  ) then
    raise exception using errcode = '23514', message = 'CLAIM_AMOUNTS_MISMATCH';
  end if;

  select coalesce(sum(settlement.amount_cents), 0)::bigint
    into v_recoverable
  from private.calculate_expense_settlements(p_expense_id) settlement;
  if v_recoverable <= 0 or v_recoverable > v_expense.total_cents then
    raise exception using errcode = '23514', message = 'NO_SETTLEMENTS_REQUIRED';
  end if;

  update public.expenses
  set
    payer_participant_id = v_primary_payer,
    own_share_cents = v_expense.total_cents - v_recoverable,
    recoverable_cents = v_recoverable,
    status = 'sent',
    sent_at = now()
  where id = p_expense_id;

  return query
  with supplied as (
    select
      (entry.value ->> 'debtorParticipantId')::uuid as debtor_id,
      (entry.value ->> 'creditorParticipantId')::uuid as creditor_id,
      (entry.value ->> 'amountCents')::bigint as supplied_amount_cents,
      lower(entry.value ->> 'tokenHash') as token_hash
    from jsonb_array_elements(p_claims) entry(value)
  ),
  inserted as (
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
      supplied.debtor_id,
      supplied.creditor_id,
      supplied.supplied_amount_cents,
      'pending',
      supplied.token_hash,
      now()
    from supplied
    returning
      id,
      claims.debtor_participant_id,
      claims.creditor_participant_id,
      claims.amount_cents
  ),
  events as (
    insert into public.claim_events (
      claim_id,
      actor_type,
      actor_user_id,
      event_type
    )
    select inserted.id, 'owner', v_actor, 'claim_sent'
    from inserted
  )
  select
    inserted.id,
    inserted.debtor_participant_id,
    inserted.creditor_participant_id,
    inserted.amount_cents
  from inserted
  order by
    inserted.debtor_participant_id,
    inserted.creditor_participant_id;
end;
$$;

revoke all on function private.calculate_expense_settlements(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.validate_expense_ledger_relationship()
  from public, anon, authenticated, service_role;
revoke all on function public.preview_expense_settlements(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.save_expense_contributions(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.create_claims_transaction(uuid, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.preview_expense_settlements(uuid)
  to authenticated;
grant execute on function public.save_expense_contributions(uuid, jsonb)
  to authenticated;
grant execute on function public.create_claims_transaction(uuid, jsonb)
  to authenticated;
