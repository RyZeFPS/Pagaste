-- User-controlled reminder schedules. These settings only make reminders
-- available; Pagaste never sends them without an explicit bank-review
-- confirmation from the expense owner.

create table public.reminder_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  enabled boolean not null default true,
  first_delay_hours smallint not null default 24
    check (first_delay_hours in (24, 48, 72)),
  second_delay_days smallint not null default 3
    check (second_delay_days between 2 and 30),
  quiet_start time,
  quiet_end time,
  message_tone text not null default 'neutral'
    check (message_tone in ('soft', 'neutral', 'direct')),
  group_same_debtor boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (quiet_start is null and quiet_end is null)
    or (
      quiet_start is not null
      and quiet_end is not null
      and quiet_start <> quiet_end
    )
  )
);

create trigger reminder_preferences_set_updated_at
before update on public.reminder_preferences
for each row execute function private.set_updated_at();

alter table public.reminder_preferences enable row level security;

create policy reminder_preferences_select_own
on public.reminder_preferences
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy reminder_preferences_insert_own
on public.reminder_preferences
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy reminder_preferences_update_own
on public.reminder_preferences
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy reminder_preferences_delete_own
on public.reminder_preferences
for delete
to authenticated
using ((select auth.uid()) = user_id);

create index claims_owner_reminder_candidates_idx
on public.claims (expense_id, status, reminder_count, last_reminded_at)
where status in ('pending', 'reminder_sent');

create or replace function private.reminder_due_at(
  p_sent_at timestamptz,
  p_last_reminded_at timestamptz,
  p_reminder_count integer,
  p_first_delay_hours smallint,
  p_second_delay_days smallint
)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when p_reminder_count = 0
      then p_sent_at + make_interval(hours => p_first_delay_hours)
    when p_reminder_count = 1
      then p_last_reminded_at + make_interval(days => p_second_delay_days)
    else null
  end;
$$;

