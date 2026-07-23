-- Pagaste only records that the creditor manually received money. It never
-- processes, observes, or verifies a bank transfer. Public debtors can inspect
-- and dispute a claim, but they no longer report a payment back to Pagaste.

alter table public.profiles
  add column if not exists payment_phone_e164 text,
  add column if not exists share_payment_phone boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_payment_phone_e164_valid'
  ) then
    alter table public.profiles
      add constraint profiles_payment_phone_e164_valid check (
        payment_phone_e164 is null
        or payment_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_shared_payment_phone_present'
  ) then
    alter table public.profiles
      add constraint profiles_shared_payment_phone_present check (
        not share_payment_phone or payment_phone_e164 is not null
      );
  end if;
end;
$$;

alter table public.claims
  add column if not exists received_at timestamptz,
  add column if not exists received_by_user_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.claims'::regclass
      and conname = 'claims_received_by_user_id_fkey'
  ) then
    alter table public.claims
      add constraint claims_received_by_user_id_fkey
      foreign key (received_by_user_id)
      references public.profiles (id)
      on delete set null;
  end if;
end;
$$;

-- Preserve the only trustworthy legacy completion: a creditor confirmation.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'claims'
      and column_name = 'confirmed_at'
  ) then
    execute $sql$
      update public.claims
      set received_at = coalesce(received_at, confirmed_at)
      where status::text = 'confirmed'
    $sql$;
  end if;
end;
$$;

update public.claims c
set received_by_user_id = coalesce(
  c.received_by_user_id,
  (
    select ce.actor_user_id
    from public.claim_events ce
    where ce.claim_id = c.id
      and ce.event_type = 'payment_confirmed'
      and ce.actor_user_id is not null
    order by ce.created_at desc, ce.id desc
    limit 1
  ),
  creditor.user_id,
  e.created_by
)
from public.expenses e
join public.expense_participants creditor on creditor.expense_id = e.id
where c.expense_id = e.id
  and creditor.id = c.creditor_participant_id
  and c.status::text = 'confirmed';

-- Draft claims without a bearer token were never shared. Preserve them as
-- cancelled ledger rows instead of fabricating an actionable request.
update public.claims
set cancelled_at = coalesce(cancelled_at, updated_at, created_at)
where status::text = 'draft'
  and public_token_hash is null;

alter table public.claims alter column status drop default;
alter table public.claims
  drop constraint if exists claims_check1,
  drop constraint if exists claims_check2,
  drop constraint if exists claims_check3,
  drop constraint if exists claims_check4,
  drop constraint if exists claims_check5,
  drop constraint if exists claims_check6,
  drop constraint if exists claims_reputation_timestamps_valid;

-- PostgreSQL enums cannot remove labels. Replace the type atomically and map
-- payer assertions back to an outstanding state unless the creditor had
-- already confirmed receipt.
do $$
declare
  v_labels text[];
begin
  select array_agg(e.enumlabel order by e.enumsortorder)
    into v_labels
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  join pg_enum e on e.enumtypid = t.oid
  where n.nspname = 'public'
    and t.typname = 'claim_status';

  if v_labels is distinct from array[
    'pending', 'received', 'reminder_sent', 'disputed', 'cancelled'
  ]::text[] then
    if exists (
      select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = 'claim_status_v2'
    ) then
      execute 'drop type public.claim_status_v2';
    end if;

    execute $ddl$
      create type public.claim_status_v2 as enum (
        'pending', 'received', 'reminder_sent', 'disputed', 'cancelled'
      )
    $ddl$;

    execute $ddl$
      alter table public.claims
      alter column status type public.claim_status_v2
      using (
        case
          when status::text = 'confirmed' then 'received'
          when status::text = 'disputed' then 'disputed'
          when status::text = 'cancelled' then 'cancelled'
          when status::text = 'draft' and public_token_hash is null then 'cancelled'
          when reminder_count > 0 or last_reminded_at is not null then 'reminder_sent'
          else 'pending'
        end
      )::public.claim_status_v2
    $ddl$;

    execute 'drop type public.claim_status';
    execute 'alter type public.claim_status_v2 rename to claim_status';
  end if;
end;
$$;

alter table public.claims
  alter column status set default 'pending'::public.claim_status;

-- A legacy draft with a token was already externally addressable even if the
-- former workflow had not populated sent_at yet.
update public.claims
set sent_at = coalesce(sent_at, created_at)
where status in ('pending', 'reminder_sent', 'disputed', 'received')
  and sent_at is null;

-- Repair any legacy reminder counters that drifted before enforcing the new
-- status invariant. A reminder always has both a count and a timestamp.
update public.claims
set
  reminder_count = greatest(reminder_count, 1),
  last_reminded_at = coalesce(last_reminded_at, sent_at, created_at)
where reminder_count > 0
   or last_reminded_at is not null;

-- Closed claims no longer need a public bearer link. Rotating token_version
-- makes the revocation explicit to every consumer.
update public.claims
set
  token_version = token_version + case when public_token_hash is null then 0 else 1 end,
  public_token_hash = null
where status in ('received', 'cancelled');

