-- Temporary, owner-controlled collaboration sessions for assigning receipt items.
-- The raw public token is generated in the Edge Function and never persisted.

create table public.expense_collaboration_sessions (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null unique references public.expenses (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'active'
    check (status in ('active', 'applied', 'revoked')),
  expires_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'active' and closed_at is null)
    or (status <> 'active' and closed_at is not null)
  )
);

create table public.expense_collaboration_guests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.expense_collaboration_sessions (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  status text not null default 'submitted'
    check (status in ('submitted', 'applied', 'dismissed')),
  participant_id uuid references public.expense_participants (id) on delete set null,
  submitted_at timestamptz not null default now(),
  applied_at timestamptz
);

create table public.expense_collaboration_selections (
  guest_id uuid not null references public.expense_collaboration_guests (id) on delete cascade,
  item_id uuid not null references public.expense_items (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (guest_id, item_id)
);

create index expense_collaboration_sessions_owner_status_idx
  on public.expense_collaboration_sessions (created_by, status, updated_at desc);
create index expense_collaboration_sessions_active_expiry_idx
  on public.expense_collaboration_sessions (expires_at)
  where status = 'active';
create index expense_collaboration_guests_session_status_idx
  on public.expense_collaboration_guests (session_id, status, submitted_at);
create index expense_collaboration_selections_item_idx
  on public.expense_collaboration_selections (item_id, guest_id);

create trigger expense_collaboration_sessions_set_updated_at
before update on public.expense_collaboration_sessions
for each row execute function private.set_updated_at();

create or replace function private.validate_expense_collaboration_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_expense_id uuid;
begin
  if tg_table_name = 'expense_collaboration_guests' then
    if new.participant_id is null then
      return new;
    end if;
    select session.expense_id
      into v_session_expense_id
    from public.expense_collaboration_sessions session
    where session.id = new.session_id;
    if not exists (
      select 1
      from public.expense_participants participant
      where participant.id = new.participant_id
        and participant.expense_id = v_session_expense_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'COLLABORATION_PARTICIPANT_MISMATCH';
    end if;
    return new;
  end if;

  select session.expense_id
    into v_session_expense_id
  from public.expense_collaboration_guests guest
  join public.expense_collaboration_sessions session
    on session.id = guest.session_id
  where guest.id = new.guest_id;
  if not exists (
    select 1
    from public.expense_items item
    where item.id = new.item_id
      and item.expense_id = v_session_expense_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'COLLABORATION_ITEM_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger expense_collaboration_guests_validate_participant
before insert or update of session_id, participant_id
on public.expense_collaboration_guests
for each row execute function private.validate_expense_collaboration_relationship();

create trigger expense_collaboration_selections_validate_item
before insert or update of guest_id, item_id
on public.expense_collaboration_selections
for each row execute function private.validate_expense_collaboration_relationship();

alter table public.expense_collaboration_sessions enable row level security;
alter table public.expense_collaboration_guests enable row level security;
alter table public.expense_collaboration_selections enable row level security;

-- Data API exposure is explicit and independent from RLS.
revoke all on public.expense_collaboration_sessions from public, anon, authenticated;
revoke all on public.expense_collaboration_guests from public, anon, authenticated;
revoke all on public.expense_collaboration_selections from public, anon, authenticated;
grant select on public.expense_collaboration_sessions to authenticated;
grant select on public.expense_collaboration_guests to authenticated;
grant select on public.expense_collaboration_selections to authenticated;
grant select, insert, update, delete on public.expense_collaboration_sessions to service_role;
grant select, insert, update, delete on public.expense_collaboration_guests to service_role;
grant select, insert, update, delete on public.expense_collaboration_selections to service_role;

create policy collaboration_sessions_select_owner
on public.expense_collaboration_sessions
for select
to authenticated
using ((select auth.uid()) = created_by);

create policy collaboration_guests_select_owner
on public.expense_collaboration_guests
for select
to authenticated
using (
  exists (
    select 1
    from public.expense_collaboration_sessions session
    where session.id = expense_collaboration_guests.session_id
      and session.created_by = (select auth.uid())
  )
);

create policy collaboration_selections_select_owner
on public.expense_collaboration_selections
for select
to authenticated
using (
  exists (
    select 1
    from public.expense_collaboration_guests guest
    join public.expense_collaboration_sessions session on session.id = guest.session_id
    where guest.id = expense_collaboration_selections.guest_id
      and session.created_by = (select auth.uid())
  )
);

create or replace function public.start_expense_collaboration_session(
  p_expense_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_session_id uuid;
  v_existing_status text;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_COLLABORATION_TOKEN';
  end if;
  if p_expires_at <= now() + interval '5 minutes'
     or p_expires_at > now() + interval '7 days' then
    raise exception 'INVALID_COLLABORATION_EXPIRY';
  end if;
  -- Serialize start/regenerate calls on the expense before checking the
  -- one-session-per-expense key. This avoids a SELECT-then-INSERT race.
  perform 1
  from public.expenses expense
  where expense.id = p_expense_id
    and expense.created_by = v_user_id
    and expense.status = 'draft'
  for update;
  if not found then
    raise exception 'COLLABORATION_EXPENSE_NOT_EDITABLE';
  end if;

  select session.id, session.status
  into v_session_id, v_existing_status
  from public.expense_collaboration_sessions session
  where session.expense_id = p_expense_id
  for update;

  if v_session_id is null then
    insert into public.expense_collaboration_sessions (
      expense_id,
      created_by,
      token_hash,
      status,
      expires_at
    )
    values (p_expense_id, v_user_id, p_token_hash, 'active', p_expires_at)
    returning id into v_session_id;
  else
    if v_existing_status <> 'active' then
      delete from public.expense_collaboration_guests
      where session_id = v_session_id;
    end if;
    update public.expense_collaboration_sessions
    set token_hash = p_token_hash,
        status = 'active',
        expires_at = p_expires_at,
        closed_at = null
    where id = v_session_id;
  end if;

  return v_session_id;
end;
$$;

create or replace function public.get_expense_collaboration_owner_payload(
  p_expense_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_session public.expense_collaboration_sessions%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not exists (
    select 1
    from public.expenses expense
    where expense.id = p_expense_id
      and expense.created_by = v_user_id
  ) then
    raise exception 'NOT_EXPENSE_OWNER';
  end if;

  select session.*
  into v_session
  from public.expense_collaboration_sessions session
  where session.expense_id = p_expense_id;

  if not found then
    return jsonb_build_object('session', null, 'guests', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'session',
    jsonb_build_object(
      'id', v_session.id,
      'expenseId', v_session.expense_id,
      'status', v_session.status,
      'expiresAt', v_session.expires_at,
      'expired', v_session.expires_at <= now(),
      'createdAt', v_session.created_at
    ),
    'guests',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', guest.id,
            'displayName', guest.display_name,
            'status', guest.status,
            'submittedAt', guest.submitted_at,
            'items',
            coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'id', item.id,
                    'name', item.name,
                    'lineTotalCents', item.line_total_cents
                  )
                  order by item.sort_order, item.id
                )
                from public.expense_collaboration_selections selection
                join public.expense_items item on item.id = selection.item_id
                where selection.guest_id = guest.id
              ),
              '[]'::jsonb
            )
          )
          order by guest.submitted_at, guest.id
        )
        from public.expense_collaboration_guests guest
        where guest.session_id = v_session.id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.get_public_expense_collaboration_payload(
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select
    session.id,
    session.expires_at,
    expense.id as expense_id,
    expense.title,
    expense.merchant_name,
    expense.currency,
    expense.total_cents
  into v_session
  from public.expense_collaboration_sessions session
  join public.expenses expense on expense.id = session.expense_id
  where session.token_hash = p_token_hash
    and session.status = 'active'
    and session.expires_at > now()
    and expense.status = 'draft';

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'expenseId', v_session.expense_id,
    'title', v_session.title,
    'merchantName', v_session.merchant_name,
    'currency', v_session.currency,
    'totalCents', v_session.total_cents,
    'expiresAt', v_session.expires_at,
    'items',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', item.id,
            'name', item.name,
            'quantity', item.quantity,
            'lineTotalCents', item.line_total_cents
          )
          order by item.sort_order, item.id
        )
        from public.expense_items item
        where item.expense_id = v_session.expense_id
          and item.line_total_cents > 0
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.submit_expense_collaboration_selection(
  p_token_hash text,
  p_display_name text,
  p_item_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
  v_guest_id uuid;
  v_name text := btrim(coalesce(p_display_name, ''));
  v_requested_count integer := coalesce(cardinality(p_item_ids), 0);
  v_valid_count integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'COLLABORATION_NOT_FOUND';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'INVALID_COLLABORATION_NAME';
  end if;
  if v_requested_count < 1 or v_requested_count > 100 then
    raise exception 'INVALID_COLLABORATION_SELECTION';
  end if;
  if (
    select count(distinct item_id)
    from unnest(p_item_ids) as requested(item_id)
  ) <> v_requested_count then
    raise exception 'DUPLICATE_COLLABORATION_ITEM';
  end if;

  select session.id, session.expense_id
  into v_session
  from public.expense_collaboration_sessions session
  join public.expenses expense on expense.id = session.expense_id
  where session.token_hash = p_token_hash
    and session.status = 'active'
    and session.expires_at > now()
    and expense.status = 'draft'
  for update of session;

  if not found then
    raise exception 'COLLABORATION_NOT_FOUND';
  end if;

  -- The session row lock serializes submissions across Edge workers, so this
  -- remains a hard database cap in addition to the per-IP HTTP rate limit.
  if (
    select count(*)
    from public.expense_collaboration_guests guest
    where guest.session_id = v_session.id
  ) >= 100 then
    raise exception 'COLLABORATION_GUEST_LIMIT';
  end if;

  select count(*)
  into v_valid_count
  from public.expense_items item
  where item.expense_id = v_session.expense_id
    and item.line_total_cents > 0
    and item.id = any(p_item_ids);

  if v_valid_count <> v_requested_count then
    raise exception 'INVALID_COLLABORATION_SELECTION';
  end if;

  insert into public.expense_collaboration_guests (session_id, display_name)
  values (v_session.id, v_name)
  returning id into v_guest_id;

  insert into public.expense_collaboration_selections (guest_id, item_id)
  select v_guest_id, requested.item_id
  from unnest(p_item_ids) as requested(item_id);

  return jsonb_build_object(
    'guestId', v_guest_id,
    'selectedCount', v_requested_count
  );
end;
$$;

create or replace function public.revoke_expense_collaboration_session(
  p_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.expense_collaboration_sessions session
  set status = 'revoked',
      closed_at = now()
  where session.id = p_session_id
    and session.created_by = (select auth.uid())
    and session.status = 'active';

  if not found then
    raise exception 'COLLABORATION_NOT_EDITABLE';
  end if;
end;
$$;

create or replace function public.apply_expense_collaboration_session(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
  v_guest record;
  v_item record;
  v_participant_id uuid;
  v_next_sort_order integer;
  v_participant_count integer := 0;
  v_item_count integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select session.id, session.expense_id
  into v_session
  from public.expense_collaboration_sessions session
  join public.expenses expense on expense.id = session.expense_id
  where session.id = p_session_id
    and session.created_by = (select auth.uid())
    and session.status = 'active'
    and session.expires_at > now()
    and expense.status = 'draft'
  for update of session, expense;

  if not found then
    raise exception 'COLLABORATION_NOT_EDITABLE';
  end if;

  if not exists (
    select 1
    from public.expense_collaboration_guests guest
    where guest.session_id = v_session.id
      and guest.status = 'submitted'
  ) then
    raise exception 'COLLABORATION_EMPTY';
  end if;

  -- Submissions are already serialized by the session lock. Lock the concrete
  -- guest and item rows in a deterministic order as well so owner edits cannot
  -- interleave with allocation replacement.
  perform guest.id
  from public.expense_collaboration_guests guest
  where guest.session_id = v_session.id
    and guest.status = 'submitted'
  order by guest.id
  for update;

  perform item.id
  from public.expense_items item
  join public.expense_collaboration_selections selection
    on selection.item_id = item.id
  join public.expense_collaboration_guests guest
    on guest.id = selection.guest_id
  where guest.session_id = v_session.id
    and guest.status = 'submitted'
    and item.expense_id = v_session.expense_id
  order by item.id
  for update of item;

  select coalesce(max(participant.sort_order), -1) + 1
  into v_next_sort_order
  from public.expense_participants participant
  where participant.expense_id = v_session.expense_id;

  for v_guest in
    select guest.id, guest.display_name
    from public.expense_collaboration_guests guest
    where guest.session_id = v_session.id
      and guest.status = 'submitted'
    order by guest.submitted_at, guest.id
  loop
    insert into public.expense_participants (
      expense_id,
      display_name,
      is_payer,
      sort_order
    )
    values (
      v_session.expense_id,
      v_guest.display_name,
      false,
      v_next_sort_order + v_participant_count
    )
    returning id into v_participant_id;

    update public.expense_collaboration_guests
    set status = 'applied',
        participant_id = v_participant_id,
        applied_at = now()
    where id = v_guest.id;

    v_participant_count := v_participant_count + 1;
  end loop;

  for v_item in
    select distinct item.id, item.line_total_cents
    from public.expense_items item
    join public.expense_collaboration_selections selection on selection.item_id = item.id
    join public.expense_collaboration_guests guest on guest.id = selection.guest_id
    where guest.session_id = v_session.id
      and guest.status = 'applied'
      and item.expense_id = v_session.expense_id
      and item.line_total_cents > 0
  loop
    delete from public.item_allocations allocation
    where allocation.item_id = v_item.id;

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
      v_item.id,
      divided.participant_id,
      'equal'::public.allocation_method,
      null,
      null,
      null,
      divided.base_amount
        + case when divided.ordinal <= divided.remainder then 1 else 0 end
    from (
      select
        guest.participant_id,
        row_number() over (order by guest.submitted_at, guest.id) as ordinal,
        count(*) over () as participant_count,
        v_item.line_total_cents / count(*) over () as base_amount,
        v_item.line_total_cents % count(*) over () as remainder
      from public.expense_collaboration_selections selection
      join public.expense_collaboration_guests guest on guest.id = selection.guest_id
      where selection.item_id = v_item.id
        and guest.session_id = v_session.id
        and guest.status = 'applied'
    ) divided
    where divided.base_amount
        + case when divided.ordinal <= divided.remainder then 1 else 0 end <> 0;

    v_item_count := v_item_count + 1;
  end loop;

  update public.expense_collaboration_sessions
  set status = 'applied',
      closed_at = now()
  where id = v_session.id;

  return jsonb_build_object(
    'expenseId', v_session.expense_id,
    'participantCount', v_participant_count,
    'itemCount', v_item_count
  );
end;
$$;

-- Keep the endpoint allow-list in the database in sync with the Edge layer.
-- This function remains service-role only below.
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
  if p_endpoint not in (
      'get-public-claim',
      'mark-claim-paid',
      'dispute-claim',
      'accept-invite',
      'get-expense-collaboration',
      'submit-expense-collaboration'
    )
    or p_key_hash !~ '^[0-9a-f]{64}$'
    or p_limit not between 1 and 1000
    or p_window_seconds not between 10 and 86400 then
    raise exception using errcode = '22023', message = 'INVALID_RATE_LIMIT_INPUT';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into private.endpoint_rate_limits (
    endpoint,
    key_hash,
    window_started_at,
    request_count
  )
  values (p_endpoint, p_key_hash, v_window, 1)
  on conflict (endpoint, key_hash, window_started_at)
  do update
  set request_count = private.endpoint_rate_limits.request_count + 1
  returning request_count into v_count;
  if random() < 0.01 then
    delete from private.endpoint_rate_limits
    where window_started_at < now() - interval '2 days';
  end if;
  return v_count <= p_limit;
end;
$$;

revoke all on function public.start_expense_collaboration_session(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.get_expense_collaboration_owner_payload(uuid)
  from public, anon, authenticated;
revoke all on function public.get_public_expense_collaboration_payload(text)
  from public, anon, authenticated;
revoke all on function public.submit_expense_collaboration_selection(text, text, uuid[])
  from public, anon, authenticated;
revoke all on function public.revoke_expense_collaboration_session(uuid)
  from public, anon, authenticated;
revoke all on function public.apply_expense_collaboration_session(uuid)
  from public, anon, authenticated;
revoke all on function public.consume_endpoint_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function private.validate_expense_collaboration_relationship()
  from public, anon, authenticated, service_role;

grant execute on function public.start_expense_collaboration_session(uuid, text, timestamptz)
  to authenticated;
grant execute on function public.get_expense_collaboration_owner_payload(uuid)
  to authenticated;
grant execute on function public.revoke_expense_collaboration_session(uuid)
  to authenticated;
grant execute on function public.apply_expense_collaboration_session(uuid)
  to authenticated;
grant execute on function public.get_public_expense_collaboration_payload(text)
  to service_role;
grant execute on function public.submit_expense_collaboration_selection(text, text, uuid[])
  to service_role;
grant execute on function public.consume_endpoint_rate_limit(text, text, integer, integer)
  to service_role;