create or replace function private.is_quiet_time(
  p_local_time time,
  p_quiet_start time,
  p_quiet_end time
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_quiet_start is null or p_quiet_end is null then false
    when p_quiet_start < p_quiet_end
      then p_local_time >= p_quiet_start and p_local_time < p_quiet_end
    else p_local_time >= p_quiet_start or p_local_time < p_quiet_end
  end;
$$;

create or replace function public.preview_claim_reminder(p_claim_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_seed record;
  v_enabled boolean := true;
  v_first_delay smallint := 24;
  v_second_delay smallint := 3;
  v_quiet_start time := time '22:00';
  v_quiet_end time := time '08:00';
  v_tone text := 'neutral';
  v_group boolean := true;
  v_timezone text := 'Europe/Madrid';
  v_recipient_locale text := 'es-ES';
  v_due_at timestamptz;
  v_local_time time;
  v_eligible boolean := false;
  v_blocked_reason text;
  v_claims jsonb := '[]'::jsonb;
  v_total_cents bigint := 0;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_claim_id is null then
    raise exception using errcode = '22023', message = 'INVALID_CLAIM_ID';
  end if;

  select
    c.*,
    e.created_by as owner_user_id,
    e.currency as expense_currency,
    d.display_name as debtor_display_name,
    d.user_id as debtor_user_id,
    d.email as debtor_email,
    d.phone_e164 as debtor_phone
  into v_seed
  from public.claims c
  join public.expenses e on e.id = c.expense_id
  join public.expense_participants d on d.id = c.debtor_participant_id
  where c.id = p_claim_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'CLAIM_NOT_FOUND';
  end if;
  if v_seed.owner_user_id is distinct from v_actor then
    raise exception using errcode = '42501', message = 'NOT_EXPENSE_OWNER';
  end if;

  select
    rp.enabled,
    rp.first_delay_hours,
    rp.second_delay_days,
    rp.quiet_start,
    rp.quiet_end,
    rp.message_tone,
    rp.group_same_debtor
  into
    v_enabled,
    v_first_delay,
    v_second_delay,
    v_quiet_start,
    v_quiet_end,
    v_tone,
    v_group
  from public.reminder_preferences rp
  where rp.user_id = v_actor;
  if not found then
    v_enabled := true;
    v_first_delay := 24;
    v_second_delay := 3;
    v_quiet_start := time '22:00';
    v_quiet_end := time '08:00';
    v_tone := 'neutral';
    v_group := true;
  end if;

  select
    case
      when exists (
        select 1
        from pg_catalog.pg_timezone_names tz
        where tz.name = coalesce(dp.timezone, op.timezone)
      ) then coalesce(dp.timezone, op.timezone)
      else 'Europe/Madrid'
    end,
    coalesce(dp.locale, op.locale, 'es-ES')
  into v_timezone, v_recipient_locale
  from public.profiles op
  left join public.profiles dp on dp.id = v_seed.debtor_user_id
  where op.id = v_actor;
  v_timezone := coalesce(v_timezone, 'Europe/Madrid');

  v_due_at := private.reminder_due_at(
    v_seed.sent_at,
    v_seed.last_reminded_at,
    v_seed.reminder_count,
    v_first_delay,
    v_second_delay
  );
  v_local_time := (now() at time zone v_timezone)::time;

  if not v_enabled then
    v_blocked_reason := 'disabled';
  elsif v_seed.status not in ('pending', 'reminder_sent') then
    v_blocked_reason := 'status';
  elsif v_seed.reminder_count >= 2 then
    v_blocked_reason := 'limit_reached';
  elsif v_due_at is null or v_due_at > now() then
    v_blocked_reason := 'not_due';
  elsif private.is_quiet_time(v_local_time, v_quiet_start, v_quiet_end) then
    v_blocked_reason := 'quiet_hours';
  else
    v_eligible := true;
  end if;

  with candidates as (
    select
      c.id,
      c.amount_cents,
      c.reminder_count,
      c.sent_at,
      c.last_reminded_at,
      e.id as expense_id,
      e.title as expense_title,
      e.merchant_name,
      e.currency,
      d.display_name as debtor_display_name,
      d.user_id as debtor_user_id,
      private.reminder_due_at(
        c.sent_at,
        c.last_reminded_at,
        c.reminder_count,
        v_first_delay,
        v_second_delay
      ) as due_at
    from public.claims c
    join public.expenses e on e.id = c.expense_id
    join public.expense_participants d on d.id = c.debtor_participant_id
    where e.created_by = v_actor
      and e.currency = v_seed.expense_currency
      and c.status in ('pending', 'reminder_sent')
      and c.reminder_count < 2
      and (
        c.id = v_seed.id
        or (
          v_group
          and (
            (v_seed.debtor_user_id is not null and d.user_id = v_seed.debtor_user_id)
            or (
              v_seed.debtor_user_id is null
              and v_seed.debtor_email is not null
              and lower(d.email) = lower(v_seed.debtor_email)
            )
            or (
              v_seed.debtor_user_id is null
              and v_seed.debtor_email is null
              and v_seed.debtor_phone is not null
              and d.phone_e164 = v_seed.debtor_phone
            )
          )
        )
      )
  ),
  selected as (
    select *
    from candidates
    where id = v_seed.id
      or (
        v_eligible
        and due_at is not null
        and due_at <= now()
      )
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'claimId', id,
          'expenseId', expense_id,
          'expenseTitle', expense_title,
          'merchantName', merchant_name,
          'amountCents', amount_cents,
          'currency', currency,
          'debtorDisplayName', debtor_display_name,
          'debtorUserId', debtor_user_id,
          'reminderCount', reminder_count,
          'dueAt', due_at
        )
        order by sent_at, id
      ),
      '[]'::jsonb
    ),
    coalesce(sum(amount_cents), 0)
  into v_claims, v_total_cents
  from selected;

  return jsonb_build_object(
    'eligible', v_eligible,
    'blockedReason', v_blocked_reason,
    'nextAllowedAt', v_due_at,
    'debtorDisplayName', v_seed.debtor_display_name,
    'debtorUserId', v_seed.debtor_user_id,
    'recipientLocale', v_recipient_locale,
    'currency', v_seed.expense_currency,
    'totalCents', v_total_cents,
    'messageTone', v_tone,
    'grouped', jsonb_array_length(v_claims) > 1,
    'claims', v_claims
  );
end;
$$;