-- Keep an audit trail without allowing old payer-generated signals to affect
-- status, activity, reputation, or streaks.
update public.claim_events
set
  metadata = metadata || jsonb_build_object('legacyEventType', event_type),
  event_type = case
    when event_type = 'payment_confirmed' then 'claim_received'
    when event_type in ('claim_marked_paid', 'payment_identity_verified')
      then 'legacy_payer_signal_ignored'
    when event_type = 'payment_not_received' then 'legacy_receiver_reopened'
    else event_type
  end
where event_type in (
  'payment_confirmed',
  'claim_marked_paid',
  'payment_identity_verified',
  'payment_not_received'
);

drop trigger if exists claims_clear_payment_identity on public.claims;
drop function if exists private.clear_claim_payment_identity();
drop index if exists public.claims_marked_paid_by_user_idx;

alter table public.claims
  drop constraint if exists claims_marked_paid_by_user_id_fkey,
  drop constraint if exists claims_payment_method_check,
  drop constraint if exists claims_debtor_note_check,
  drop column if exists marked_paid_at,
  drop column if exists confirmed_at,
  drop column if exists payment_method,
  drop column if exists debtor_note,
  drop column if exists marked_paid_by_user_id,
  drop column if exists reputation_verified_at;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.claims'::regclass
      and conname = 'claims_status_timestamps_valid'
  ) then
    alter table public.claims
      add constraint claims_status_timestamps_valid check (
        (status = 'received') = (received_at is not null)
        and (status = 'cancelled') = (cancelled_at is not null)
        and (status = 'cancelled' or sent_at is not null)
        and (
          status <> 'reminder_sent'
          or (last_reminded_at is not null and reminder_count > 0)
        )
        and ((reminder_count = 0) = (last_reminded_at is null))
        and (received_by_user_id is null or status = 'received')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.claims'::regclass
      and conname = 'claims_public_link_state_valid'
  ) then
    alter table public.claims
      add constraint claims_public_link_state_valid check (
        (
          status in ('received', 'cancelled')
          and public_token_hash is null
        )
        or (
          status in ('pending', 'reminder_sent', 'disputed')
          and public_token_hash is not null
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.claims'::regclass
      and conname = 'claims_reputation_window_valid'
  ) then
    alter table public.claims
      add constraint claims_reputation_window_valid check (
        received_at is null
        or reputation_started_at is null
        or received_at >= reputation_started_at
      );
  end if;
end;
$$;

create index if not exists claims_received_by_user_idx
  on public.claims (received_by_user_id)
  where received_by_user_id is not null;

-- Reconcile ledger-level completion after converting legacy claims. Cancelled
-- claims are not outstanding; an expense with at least one received claim is
-- settled, while an expense whose requests were all cancelled is cancelled.
update public.expenses e
set status = case
  when exists (
    select 1 from public.claims c
    where c.expense_id = e.id and c.status = 'received'
  ) then 'settled'::public.expense_status
  else 'cancelled'::public.expense_status
end
where e.status = 'sent'
  and exists (select 1 from public.claims c where c.expense_id = e.id)
  and not exists (
    select 1
    from public.claims c
    where c.expense_id = e.id
      and c.status in ('pending', 'reminder_sent', 'disputed')
  );

drop function if exists public.mark_claim_paid_by_token(text, text, text);
drop function if exists public.mark_claim_paid_by_token(text, text, text, uuid);
drop function if exists public.confirm_claim_payment(uuid);
drop function if exists public.reject_claim_payment(uuid);

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
    coalesce((select sum(amount_cents) from calculated), 0)
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

create or replace function public.consume_endpoint_rate_limit(
  p_endpoint text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_endpoint not in ('get-public-claim', 'dispute-claim', 'accept-invite')
    or p_key_hash !~ '^[0-9a-f]{64}$'
    or p_limit not between 1 and 1000
    or p_window_seconds not between 10 and 86400 then
    raise exception using errcode = '22023', message = 'INVALID_RATE_LIMIT_INPUT';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );
  insert into private.endpoint_rate_limits (
    endpoint, key_hash, window_started_at, request_count
  ) values (
    p_endpoint, p_key_hash, v_window, 1
  )
  on conflict (endpoint, key_hash, window_started_at)
  do update set request_count = private.endpoint_rate_limits.request_count + 1
  returning request_count into v_count;

  if random() < 0.01 then
    delete from private.endpoint_rate_limits
    where window_started_at < now() - interval '2 days';
  end if;
  return v_count <= p_limit;
end;
$$;

create or replace function public.get_public_claim_payload(p_token_hash text)
returns jsonb
language plpgsql
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

  select * into v_claim
  from public.claims
  where public_token_hash = lower(p_token_hash)
    and status in ('pending', 'reminder_sent', 'disputed')
  for update;
  if not found then return null; end if;

  if v_claim.viewed_at is null then
    update public.claims
    set viewed_at = now()
    where id = v_claim.id;

    insert into public.claim_events (claim_id, actor_type, event_type)
    values (v_claim.id, 'debtor', 'claim_viewed');
  end if;

  select jsonb_build_object(
    'payerDisplayName', creditor.display_name,
    'payerAvatarUrl', null,
    'paymentPhoneE164', case
      when creditor_profile.share_payment_phone
        then creditor_profile.payment_phone_e164
      else null
    end,
    'expenseTitle', e.title,
    'merchantName', e.merchant_name,
    'occurredAt', e.occurred_at,
    'currency', e.currency,
    'amountCents', c.amount_cents,
    'status', c.status::text,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', i.name,
        'originalLineTotalCents', i.line_total_cents,
        'assignedAmountCents', a.amount_cents,
        'allocationLabel', case a.method
          when 'equal' then 'A partes iguales'
          when 'shares' then rtrim(rtrim(a.shares::text, '0'), '.') || ' partes'
          when 'percentage' then rtrim(rtrim(a.percentage::text, '0'), '.') || '%'
          when 'units' then rtrim(rtrim(a.units::text, '0'), '.') || ' unidades'
          else 'Importe personalizado'
        end
      ) order by i.sort_order, i.id)
      from public.item_allocations a
      join public.expense_items i on i.id = a.item_id
      where a.participant_id = c.debtor_participant_id
        and a.amount_cents <> 0
    ), '[]'::jsonb),
    'canDispute', c.status in ('pending', 'reminder_sent')
  ) into v_payload
  from public.claims c
  join public.expenses e on e.id = c.expense_id
  join public.expense_participants creditor on creditor.id = c.creditor_participant_id
  left join public.profiles creditor_profile on creditor_profile.id = creditor.user_id
  where c.id = v_claim.id;

  return v_payload;
