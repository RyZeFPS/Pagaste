-- Bilateral debts inside the same group and currency are netted when a new
-- expense is sent. The original claim value is retained for reconciliation,
-- while amount_cents remains the amount that can still be requested.

alter table public.claims
  add column original_amount_cents bigint;

update public.claims
set original_amount_cents = amount_cents
where original_amount_cents is null;

alter table public.claims
  alter column original_amount_cents set not null,
  add constraint claims_original_amount_valid
    check (
      original_amount_cents between 1 and 9007199254740991
      and amount_cents <= original_amount_cents
    );

create or replace function private.set_claim_original_amount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.original_amount_cents := coalesce(new.original_amount_cents, new.amount_cents);
  return new;
end;
$$;

create trigger claims_set_original_amount
before insert on public.claims
for each row execute function private.set_claim_original_amount();

create table public.claim_offsets (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  currency varchar(3) not null check (currency ~ '^[A-Z]{3}$'),
  existing_claim_id uuid not null references public.claims (id) on delete cascade,
  incoming_claim_id uuid not null references public.claims (id) on delete cascade,
  amount_cents bigint not null
    check (amount_cents between 1 and 9007199254740991),
  created_at timestamptz not null default now(),
  constraint claim_offsets_distinct_claims
    check (existing_claim_id <> incoming_claim_id),
  constraint claim_offsets_unique_pair
    unique (existing_claim_id, incoming_claim_id)
);

create index claim_offsets_group_recent_idx
  on public.claim_offsets (group_id, created_at desc);
create index claim_offsets_existing_claim_idx
  on public.claim_offsets (existing_claim_id);
create index claim_offsets_incoming_claim_idx
  on public.claim_offsets (incoming_claim_id);

alter table public.claim_offsets enable row level security;

create policy claim_offsets_select_group_members
on public.claim_offsets
for select
to authenticated
using ((select private.is_group_member(group_id)));