create or replace function public.prepare_claim_reminder_batch(
  p_claims jsonb,
  p_bank_checked boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_entry jsonb;
  v_claim_id uuid;
  v_token_hash text;
  v_seed_id uuid;
  v_preview jsonb;
  v_input_ids uuid[];
  v_preview_ids uuid[];
  v_count integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_bank_checked is distinct from true then
    raise exception using errcode = '55000', message = 'BANK_REVIEW_REQUIRED';
  end if;
  if p_claims is null
    or jsonb_typeof(p_claims) <> 'array'
    or jsonb_array_length(p_claims) < 1
    or jsonb_array_length(p_claims) > 20 then
    raise exception using errcode = '22023', message = 'INVALID_REMINDER_BATCH';
  end if;

  select
    array_agg((entry ->> 'claimId')::uuid order by (entry ->> 'claimId')::uuid),
    count(*)
  into v_input_ids, v_count
  from jsonb_array_elements(p_claims) as items(entry);

  if cardinality(v_input_ids) <> (
    select count(distinct value)
    from unnest(v_input_ids) as ids(value)
  ) then
    raise exception using errcode = '22023', message = 'DUPLICATE_CLAIM_ID';
  end if;

  v_seed_id := v_input_ids[1];

  -- Lock in a deterministic order, then calculate the preview from the locked state.
  perform c.id
  from public.claims c
  where c.id = any(v_input_ids)
  order by c.id
  for update;

  if not found or (
    select count(*)
    from public.claims c
    where c.id = any(v_input_ids)
  ) <> v_count then
    raise exception using errcode = 'P0002', message = 'CLAIM_NOT_FOUND';
  end if;

  v_preview := public.preview_claim_reminder(v_seed_id);

  if coalesce((v_preview ->> 'eligible')::boolean, false) is not true then
    raise exception using
      errcode = '55000',
      message = 'REMINDER_' || upper(coalesce(v_preview ->> 'blockedReason', 'NOT_ALLOWED'));
  end if;

  select array_agg((entry ->> 'claimId')::uuid order by (entry ->> 'claimId')::uuid)
  into v_preview_ids
  from jsonb_array_elements(v_preview -> 'claims') as items(entry);

  if v_input_ids is distinct from v_preview_ids then
    raise exception using errcode = '40001', message = 'REMINDER_BUNDLE_CHANGED';
  end if;

  for v_entry in
    select entry
    from jsonb_array_elements(p_claims) as items(entry)
  loop
    begin
      v_claim_id := (v_entry ->> 'claimId')::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'INVALID_CLAIM_ID';
    end;
    v_token_hash := lower(coalesce(v_entry ->> 'tokenHash', ''));
    if v_token_hash !~ '^[0-9a-f]{64}$' then
      raise exception using errcode = '22023', message = 'INVALID_TOKEN_HASH';
    end if;

    update public.claims
    set
      status = 'reminder_sent',
      public_token_hash = v_token_hash,
      token_version = token_version + 1,
      last_reminded_at = now(),
      reminder_count = reminder_count + 1
    where id = v_claim_id;
  end loop;

  insert into public.claim_events (claim_id, actor_type, actor_user_id, event_type, metadata)
  select
    value,
    'owner',
    v_actor,
    'reminder_sent',
    jsonb_build_object(
      'bankReviewed', true,
      'groupedClaims', v_count,
      'messageTone', v_preview ->> 'messageTone'
    )
  from unnest(v_input_ids) as ids(value);

  insert into public.usage_counters (user_id, period_start, reminders_sent)
  values (v_actor, date_trunc('month', now())::date, v_count)
  on conflict (user_id, period_start) do update
  set reminders_sent = public.usage_counters.reminders_sent + excluded.reminders_sent;

  return v_preview || jsonb_build_object('preparedAt', now());
end;
$$;

revoke all on table public.reminder_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.reminder_preferences to authenticated;
grant all on table public.reminder_preferences to service_role;

revoke all on function public.preview_claim_reminder(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.prepare_claim_reminder_batch(jsonb, boolean)
from public, anon, authenticated, service_role;
revoke all on function public.prepare_claim_reminder(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function public.preview_claim_reminder(uuid) to authenticated;
grant execute on function public.prepare_claim_reminder_batch(jsonb, boolean) to authenticated;