end;
$$;

create or replace function public.dispute_claim_by_token(
  p_token_hash text,
  p_reason text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.claims%rowtype;
  v_dispute_id uuid;
  v_owner uuid;
  v_debtor_name text;
begin
  if p_token_hash is null
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_reason not in (
      'did_not_consume', 'incorrect_amount', 'already_paid', 'unknown_expense', 'other'
    )
    or char_length(coalesce(p_message, '')) > 1000 then
    raise exception using errcode = '22023', message = 'INVALID_DISPUTE_INPUT';
  end if;

  select * into v_claim
  from public.claims
  where public_token_hash = lower(p_token_hash)
  for update;
  if not found then return null; end if;
  if v_claim.status not in ('pending', 'reminder_sent', 'disputed') then
    raise exception using errcode = '55000', message = 'CLAIM_STATE_NOT_ALLOWED';
  end if;

  select id into v_dispute_id
  from public.claim_disputes
  where claim_id = v_claim.id and status = 'open';

  if v_dispute_id is null then
    insert into public.claim_disputes (claim_id, reason, message)
    values (v_claim.id, p_reason, nullif(trim(p_message), ''))
    returning id into v_dispute_id;

    update public.claims
    set status = 'disputed'
    where id = v_claim.id;

    insert into public.claim_events (claim_id, actor_type, event_type, metadata)
    values (
      v_claim.id,
      'debtor',
      'claim_disputed',
      jsonb_build_object('reason', p_reason)
    );
  end if;

  select e.created_by, d.display_name
    into v_owner, v_debtor_name
  from public.expenses e
  join public.expense_participants d on d.id = v_claim.debtor_participant_id
  where e.id = v_claim.expense_id;

  return jsonb_build_object(
    'claimId', v_claim.id,
    'expenseId', v_claim.expense_id,
    'disputeId', v_dispute_id,
    'status', 'disputed',
    'createdAt', now(),
    'ownerUserId', v_owner,
    'debtorDisplayName', v_debtor_name
  );
end;
$$;

create or replace function public.mark_claim_received(
  p_claim_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.claims%rowtype;
  v_owner uuid;
  v_creditor_user uuid;
  v_debtor_user uuid;
  v_now timestamptz := now();
begin
  if p_actor_user_id is null then
    raise exception using errcode = '22023', message = 'INVALID_ACTOR';
  end if;

  select * into v_claim
  from public.claims
  where id = p_claim_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CLAIM_NOT_FOUND';
  end if;

  select e.created_by, creditor.user_id, debtor.user_id
    into v_owner, v_creditor_user, v_debtor_user
  from public.expenses e
  join public.expense_participants creditor on creditor.id = v_claim.creditor_participant_id
  join public.expense_participants debtor on debtor.id = v_claim.debtor_participant_id
  where e.id = v_claim.expense_id;

  if p_actor_user_id is distinct from v_owner
    and p_actor_user_id is distinct from v_creditor_user then
    raise exception using errcode = '42501', message = 'NOT_CLAIM_CREDITOR';
  end if;

  if v_claim.status not in ('pending', 'reminder_sent', 'received') then
    raise exception using errcode = '55000', message = 'CLAIM_STATE_NOT_ALLOWED';
  end if;

  if v_claim.status <> 'received' then
    update public.claims set
      status = 'received',
      received_at = v_now,
      received_by_user_id = p_actor_user_id,
      public_token_hash = null,
      token_version = token_version + 1
    where id = v_claim.id;

    insert into public.claim_events (
      claim_id, actor_type, actor_user_id, event_type, metadata
    ) values (
      v_claim.id,
      'owner',
      p_actor_user_id,
      'claim_received',
      jsonb_build_object('source', 'manual_receiver_confirmation')
    );

    if not exists (
      select 1
      from public.claims c
      where c.expense_id = v_claim.expense_id
        and c.status in ('pending', 'reminder_sent', 'disputed')
    ) then
      update public.expenses e set
        status = case
          when exists (
            select 1 from public.claims c
            where c.expense_id = v_claim.expense_id and c.status = 'received'
          ) then 'settled'::public.expense_status
          else 'cancelled'::public.expense_status
        end
      where e.id = v_claim.expense_id;
    end if;
  end if;

  return jsonb_build_object(
    'claimId', v_claim.id,
    'expenseId', v_claim.expense_id,
    'status', 'received',
    'receivedAt', coalesce(v_claim.received_at, v_now),
    'receivedByUserId', coalesce(v_claim.received_by_user_id, p_actor_user_id),
    'debtorUserId', v_debtor_user
  );
end;
$$;

create or replace function public.prepare_claim_reminder(
  p_claim_id uuid,
  p_new_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_owner uuid;
  v_title text;
  v_currency text;
  v_debtor_name text;
  v_debtor_user uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_new_token_hash is null or p_new_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_TOKEN_HASH';
  end if;

  select * into v_claim
  from public.claims
  where id = p_claim_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CLAIM_NOT_FOUND';
  end if;

  select e.created_by, e.title, e.currency, d.display_name, d.user_id
    into v_owner, v_title, v_currency, v_debtor_name, v_debtor_user
  from public.expenses e
  join public.expense_participants d on d.id = v_claim.debtor_participant_id
  where e.id = v_claim.expense_id;

  if v_owner is distinct from v_actor then
    raise exception using errcode = '42501', message = 'NOT_EXPENSE_OWNER';
  end if;
  if v_claim.status not in ('pending', 'reminder_sent') then
    raise exception using errcode = '55000', message = 'REMINDER_NOT_ALLOWED';
  end if;
  if coalesce(v_claim.last_reminded_at, v_claim.sent_at) > now() - interval '24 hours' then
    raise exception using errcode = '55000', message = 'REMINDER_TOO_SOON';
  end if;

  update public.claims set
    status = 'reminder_sent',
    public_token_hash = lower(p_new_token_hash),
    token_version = token_version + 1,
    last_reminded_at = now(),
    reminder_count = reminder_count + 1
  where id = v_claim.id;

  insert into public.claim_events (claim_id, actor_type, actor_user_id, event_type)
  values (v_claim.id, 'owner', v_actor, 'reminder_sent');

  insert into public.usage_counters (user_id, period_start, reminders_sent)
  values (v_actor, date_trunc('month', now())::date, 1)
  on conflict (user_id, period_start) do update
  set reminders_sent = public.usage_counters.reminders_sent + 1;

  return jsonb_build_object(
    'claimId', v_claim.id,
    'status', 'reminder_sent',
    'amountCents', v_claim.amount_cents,
    'currency', v_currency,
    'expenseTitle', v_title,
    'debtorDisplayName', v_debtor_name,
    'debtorUserId', v_debtor_user,
    'reminderCount', v_claim.reminder_count + 1,
    'lastRemindedAt', now()
  );
end;
$$;

create or replace function public.resolve_claim_dispute_transaction(
  p_claim_id uuid,
  p_outcome text,
  p_resolution_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_dispute public.claim_disputes%rowtype;
  v_owner uuid;
  v_creditor_user uuid;
  v_debtor_user uuid;
  v_next_status public.claim_status;
  v_dispute_status public.dispute_status;
  v_resolved_at timestamptz := now();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_outcome is null
    or p_outcome not in ('reopen', 'cancel')
    or char_length(coalesce(p_resolution_note, '')) > 1000 then
    raise exception using errcode = '22023', message = 'INVALID_DISPUTE_RESOLUTION';
  end if;

  select * into v_claim
  from public.claims
  where id = p_claim_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CLAIM_NOT_FOUND';
  end if;

  select e.created_by, creditor.user_id, debtor.user_id
    into v_owner, v_creditor_user, v_debtor_user
  from public.expenses e
  join public.expense_participants creditor on creditor.id = v_claim.creditor_participant_id
  join public.expense_participants debtor on debtor.id = v_claim.debtor_participant_id
  where e.id = v_claim.expense_id;

  if v_actor is distinct from v_owner and v_actor is distinct from v_creditor_user then
    raise exception using errcode = '42501', message = 'NOT_CLAIM_CREDITOR';
  end if;
  if v_claim.status <> 'disputed' then
    raise exception using errcode = '55000', message = 'CLAIM_STATE_NOT_ALLOWED';
  end if;

  select * into v_dispute
  from public.claim_disputes
  where claim_id = v_claim.id and status = 'open'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'DISPUTE_NOT_FOUND';
  end if;

  v_next_status := case
    when p_outcome = 'cancel' then 'cancelled'::public.claim_status
    when v_claim.reminder_count > 0 or v_claim.last_reminded_at is not null
      then 'reminder_sent'::public.claim_status
    else 'pending'::public.claim_status
  end;
  v_dispute_status := case
    when p_outcome = 'cancel' then 'dismissed'::public.dispute_status
    else 'resolved'::public.dispute_status
  end;

  update public.claim_disputes set
    status = v_dispute_status,
    resolved_by = v_actor,
    resolution_note = nullif(trim(p_resolution_note), ''),
    resolved_at = v_resolved_at
  where id = v_dispute.id;

  if p_outcome = 'cancel' then
    update public.claims set
      status = 'cancelled',
      public_token_hash = null,
      token_version = token_version + 1,
      cancelled_at = v_resolved_at
    where id = v_claim.id;
  else
    update public.claims set status = v_next_status
    where id = v_claim.id;
  end if;

  insert into public.claim_events (
    claim_id, actor_type, actor_user_id, event_type, metadata
  ) values (
    v_claim.id,
    'owner',
    v_actor,
    case when p_outcome = 'cancel' then 'dispute_cancelled' else 'dispute_resolved' end,
    jsonb_build_object('outcome', p_outcome)
  );

  if p_outcome = 'cancel' then
    insert into public.claim_events (claim_id, actor_type, actor_user_id, event_type)
    values (v_claim.id, 'owner', v_actor, 'claim_cancelled');

    if not exists (
      select 1
      from public.claims c
      where c.expense_id = v_claim.expense_id
        and c.status in ('pending', 'reminder_sent', 'disputed')
    ) then
      update public.expenses e set
        status = case
          when exists (
            select 1 from public.claims c
            where c.expense_id = v_claim.expense_id and c.status = 'received'
          ) then 'settled'::public.expense_status
          else 'cancelled'::public.expense_status
        end
      where e.id = v_claim.expense_id;
    end if;
  end if;

  return jsonb_build_object(
    'claimId', v_claim.id,
    'disputeId', v_dispute.id,
    'status', v_next_status,
    'disputeStatus', v_dispute_status,
    'resolvedAt', v_resolved_at,
    'debtorUserId', v_debtor_user
  );
end;
$$;

create or replace function public.revoke_claim_transaction(p_claim_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_owner uuid;
  v_dispute_id uuid;
  v_cancelled_at timestamptz := now();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select * into v_claim
  from public.claims
  where id = p_claim_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CLAIM_NOT_FOUND';
  end if;

  select created_by into v_owner
  from public.expenses
  where id = v_claim.expense_id;
  if v_owner is distinct from v_actor then
    raise exception using errcode = '42501', message = 'NOT_EXPENSE_OWNER';
  end if;
  if v_claim.status = 'received' then
    raise exception using errcode = '55000', message = 'RECEIVED_CLAIM_CANNOT_BE_REVOKED';
  end if;

  if v_claim.status <> 'cancelled' then
    update public.claim_disputes set
      status = 'dismissed',
      resolved_by = v_actor,
      resolution_note = coalesce(nullif(trim(resolution_note), ''), 'Solicitud cancelada'),
      resolved_at = v_cancelled_at
    where claim_id = v_claim.id and status = 'open'
    returning id into v_dispute_id;

    if v_dispute_id is not null then
      insert into public.claim_events (claim_id, actor_type, actor_user_id, event_type)
      values (v_claim.id, 'owner', v_actor, 'dispute_cancelled');
    end if;

    update public.claims set
      status = 'cancelled',
      public_token_hash = null,
      token_version = token_version + 1,
      cancelled_at = v_cancelled_at
    where id = v_claim.id;

    insert into public.claim_events (claim_id, actor_type, actor_user_id, event_type)
    values (v_claim.id, 'owner', v_actor, 'claim_cancelled');

    if not exists (
      select 1
      from public.claims c
      where c.expense_id = v_claim.expense_id
        and c.status in ('pending', 'reminder_sent', 'disputed')
    ) then
      update public.expenses e set
        status = case
          when exists (
            select 1 from public.claims c
            where c.expense_id = v_claim.expense_id and c.status = 'received'
          ) then 'settled'::public.expense_status
          else 'cancelled'::public.expense_status
        end
      where e.id = v_claim.expense_id;
    end if;
  end if;

  return jsonb_build_object(
    'claimId', v_claim.id,
    'status', 'cancelled',
    'cancelledAt', coalesce(v_claim.cancelled_at, v_cancelled_at)
  );
end;
$$;

create or replace function public.delete_account_data_transaction(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_group record;
  v_replacement uuid;
  v_groups_transferred integer := 0;
  v_groups_deleted integer := 0;
  v_expenses_deleted integer := 0;
  v_expenses_preserved integer := 0;
  v_expenses_to_delete uuid[] := array[]::uuid[];
  v_rows integer := 0;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'ACCOUNT_DELETION_FORBIDDEN';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'INVALID_USER_ID';
  end if;

  perform 1
  from public.profiles
  where id = p_user_id
  for update;
  if not found then
    return jsonb_build_object(
      'deleted', false,
      'groupsTransferred', 0,
      'groupsDeleted', 0,
      'expensesDeleted', 0,
      'expensesPreserved', 0
    );
  end if;

  for v_group in
    select g.id
    from public.groups g
    where g.owner_id = p_user_id
    order by g.id
    for update
  loop
    v_replacement := null;
    select gm.user_id
      into v_replacement
    from public.group_members gm
    join public.profiles p on p.id = gm.user_id
    where gm.group_id = v_group.id
      and gm.user_id is distinct from p_user_id
      and gm.status = 'active'
    order by
      case gm.role when 'admin' then 0 when 'member' then 1 else 2 end,
      gm.created_at,
      gm.id
    limit 1
    for update of gm;

    if v_replacement is null then
      delete from public.groups where id = v_group.id;
      v_groups_deleted := v_groups_deleted + 1;
    else
      delete from public.group_members
      where group_id = v_group.id and user_id = p_user_id;
      update public.group_members set role = 'owner', status = 'active'
      where group_id = v_group.id and user_id = v_replacement;
      update public.groups set owner_id = v_replacement
      where id = v_group.id;
      v_groups_transferred := v_groups_transferred + 1;
    end if;
  end loop;

  delete from public.group_invites
  where created_by = p_user_id or accepted_by = p_user_id;

  with dismissed as (
    update public.claim_disputes d set
      status = 'dismissed',
      resolved_by = null,
      resolution_note = 'Cuenta eliminada',
      resolved_at = now()
    from public.claims c, public.expenses e, public.expense_participants creditor
    where d.claim_id = c.id
      and e.id = c.expense_id
      and creditor.id = c.creditor_participant_id
      and (e.created_by = p_user_id or creditor.user_id = p_user_id)
      and d.status = 'open'
    returning d.claim_id
  )
  insert into public.claim_events (claim_id, actor_type, event_type, metadata)
  select
    claim_id,
    'system',
    'dispute_cancelled',
    jsonb_build_object('reason', 'account_deleted')
  from dismissed;

  with affected as (
    update public.claims c set
      status = case
        when c.status = 'received' then 'received'::public.claim_status
        else 'cancelled'::public.claim_status
      end,
      public_token_hash = null,
      token_version = c.token_version + case when c.public_token_hash is null then 0 else 1 end,
      cancelled_at = case
        when c.status = 'received' then c.cancelled_at
        else coalesce(c.cancelled_at, now())
      end
    from public.expenses e, public.expense_participants creditor
    where c.expense_id = e.id
      and creditor.id = c.creditor_participant_id
      and (e.created_by = p_user_id or creditor.user_id = p_user_id)
      and (c.public_token_hash is not null or c.status not in ('received', 'cancelled'))
    returning c.id
  )
  insert into public.claim_events (claim_id, actor_type, event_type, metadata)
  select
    id,
    'system',
    'account_deleted',
    jsonb_build_object('publicAccessRevoked', true)
  from affected;

  update public.claim_disputes d
  set message = null
  from public.claims c, public.expense_participants debtor
  where d.claim_id = c.id
    and debtor.id = c.debtor_participant_id
    and debtor.user_id = p_user_id;

  update public.claim_disputes
  set resolution_note = null, resolved_by = null
  where resolved_by = p_user_id;

  update public.claim_events
  set actor_user_id = null
  where actor_user_id = p_user_id;

  update public.expenses
  set notes = null
  where created_by = p_user_id;

  select coalesce(array_agg(e.id order by e.id), array[]::uuid[])
    into v_expenses_to_delete
  from public.expenses e
  where e.created_by = p_user_id
    and not exists (
      select 1
      from public.expense_participants ep
      where ep.expense_id = e.id
        and ep.user_id is distinct from p_user_id
    )
    and not exists (
      select 1
      from public.group_members gm
      where gm.group_id = e.group_id
        and gm.status = 'active'
        and gm.user_id is distinct from p_user_id
    );

  update public.expenses
  set payer_participant_id = null
  where id = any(v_expenses_to_delete);

  delete from public.expenses
  where id = any(v_expenses_to_delete);
  get diagnostics v_expenses_deleted = row_count;

  update public.expenses
  set receipt_path = null
  where receipt_path is not null
    and split_part(receipt_path, '/', 1) = p_user_id::text;

  update public.expenses
  set created_by = null
  where created_by = p_user_id;
  get diagnostics v_expenses_preserved = row_count;

  update public.expense_participants set
    user_id = null,
    display_name = 'Usuario eliminado',
    avatar_path = null,
    email = null,
    phone_e164 = null
  where user_id = p_user_id;

  delete from public.group_members
  where user_id = p_user_id;

  if exists (select 1 from public.groups where owner_id = p_user_id)
    or exists (select 1 from public.expenses where created_by = p_user_id) then
    raise exception using errcode = '55000', message = 'ACCOUNT_DELETION_INCOMPLETE';
  end if;

  delete from public.profiles
  where id = p_user_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception using errcode = '55000', message = 'ACCOUNT_DELETION_INCOMPLETE';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'groupsTransferred', v_groups_transferred,
    'groupsDeleted', v_groups_deleted,
    'expensesDeleted', v_expenses_deleted,
    'expensesPreserved', v_expenses_preserved
  );
end;
$$;

-- Reputation uses the only server-authoritative completion timestamp left in
-- this product: when the receiver manually confirms receipt. It must not be
-- described as bank-verified payment time.
create or replace function private.get_reputation_card(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_completed integer := 0;
  v_within_24 integer := 0;
  v_within_24_rate integer;
  v_median_hours numeric;
  v_average_reminders numeric;
  v_score integer;
  v_level text := 'new';
  v_current_streak integer := 0;
  v_longest_streak integer := 0;
  v_has_overdue boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_user_id is null
    or not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception using errcode = 'P0002', message = 'PROFILE_NOT_FOUND';
  end if;
  if p_user_id <> v_actor and not exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = v_actor
      and mine.status = 'active'
      and theirs.user_id = p_user_id
      and theirs.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'REPUTATION_NOT_VISIBLE';
  end if;

  with completed as (
    select
      c.id,
      c.received_at,
      c.reputation_started_at as started_at,
      extract(epoch from (c.received_at - c.reputation_started_at)) / 3600.0
        as receipt_hours,
      c.received_at <= c.reputation_started_at + interval '24 hours' as within_24,
      (
        select count(*)::integer
        from public.claim_events ce
        where ce.claim_id = c.id
          and ce.event_type = 'reminder_sent'
          and ce.created_at >= c.reputation_started_at + interval '24 hours'
          and ce.created_at <= c.received_at
      ) as qualified_reminders
    from public.claims c
    join public.expense_participants debtor on debtor.id = c.debtor_participant_id
    where debtor.user_id = p_user_id
      and c.status = 'received'
      and c.received_at is not null
      and c.reputation_started_at is not null
      and not exists (
        select 1
        from public.claim_disputes d
        where d.claim_id = c.id
      )
  )
  select
    count(*)::integer,
    count(*) filter (where within_24)::integer,
    case
      when count(*) = 0 then null
      else round(100.0 * count(*) filter (where within_24) / count(*))::integer
    end,
    round((percentile_cont(0.5) within group (order by receipt_hours))::numeric, 1),
    round(avg(qualified_reminders)::numeric, 1)
  into
    v_completed,
    v_within_24,
    v_within_24_rate,
    v_median_hours,
    v_average_reminders
  from completed;

  select exists (
    select 1
    from public.claims c
    join public.expense_participants debtor on debtor.id = c.debtor_participant_id
    where debtor.user_id = p_user_id
      and c.reputation_started_at is not null
      and c.reputation_started_at <= now() - interval '24 hours'
      and c.status in ('pending', 'reminder_sent')
  ) into v_has_overdue;

  if v_completed >= 3 then
    with completed as (
      select
        c.received_at,
        extract(epoch from (c.received_at - c.reputation_started_at)) / 3600.0
          as receipt_hours,
        (
          select count(*)::integer
          from public.claim_events ce
          where ce.claim_id = c.id
            and ce.event_type = 'reminder_sent'
            and ce.created_at >= c.reputation_started_at + interval '24 hours'
            and ce.created_at <= c.received_at
        ) as qualified_reminders
      from public.claims c
      join public.expense_participants debtor on debtor.id = c.debtor_participant_id
      where debtor.user_id = p_user_id
        and c.status = 'received'
        and c.received_at is not null
        and c.reputation_started_at is not null
        and not exists (
          select 1 from public.claim_disputes d where d.claim_id = c.id
        )
      order by c.received_at desc
      limit 20
    ), scored as (
      select 100.0 * (
        0.75 * exp(-greatest(receipt_hours - 24.0, 0.0) / 72.0)
        + 0.25 * (1.0 / (1.0 + least(qualified_reminders, 3)))
      ) as claim_score
      from completed
    )
    select round((225.0 + sum(claim_score)) / (3.0 + count(*)))::integer
      into v_score
    from scored;

    v_level := case
      when v_score >= 90 then 'very_reliable'
      when v_score >= 75 then 'reliable'
      when v_score >= 60 then 'building'
      else 'improving'
    end;
  end if;

  with completed as (
    select
      c.id,
      c.received_at,
      c.received_at <= c.reputation_started_at + interval '24 hours' as within_24
    from public.claims c
    join public.expense_participants debtor on debtor.id = c.debtor_participant_id
    where debtor.user_id = p_user_id
      and c.status = 'received'
      and c.received_at is not null
      and c.reputation_started_at is not null
      and not exists (
        select 1 from public.claim_disputes d where d.claim_id = c.id
      )
  ), newest_first as (
    select
      within_24,
      bool_and(within_24) over (
        order by received_at desc, id desc
        rows between unbounded preceding and current row
      ) as all_within_24_so_far
    from completed
  ), grouped as (
    select
      within_24,
      sum(case when within_24 then 0 else 1 end) over (
        order by received_at, id
      ) as streak_group
    from completed
  ), longest as (
    select count(*)::integer as streak_length
    from grouped
    where within_24
    group by streak_group
  )
  select
    coalesce((
      select count(*)::integer
      from newest_first
      where all_within_24_so_far
    ), 0),
    coalesce((select max(streak_length) from longest), 0)
  into v_current_streak, v_longest_streak;

  if v_has_overdue then v_current_streak := 0; end if;

  return jsonb_build_object(
    'userId', p_user_id,
    'score', v_score,
    'level', v_level,
    'currentStreak', v_current_streak,
    'longestStreak', v_longest_streak,
    'completedPayments', v_completed,
    'within24Rate', case when p_user_id = v_actor then v_within_24_rate else null end,
    'medianReceiptHours', case when p_user_id = v_actor then v_median_hours else null end,
    'medianPaymentHours', case when p_user_id = v_actor then v_median_hours else null end,
    'averageReminders', case when p_user_id = v_actor then v_average_reminders else null end,
    'measurement', 'receiver_confirmation',
    'isOwn', p_user_id = v_actor
  );
end;
$$;

create or replace function public.get_group_streak(p_group_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_current integer := 0;
  v_longest integer := 0;
  v_completed integer := 0;
  v_successful integer := 0;
  v_rate integer;
  v_has_overdue boolean := false;
  v_active_claims integer := 0;
  v_next_deadline timestamptz;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_group_id is null or not private.is_group_member(p_group_id) then
    raise exception using errcode = '42501', message = 'NOT_GROUP_MEMBER';
  end if;

  with eligible_claims as (
    select
      e.id as expense_id,
      c.id as claim_id,
      c.status,
      c.received_at,
      c.reputation_started_at,
      debtor.user_id as debtor_user_id
    from public.expenses e
    join public.claims c on c.expense_id = e.id
    join public.expense_participants debtor on debtor.id = c.debtor_participant_id
    where e.group_id = p_group_id
      and e.archived_at is null
      and e.status <> 'cancelled'
      and c.status <> 'cancelled'
      and not exists (
        select 1
        from public.claim_disputes dispute
        where dispute.claim_id = c.id
      )
  ), expense_outcomes as (
    select
      expense_id,
      max(received_at) filter (where status = 'received') as completed_at,
      bool_and(status = 'received') as is_complete,
      bool_and(
        status = 'received'
        and reputation_started_at is not null
        and received_at is not null
        and debtor_user_id is not null
        and received_at <= reputation_started_at + interval '24 hours'
      ) as succeeded
    from eligible_claims
    group by expense_id
  ), completed as (
    select expense_id, completed_at, succeeded
    from expense_outcomes
    where is_complete and completed_at is not null
  ), newest_first as (
    select
      succeeded,
      bool_and(succeeded) over (
        order by completed_at desc, expense_id desc
        rows between unbounded preceding and current row
      ) as all_successful_so_far
    from completed
  ), grouped as (
    select
      succeeded,
      sum(case when succeeded then 0 else 1 end) over (
        order by completed_at, expense_id
      ) as streak_group
    from completed
  ), longest as (
    select count(*)::integer as streak_length
    from grouped
    where succeeded
    group by streak_group
  )
  select
    coalesce((
      select count(*)::integer
      from newest_first
      where all_successful_so_far
    ), 0),
    coalesce((select max(streak_length) from longest), 0),
    coalesce((select count(*)::integer from completed), 0),
    coalesce((select count(*)::integer from completed where succeeded), 0)
  into v_current, v_longest, v_completed, v_successful;

  select
    exists (
      select 1
      from public.expenses e
      join public.claims c on c.expense_id = e.id
      where e.group_id = p_group_id
        and e.archived_at is null
        and e.status <> 'cancelled'
        and c.status in ('pending', 'reminder_sent')
        and c.reputation_started_at is not null
        and c.reputation_started_at <= now() - interval '24 hours'
        and not exists (
          select 1
          from public.claim_disputes dispute
          where dispute.claim_id = c.id
        )
    ),
    count(*) filter (
      where c.status in ('pending', 'reminder_sent')
    )::integer,
    min(c.reputation_started_at + interval '24 hours') filter (
      where c.status in ('pending', 'reminder_sent')
        and c.reputation_started_at is not null
        and c.reputation_started_at > now() - interval '24 hours'
    )
  into v_has_overdue, v_active_claims, v_next_deadline
  from public.expenses e
  join public.claims c on c.expense_id = e.id
  where e.group_id = p_group_id
    and e.archived_at is null
    and e.status <> 'cancelled'
    and c.status <> 'cancelled'
    and not exists (
      select 1
      from public.claim_disputes dispute
      where dispute.claim_id = c.id
    );

  if v_has_overdue then v_current := 0; end if;
  if v_completed > 0 then
    v_rate := round(100.0 * v_successful / v_completed)::integer;
  end if;

  return jsonb_build_object(
    'groupId', p_group_id,
    'currentStreak', coalesce(v_current, 0),
    'longestStreak', coalesce(v_longest, 0),
    'completedRounds', coalesce(v_completed, 0),
    'successfulRounds', coalesce(v_successful, 0),
    'within24Rate', v_rate,
    'measurement', 'receiver_confirmation',
    'hasOverdue', coalesce(v_has_overdue, false),
    'activeClaims', coalesce(v_active_claims, 0),
    'nextDeadline', v_next_deadline
  );
end;
$$;

-- Reassert every grant explicitly. Newly created public functions otherwise
-- inherit EXECUTE for PUBLIC in PostgreSQL.
revoke all on function public.create_claims_transaction(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.consume_endpoint_rate_limit(text, text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.get_public_claim_payload(text)
  from public, anon, authenticated, service_role;
revoke all on function public.dispute_claim_by_token(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.mark_claim_received(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_claim_reminder(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_claim_dispute_transaction(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.revoke_claim_transaction(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_account_data_transaction(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.get_reputation_card(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_reputation_card(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_reputation_cards(uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.get_group_streak(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.create_claims_transaction(uuid, jsonb)
  to authenticated;
grant execute on function public.prepare_claim_reminder(uuid, text)
  to authenticated;
grant execute on function public.resolve_claim_dispute_transaction(uuid, text, text)
  to authenticated;
grant execute on function public.revoke_claim_transaction(uuid)
  to authenticated;
grant execute on function private.get_reputation_card(uuid)
  to authenticated;
grant execute on function public.get_reputation_card(uuid)
  to authenticated;
grant execute on function public.get_reputation_cards(uuid[])
  to authenticated;
grant execute on function public.get_group_streak(uuid)
  to authenticated;

grant execute on function public.consume_endpoint_rate_limit(text, text, integer, integer)
  to service_role;
grant execute on function public.get_public_claim_payload(text)
  to service_role;
grant execute on function public.dispute_claim_by_token(text, text, text)
  to service_role;
grant execute on function public.mark_claim_received(uuid, uuid)
  to service_role;
grant execute on function public.delete_account_data_transaction(uuid)
  to service_role;