create or replace function private.apply_group_debt_offsets(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incoming record;
  v_existing record;
  v_current_amount bigint;
  v_offset bigint;
  v_existing_remaining bigint;
  v_incoming_remaining bigint;
begin
  for v_incoming in
    select
      claim.id,
      claim.expense_id,
      claim.amount_cents,
      expense.group_id,
      expense.currency,
      debtor.user_id as debtor_user_id,
      creditor.user_id as creditor_user_id
    from public.claims claim
    join public.expenses expense on expense.id = claim.expense_id
    join public.expense_participants debtor
      on debtor.id = claim.debtor_participant_id
    join public.expense_participants creditor
      on creditor.id = claim.creditor_participant_id
    where claim.expense_id = p_expense_id
      and claim.status in ('pending', 'reminder_sent')
    order by claim.id
  loop
    -- Guests cannot be matched safely across expenses. Ungrouped expenses are
    -- deliberately excluded so unrelated private expenses are never netted.
    if v_incoming.group_id is null
      or v_incoming.debtor_user_id is null
      or v_incoming.creditor_user_id is null
    then
      continue;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_incoming.group_id::text
          || ':' || v_incoming.currency
          || ':' || least(
            v_incoming.debtor_user_id::text,
            v_incoming.creditor_user_id::text
          )
          || ':' || greatest(
            v_incoming.debtor_user_id::text,
            v_incoming.creditor_user_id::text
          ),
        0
      )
    );

    for v_existing in
      select claim.id, claim.expense_id, claim.amount_cents
      from public.claims claim
      join public.expenses expense on expense.id = claim.expense_id
      join public.expense_participants debtor
        on debtor.id = claim.debtor_participant_id
      join public.expense_participants creditor
        on creditor.id = claim.creditor_participant_id
      where claim.expense_id <> p_expense_id
        and expense.group_id = v_incoming.group_id
        and expense.currency = v_incoming.currency
        and claim.status in ('pending', 'reminder_sent')
        and debtor.user_id = v_incoming.creditor_user_id
        and creditor.user_id = v_incoming.debtor_user_id
      order by claim.sent_at, claim.created_at, claim.id
      for update of claim
    loop
      select claim.amount_cents
      into v_current_amount
      from public.claims claim
      where claim.id = v_incoming.id
        and claim.status in ('pending', 'reminder_sent')
      for update;

      if not found then
        exit;
      end if;

      v_offset := least(v_current_amount, v_existing.amount_cents);
      if v_offset <= 0 then
        continue;
      end if;

      v_existing_remaining := v_existing.amount_cents - v_offset;
      v_incoming_remaining := v_current_amount - v_offset;

      insert into public.claim_offsets (
        group_id,
        currency,
        existing_claim_id,
        incoming_claim_id,
        amount_cents
      ) values (
        v_incoming.group_id,
        v_incoming.currency,
        v_existing.id,
        v_incoming.id,
        v_offset
      );

      update public.claims
      set
        amount_cents = case
          when v_existing_remaining > 0 then v_existing_remaining
          else amount_cents
        end,
        status = case
          when v_existing_remaining > 0 then status
          else 'cancelled'::public.claim_status
        end,
        cancelled_at = case
          when v_existing_remaining = 0 then now()
          else cancelled_at
        end,
        public_token_hash = case
          when v_existing_remaining = 0 then null
          else public_token_hash
        end,
        token_version = token_version
          + case when v_existing_remaining = 0 then 1 else 0 end
      where id = v_existing.id;

      update public.claims
      set
        amount_cents = case
          when v_incoming_remaining > 0 then v_incoming_remaining
          else amount_cents
        end,
        status = case
          when v_incoming_remaining > 0 then status
          else 'cancelled'::public.claim_status
        end,
        cancelled_at = case
          when v_incoming_remaining = 0 then now()
          else cancelled_at
        end,
        public_token_hash = case
          when v_incoming_remaining = 0 then null
          else public_token_hash
        end,
        token_version = token_version
          + case when v_incoming_remaining = 0 then 1 else 0 end
      where id = v_incoming.id;

      insert into public.claim_events (
        claim_id,
        actor_type,
        event_type,
        metadata
      ) values
      (
        v_existing.id,
        'system',
        'debt_offset',
        jsonb_build_object(
          'counterClaimId', v_incoming.id,
          'offsetAmountCents', v_offset,
          'remainingAmountCents', v_existing_remaining
        )
      ),
      (
        v_incoming.id,
        'system',
        'debt_offset',
        jsonb_build_object(
          'counterClaimId', v_existing.id,
          'offsetAmountCents', v_offset,
          'remainingAmountCents', v_incoming_remaining
        )
      );

      if not exists (
        select 1
        from public.claims claim
        where claim.expense_id = v_existing.expense_id
          and claim.status in ('pending', 'reminder_sent', 'disputed')
      ) then
        update public.expenses
        set status = 'settled'
        where id = v_existing.expense_id;
      end if;

      v_existing.amount_cents := v_existing_remaining;
      if v_incoming_remaining = 0 then
        exit;
      end if;
    end loop;
  end loop;

  if not exists (
    select 1
    from public.claims claim
    where claim.expense_id = p_expense_id
      and claim.status in ('pending', 'reminder_sent', 'disputed')
  ) then
    update public.expenses
    set status = 'settled'
    where id = p_expense_id;
  end if;
end;
$$;

