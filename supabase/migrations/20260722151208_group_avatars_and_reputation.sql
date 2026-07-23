-- Group imagery and reputation are deliberately kept server-authoritative.
-- Storage paths are immutable, while reputation is derived only from payments
-- whose actor was validated by the Edge Function against Supabase Auth.

alter table public.groups
  add constraint groups_avatar_path_shape check (
    avatar_path is null
    or avatar_path ~* (
      '^' || id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
    )
  );

create function private.group_avatar_object_visible(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
    and private.is_group_member(
      case
        when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then split_part(p_name, '/', 1)::uuid
        else null
      end
    );
$$;

create function private.group_avatar_object_owned(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
    and exists (
      select 1
      from public.groups g
      where g.id = case
        when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then split_part(p_name, '/', 1)::uuid
        else null
      end
        and g.owner_id = (select auth.uid())
        and g.archived_at is null
    );
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('group-avatars', 'group-avatars', false, 2097152, array['image/jpeg'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy group_avatars_select_members
on storage.objects
for select
to authenticated
using (
  bucket_id = 'group-avatars'
  and private.group_avatar_object_visible(name)
);

create policy group_avatars_insert_owner
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'group-avatars'
  and private.group_avatar_object_owned(name)
);

create policy group_avatars_delete_owner
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'group-avatars'
  and private.group_avatar_object_owned(name)
);

alter table public.claims
  add column reputation_started_at timestamptz,
  add column marked_paid_by_user_id uuid references public.profiles (id) on delete set null,
  add column reputation_verified_at timestamptz,
  add constraint claims_reputation_timestamps_valid check (
    reputation_verified_at is null
    or (
      reputation_started_at is not null
      and marked_paid_at is not null
      and reputation_verified_at >= reputation_started_at
    )
  );

create index expense_participants_user_claims_idx
  on public.expense_participants (user_id, id)
  where user_id is not null;

create index expenses_payer_participant_fk_idx
  on public.expenses (id, payer_participant_id)
  where payer_participant_id is not null;

create index claims_debtor_reputation_idx
  on public.claims (debtor_participant_id, reputation_started_at desc)
  where reputation_started_at is not null;

create index claim_events_qualified_reminders_idx
  on public.claim_events (claim_id, created_at)
  where event_type = 'reminder_sent';

create function private.initialize_claim_reputation_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reputation_started_at is not null then
    raise exception using errcode = '42501', message = 'REPUTATION_WINDOW_SERVER_MANAGED';
  end if;

  if new.sent_at is not null and exists (
    select 1
    from public.expense_participants p
    where p.id = new.debtor_participant_id
      and p.user_id is not null
  ) then
    new.reputation_started_at := new.sent_at;
  end if;

  return new;
end;
$$;

create trigger claims_initialize_reputation_window
before insert on public.claims
for each row execute function private.initialize_claim_reputation_window();

create function private.clear_claim_payment_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.marked_paid_at is null then
    new.marked_paid_by_user_id := null;
    new.reputation_verified_at := null;
  end if;
  return new;
end;
$$;

create trigger claims_clear_payment_identity
before update of marked_paid_at on public.claims
for each row execute function private.clear_claim_payment_identity();

drop function public.mark_claim_paid_by_token(text, text, text);

create function public.mark_claim_paid_by_token(
  p_token_hash text,
  p_payment_method text,
  p_note text,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.claims%rowtype;
  v_owner uuid;
  v_debtor_user uuid;
  v_debtor_name text;
  v_currency text;
  v_verified_actor uuid;
  v_now timestamptz := now();
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_payment_method not in ('bizum', 'bank_transfer', 'cash', 'other')
    or char_length(coalesce(p_note, '')) > 500 then
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT_INPUT';
  end if;

  select * into v_claim
  from public.claims
  where public_token_hash = lower(p_token_hash)
  for update;
  if not found then return null; end if;
  if v_claim.status not in ('sent', 'viewed', 'marked_paid') then
    raise exception using errcode = '55000', message = 'CLAIM_STATE_NOT_ALLOWED';
  end if;

  select e.created_by, d.user_id, d.display_name, e.currency
    into v_owner, v_debtor_user, v_debtor_name, v_currency
  from public.expenses e
  join public.expense_participants d on d.id = v_claim.debtor_participant_id
  where e.id = v_claim.expense_id;

  if p_actor_user_id is not null and p_actor_user_id = v_debtor_user then
    v_verified_actor := p_actor_user_id;
  end if;

  if v_claim.status <> 'marked_paid' then
    update public.claims set
      status = 'marked_paid',
      marked_paid_at = v_now,
      payment_method = p_payment_method,
      debtor_note = nullif(trim(p_note), ''),
      marked_paid_by_user_id = v_verified_actor,
      reputation_verified_at = case
        when v_verified_actor is not null and v_claim.reputation_started_at is not null then v_now
        else null
      end
    where id = v_claim.id;

    insert into public.claim_events (
      claim_id, actor_type, actor_user_id, event_type, metadata
    ) values (
      v_claim.id,
      'debtor',
      v_verified_actor,
      'claim_marked_paid',
      jsonb_build_object(
        'paymentMethod', p_payment_method,
        'reputationVerified', v_verified_actor is not null
      )
    );
  elsif v_verified_actor is not null and v_claim.marked_paid_by_user_id is null then
    update public.claims set
      marked_paid_by_user_id = v_verified_actor,
      reputation_verified_at = case
        when v_claim.reputation_started_at is not null then v_now
        else null
      end
    where id = v_claim.id;

    insert into public.claim_events (
      claim_id, actor_type, actor_user_id, event_type, metadata
    ) values (
      v_claim.id,
      'debtor',
      v_verified_actor,
      'payment_identity_verified',
      jsonb_build_object('reputationVerified', true)
    );
  end if;

  return jsonb_build_object(
    'claimId', v_claim.id,
    'expenseId', v_claim.expense_id,
    'status', 'marked_paid',
    'markedPaidAt', coalesce(v_claim.marked_paid_at, v_now),
    'reputationVerified', v_verified_actor is not null,
    'ownerUserId', v_owner,
    'debtorDisplayName', v_debtor_name,
    'amountCents', v_claim.amount_cents,
    'currency', v_currency
  );
end;
$$;

create or replace function public.prepare_claim_reminder(p_claim_id uuid, p_new_token_hash text)
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
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if p_new_token_hash is null or p_new_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_TOKEN_HASH';
  end if;

  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'CLAIM_NOT_FOUND'; end if;

  select e.created_by, e.title, e.currency, d.display_name, d.user_id
    into v_owner, v_title, v_currency, v_debtor_name, v_debtor_user
  from public.expenses e
  join public.expense_participants d on d.id = v_claim.debtor_participant_id
  where e.id = v_claim.expense_id;

  if v_owner is distinct from v_actor then
    raise exception using errcode = '42501', message = 'NOT_EXPENSE_OWNER';
  end if;
  if v_claim.status not in ('sent', 'viewed') then
    raise exception using errcode = '55000', message = 'REMINDER_NOT_ALLOWED';
  end if;
  if coalesce(v_claim.last_reminded_at, v_claim.sent_at) > now() - interval '24 hours' then
    raise exception using errcode = '55000', message = 'REMINDER_TOO_SOON';
  end if;

  update public.claims set
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

create function private.get_reputation_card(p_user_id uuid)
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
  if p_user_id is null or not exists (select 1 from public.profiles p where p.id = p_user_id) then
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
      c.confirmed_at,
      c.reputation_started_at as started_at,
      c.reputation_verified_at as paid_at,
      extract(epoch from (c.reputation_verified_at - c.reputation_started_at)) / 3600.0 as payment_hours,
      c.reputation_verified_at <= c.reputation_started_at + interval '24 hours' as within_24,
      (
        select count(*)::integer
        from public.claim_events ce
        where ce.claim_id = c.id
          and ce.event_type = 'reminder_sent'
          and ce.created_at >= c.reputation_started_at + interval '24 hours'
          and ce.created_at <= c.reputation_verified_at
      ) as qualified_reminders
    from public.claims c
    join public.expense_participants debtor on debtor.id = c.debtor_participant_id
    where debtor.user_id = p_user_id
      and c.status = 'confirmed'
      and c.confirmed_at is not null
      and c.reputation_started_at is not null
      and c.reputation_verified_at is not null
      and c.marked_paid_by_user_id = p_user_id
      and not exists (
        select 1 from public.claim_disputes d where d.claim_id = c.id
      )
  )
  select
    count(*)::integer,
    count(*) filter (where within_24)::integer,
    case when count(*) = 0 then null
      else round(100.0 * count(*) filter (where within_24) / count(*))::integer end,
    round((percentile_cont(0.5) within group (order by payment_hours))::numeric, 1),
    round(avg(qualified_reminders)::numeric, 1)
  into v_completed, v_within_24, v_within_24_rate, v_median_hours, v_average_reminders
  from completed;

  select exists (
    select 1
    from public.claims c
    join public.expense_participants debtor on debtor.id = c.debtor_participant_id
    where debtor.user_id = p_user_id
      and c.reputation_started_at is not null
      and c.reputation_started_at <= now() - interval '24 hours'
      and c.status in ('sent', 'viewed', 'marked_paid')
      and c.reputation_verified_at is null
  ) into v_has_overdue;

  if v_completed >= 3 then
    with completed as (
      select
        c.confirmed_at,
        extract(epoch from (c.reputation_verified_at - c.reputation_started_at)) / 3600.0 as payment_hours,
        (
          select count(*)::integer
          from public.claim_events ce
          where ce.claim_id = c.id
            and ce.event_type = 'reminder_sent'
            and ce.created_at >= c.reputation_started_at + interval '24 hours'
            and ce.created_at <= c.reputation_verified_at
        ) as qualified_reminders
      from public.claims c
      join public.expense_participants debtor on debtor.id = c.debtor_participant_id
      where debtor.user_id = p_user_id
        and c.status = 'confirmed'
        and c.confirmed_at is not null
        and c.reputation_started_at is not null
        and c.reputation_verified_at is not null
        and c.marked_paid_by_user_id = p_user_id
        and not exists (select 1 from public.claim_disputes d where d.claim_id = c.id)
      order by c.confirmed_at desc
      limit 20
    ), scored as (
      select 100.0 * (
        0.75 * exp(-greatest(payment_hours - 24.0, 0.0) / 72.0)
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
      c.reputation_verified_at as paid_at,
      c.reputation_verified_at <= c.reputation_started_at + interval '24 hours' as within_24
    from public.claims c
    join public.expense_participants debtor on debtor.id = c.debtor_participant_id
    where debtor.user_id = p_user_id
      and c.status = 'confirmed'
      and c.reputation_started_at is not null
      and c.reputation_verified_at is not null
      and c.marked_paid_by_user_id = p_user_id
      and not exists (select 1 from public.claim_disputes d where d.claim_id = c.id)
  ), newest_first as (
    select
      within_24,
      bool_and(within_24) over (
        order by paid_at desc, id desc
        rows between unbounded preceding and current row
      ) as all_within_24_so_far
    from completed
  ), grouped as (
    select
      within_24,
      sum(case when within_24 then 0 else 1 end) over (order by paid_at, id) as streak_group
    from completed
  ), longest as (
    select count(*)::integer as streak_length
    from grouped
    where within_24
    group by streak_group
  )
  select
    coalesce((select count(*)::integer from newest_first where all_within_24_so_far), 0),
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
    'medianPaymentHours', case when p_user_id = v_actor then v_median_hours else null end,
    'averageReminders', case when p_user_id = v_actor then v_average_reminders else null end,
    'isOwn', p_user_id = v_actor
  );
end;
$$;

create function public.get_reputation_card(p_user_id uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_reputation_card(coalesce(p_user_id, (select auth.uid())));
$$;

create function public.get_reputation_cards(p_user_ids uuid[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_count integer;
  v_cards jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select count(*)::integer into v_count
  from (
    select distinct u.value
    from unnest(coalesce(p_user_ids, array[]::uuid[])) as u(value)
  ) requested;
  if v_count > 100 then
    raise exception using errcode = '22023', message = 'TOO_MANY_REPUTATION_CARDS';
  end if;

  select coalesce(jsonb_object_agg(requested.value::text, private.get_reputation_card(requested.value)), '{}'::jsonb)
    into v_cards
  from (
    select distinct u.value
    from unnest(coalesce(p_user_ids, array[]::uuid[])) as u(value)
  ) requested;
  return v_cards;
end;
$$;

revoke all on function private.group_avatar_object_visible(text),
  private.group_avatar_object_owned(text),
  private.initialize_claim_reputation_window(),
  private.clear_claim_payment_identity(),
  private.get_reputation_card(uuid)
from public, anon, authenticated;

grant execute on function private.group_avatar_object_visible(text),
  private.group_avatar_object_owned(text),
  private.get_reputation_card(uuid)
to authenticated;

revoke all on function public.mark_claim_paid_by_token(text, text, text, uuid),
  public.get_reputation_card(uuid),
  public.get_reputation_cards(uuid[])
from public, anon, authenticated;

grant execute on function public.mark_claim_paid_by_token(text, text, text, uuid)
to service_role;

grant execute on function public.get_reputation_card(uuid)
to authenticated;

grant execute on function public.get_reputation_cards(uuid[])
to authenticated;
