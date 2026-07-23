-- A streak belongs to a group round, not to an individual profile.
-- A round is a fully confirmed group expense whose eligible claims were all
-- marked as paid by their linked debtors within 24 hours and later confirmed.
-- Disputed and cancelled claims do not participate in the calculation.

create function public.get_group_streak(p_group_id uuid)
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
      c.confirmed_at,
      c.reputation_started_at,
      c.marked_paid_at,
      c.marked_paid_by_user_id,
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
  ),
  expense_outcomes as (
    select
      expense_id,
      max(confirmed_at) filter (where status = 'confirmed') as completed_at,
      bool_and(status = 'confirmed') as is_complete,
      bool_and(
        status = 'confirmed'
        and reputation_started_at is not null
        and marked_paid_at is not null
        and debtor_user_id is not null
        and marked_paid_by_user_id = debtor_user_id
        and marked_paid_at <= reputation_started_at + interval '24 hours'
      ) as succeeded
    from eligible_claims
    group by expense_id
  ),
  completed as (
    select expense_id, completed_at, succeeded
    from expense_outcomes
    where is_complete and completed_at is not null
  ),
  newest_first as (
    select
      succeeded,
      bool_and(succeeded) over (
        order by completed_at desc, expense_id desc
        rows between unbounded preceding and current row
      ) as all_successful_so_far
    from completed
  ),
  grouped as (
    select
      succeeded,
      sum(case when succeeded then 0 else 1 end) over (
        order by completed_at, expense_id
      ) as streak_group
    from completed
  ),
  longest as (
    select count(*)::integer as streak_length
    from grouped
    where succeeded
    group by streak_group
  )
  select
    (select count(*)::integer from newest_first where all_successful_so_far),
    coalesce((select max(streak_length) from longest), 0),
    (select count(*)::integer from completed),
    (select count(*)::integer from completed where succeeded)
  into v_current, v_longest, v_completed, v_successful;

  select
    exists (
      select 1
      from public.expenses e
      join public.claims c on c.expense_id = e.id
      join public.expense_participants debtor on debtor.id = c.debtor_participant_id
      where e.group_id = p_group_id
        and e.archived_at is null
        and e.status <> 'cancelled'
        and c.status in ('sent', 'viewed', 'marked_paid')
        and c.reputation_started_at is not null
        and c.reputation_started_at <= now() - interval '24 hours'
        and (
          c.marked_paid_at is null
          or debtor.user_id is null
          or c.marked_paid_by_user_id is distinct from debtor.user_id
          or c.marked_paid_at > c.reputation_started_at + interval '24 hours'
        )
        and not exists (
          select 1
          from public.claim_disputes dispute
          where dispute.claim_id = c.id
        )
    ),
    count(*) filter (
      where c.status in ('sent', 'viewed', 'marked_paid')
    )::integer,
    min(c.reputation_started_at + interval '24 hours') filter (
      where c.status in ('sent', 'viewed', 'marked_paid')
        and c.reputation_started_at is not null
        and c.reputation_started_at > now() - interval '24 hours'
        and (
          c.marked_paid_at is null
          or c.marked_paid_by_user_id is distinct from debtor.user_id
        )
    )
  into v_has_overdue, v_active_claims, v_next_deadline
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
    );

  if v_has_overdue then
    v_current := 0;
  end if;

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
    'hasOverdue', coalesce(v_has_overdue, false),
    'activeClaims', coalesce(v_active_claims, 0),
    'nextDeadline', v_next_deadline
  );
end;
$$;

revoke all on function public.get_group_streak(uuid)
from public, anon, authenticated;

grant execute on function public.get_group_streak(uuid)
to authenticated;

-- Postgres Changes only emits events for tables included in the publication.
-- Keep this idempotent so linked environments can safely replay the migration.
do $$
declare
  v_table text;
begin
  if not exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) then
    raise exception 'SUPABASE_REALTIME_PUBLICATION_NOT_FOUND';
  end if;

  foreach v_table in array array['expenses', 'claims', 'claim_events']
  loop
    if not exists (
      select 1
      from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        v_table
      );
    end if;
  end loop;
end;
$$;