create function public.create_claims_with_offsets_transaction(
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
  v_created_count integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select count(*)::integer
  into v_created_count
  from public.create_claims_transaction(p_expense_id, p_claims);

  if v_created_count <= 0 then
    raise exception using errcode = 'P0002', message = 'CLAIMS_NOT_CREATED';
  end if;

  perform private.apply_group_debt_offsets(p_expense_id);

  return query
  select
    claim.id,
    claim.debtor_participant_id,
    claim.creditor_participant_id,
    claim.amount_cents
  from public.claims claim
  where claim.expense_id = p_expense_id
    and claim.status in ('pending', 'reminder_sent')
  order by claim.debtor_participant_id, claim.creditor_participant_id;
end;
$$;

create function public.get_group_member_debts(p_group_id uuid)
returns table (
  group_member_id uuid,
  user_id uuid,
  amount_cents bigint,
  currency varchar(3)
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_group_id is null or not private.is_group_member(p_group_id) then
    raise exception using errcode = '42501', message = 'NOT_GROUP_MEMBER';
  end if;

  return query
  select
    member.id,
    member.user_id,
    coalesce(debt.amount_cents, 0)::bigint,
    group_record.currency
  from public.group_members member
  join public.groups group_record on group_record.id = member.group_id
  left join lateral (
    select coalesce(sum(claim.amount_cents), 0)::bigint as amount_cents
    from public.claims claim
    join public.expenses expense on expense.id = claim.expense_id
    join public.expense_participants debtor
      on debtor.id = claim.debtor_participant_id
    where expense.group_id = p_group_id
      and expense.currency = group_record.currency
      and claim.status in ('pending', 'reminder_sent', 'disputed')
      and member.user_id is not null
      and debtor.user_id = member.user_id
  ) debt on true
  where member.group_id = p_group_id
    and member.status in ('active', 'invited')
  order by member.created_at, member.id;
end;
$$;

create function public.get_public_claim_payment_progress(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claim public.claims%rowtype;
  v_payload jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select claim.*
  into v_claim
  from public.claims claim
  where claim.public_token_hash = lower(p_token_hash)
    and claim.public_link_expires_at > now()
    and claim.status in ('pending', 'reminder_sent', 'disputed');
  if not found then
    return null;
  end if;

  with claim_progress as (
    select
      claim.id,
      debtor.display_name,
      claim.status,
      claim.amount_cents,
      claim.original_amount_cents,
      exists (
        select 1
        from public.claim_events event
        where event.claim_id = claim.id
          and event.event_type = 'debt_offset'
      ) as has_offset,
      coalesce((
        select sum(offset_record.amount_cents)::bigint
        from public.claim_offsets offset_record
        where offset_record.existing_claim_id = claim.id
          or offset_record.incoming_claim_id = claim.id
      ), 0)::bigint as offset_amount_cents
    from public.claims claim
    join public.expense_participants debtor
      on debtor.id = claim.debtor_participant_id
    where claim.expense_id = v_claim.expense_id
  ),
  included as (
    select
      progress.*,
      least(
        progress.original_amount_cents,
        case
          when progress.status = 'received' then progress.original_amount_cents
          else progress.offset_amount_cents
        end
      )::bigint as settled_cents,
      case
        when progress.status = 'cancelled' then least(
          progress.original_amount_cents,
          progress.offset_amount_cents
        )
        else progress.original_amount_cents
      end::bigint as effective_total_cents
    from claim_progress progress
    where progress.status <> 'cancelled' or progress.has_offset
  )
  select jsonb_build_object(
    'originalAmountCents', v_claim.original_amount_cents,
    'offsetAmountCents', coalesce((
      select sum(offset_record.amount_cents)::bigint
      from public.claim_offsets offset_record
      where offset_record.existing_claim_id = v_claim.id
        or offset_record.incoming_claim_id = v_claim.id
    ), 0),
    'paymentProgress', jsonb_build_object(
      'totalCents', coalesce(sum(included.effective_total_cents), 0),
      'settledCents', coalesce(sum(included.settled_cents), 0),
      'pendingCents', coalesce(sum(
        case
          when included.status in ('pending', 'reminder_sent', 'disputed')
            then included.amount_cents
          else 0
        end
      ), 0),
      'completed', not exists (
        select 1
        from included open_claim
        where open_claim.status in ('pending', 'reminder_sent', 'disputed')
      ),
      'payers', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'displayName', payer.display_name,
            'amountCents', payer.effective_total_cents,
            'settledCents', payer.settled_cents,
            'status', payer.status::text,
            'isCurrent', payer.id = v_claim.id
          )
          order by payer.display_name, payer.id
        )
        from included payer
      ), '[]'::jsonb)
    )
  )
  into v_payload
  from included;

  return v_payload;
end;
$$;

revoke all on function private.set_claim_original_amount()
  from public, anon, authenticated, service_role;
revoke all on function private.apply_group_debt_offsets(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_claims_with_offsets_transaction(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.get_group_member_debts(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_public_claim_payment_progress(text)
  from public, anon, authenticated, service_role;

revoke all on table public.claim_offsets
  from public, anon, authenticated;
grant select on table public.claim_offsets to authenticated;
grant all on table public.claim_offsets to service_role;

grant execute on function public.create_claims_with_offsets_transaction(uuid, jsonb)
  to authenticated;
grant execute on function public.get_group_member_debts(uuid)
  to authenticated;
grant execute on function public.get_public_claim_payment_progress(text)
  to service_role;
