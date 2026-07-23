-- Pagaste MVP database. This migration intentionally contains the complete initial
-- schema because it has not been applied to any environment yet.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.expense_status as enum ('draft', 'sent', 'settled', 'cancelled');
create type public.scan_status as enum ('idle', 'processing', 'completed', 'failed');
create type public.claim_status as enum (
  'draft', 'sent', 'viewed', 'marked_paid', 'confirmed', 'disputed', 'cancelled'
);
create type public.allocation_method as enum ('equal', 'shares', 'percentage', 'units', 'custom');
create type public.claim_actor_type as enum ('owner', 'debtor', 'system');
create type public.dispute_status as enum ('open', 'resolved', 'dismissed');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 80),
  avatar_path text check (avatar_path is null or char_length(avatar_path) <= 500),
  email text check (email is null or char_length(email) <= 254),
  default_currency varchar(3) not null default 'EUR' check (default_currency ~ '^[A-Z]{3}$'),
  locale text not null default 'es-ES' check (char_length(locale) between 2 and 35),
  timezone text not null default 'Europe/Madrid' check (char_length(timezone) between 1 and 100),
  notifications_enabled boolean not null default true,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 100),
  description text check (description is null or char_length(description) <= 500),
  type text not null default 'other' check (type in ('friends', 'couple', 'household', 'trip', 'work', 'family', 'other')),
  currency varchar(3) not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  avatar_path text check (avatar_path is null or char_length(avatar_path) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  avatar_path text check (avatar_path is null or char_length(avatar_path) <= 500),
  email text check (email is null or char_length(email) <= 254),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'guest')),
  status text not null default 'active' check (status in ('invited', 'active', 'left', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  payer_member_id uuid references public.group_members (id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  merchant_name text check (merchant_name is null or char_length(merchant_name) <= 120),
  occurred_at timestamptz not null default now(),
  currency varchar(3) not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  total_cents bigint not null default 0 check (total_cents between 0 and 9007199254740991),
  recoverable_cents bigint not null default 0 check (recoverable_cents between 0 and 9007199254740991),
  own_share_cents bigint not null default 0 check (own_share_cents between 0 and 9007199254740991),
  receipt_path text check (receipt_path is null or char_length(receipt_path) <= 700),
  receipt_visibility text not null default 'private' check (receipt_visibility = 'private'),
  status public.expense_status not null default 'draft',
  notes text check (notes is null or char_length(notes) <= 2000),
  scan_status public.scan_status not null default 'idle',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  archived_at timestamptz,
  check (recoverable_cents + own_share_cents = total_cents),
  check (
    (status = 'draft' and sent_at is null)
    or (status <> 'draft' and sent_at is not null)
  )
);

create table public.expense_participants (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  avatar_path text check (avatar_path is null or char_length(avatar_path) <= 500),
  email text check (email is null or char_length(email) <= 254),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  is_payer boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (expense_id, id)
);

alter table public.expenses
  add column payer_participant_id uuid,
  add constraint expenses_payer_participant_fk
    foreign key (id, payer_participant_id)
    references public.expense_participants (expense_id, id)
    on delete restrict;

create unique index expense_one_payer_idx
  on public.expense_participants (expense_id)
  where is_payer;

create table public.expense_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit_price_cents bigint check (unit_price_cents is null or unit_price_cents between -9007199254740991 and 9007199254740991),
  line_total_cents bigint not null check (line_total_cents between -9007199254740991 and 9007199254740991 and line_total_cents <> 0),
  category text check (category is null or char_length(category) <= 60),
  sort_order integer not null default 0 check (sort_order >= 0),
  ocr_confidence numeric(5, 4) check (ocr_confidence is null or ocr_confidence between 0 and 1),
  source text not null default 'manual' check (source in ('manual', 'ocr', 'adjustment')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.item_allocations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.expense_items (id) on delete cascade,
  participant_id uuid not null references public.expense_participants (id) on delete cascade,
  method public.allocation_method not null default 'equal',
  shares numeric(12, 4) check (shares is null or shares > 0),
  percentage numeric(7, 4) check (percentage is null or percentage > 0 and percentage <= 100),
  units numeric(12, 4) check (units is null or units > 0),
  amount_cents bigint not null check (amount_cents between -9007199254740991 and 9007199254740991 and amount_cents <> 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, participant_id),
  check (
    (method in ('equal', 'custom') and shares is null and percentage is null and units is null)
    or (method = 'shares' and shares is not null and percentage is null and units is null)
    or (method = 'percentage' and shares is null and percentage is not null and units is null)
    or (method = 'units' and shares is null and percentage is null and units is not null)
  )
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  debtor_participant_id uuid not null references public.expense_participants (id) on delete restrict,
  creditor_participant_id uuid not null references public.expense_participants (id) on delete restrict,
  amount_cents bigint not null check (amount_cents between 1 and 9007199254740991),
  status public.claim_status not null default 'draft',
  public_token_hash text unique check (public_token_hash is null or public_token_hash ~ '^[0-9a-f]{64}$'),
  token_version integer not null default 1 check (token_version > 0),
  sent_at timestamptz,
  viewed_at timestamptz,
  marked_paid_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  payment_method text check (payment_method is null or payment_method in ('bizum', 'bank_transfer', 'cash', 'other')),
  debtor_note text check (debtor_note is null or char_length(debtor_note) <= 500),
  last_reminded_at timestamptz,
  reminder_count integer not null default 0 check (reminder_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (expense_id, debtor_participant_id),
  check (debtor_participant_id <> creditor_participant_id),
  check (status = 'draft' or sent_at is not null),
  check (status <> 'viewed' or viewed_at is not null),
  check (status <> 'marked_paid' or marked_paid_at is not null),
  check (status <> 'confirmed' or confirmed_at is not null),
  check (status <> 'cancelled' or cancelled_at is not null),
  check (status in ('draft', 'confirmed', 'cancelled') or public_token_hash is not null)
);

create table public.claim_events (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  actor_type public.claim_actor_type not null,
  actor_user_id uuid references public.profiles (id) on delete set null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table public.claim_disputes (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  reason text not null check (reason in ('did_not_consume', 'incorrect_amount', 'already_paid', 'unknown_expense', 'other')),
  message text check (message is null or char_length(message) <= 1000),
  status public.dispute_status not null default 'open',
  resolved_by uuid references public.profiles (id) on delete set null,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (
    (status = 'open' and resolved_at is null)
    or (status <> 'open' and resolved_at is not null)
  )
);

create unique index claim_one_open_dispute_idx
  on public.claim_disputes (claim_id)
  where status = 'open';

create table public.receipt_scan_jobs (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  provider text not null check (char_length(provider) between 1 and 50),
  status text not null check (status in ('queued', 'processing', 'completed', 'failed')),
  confidence numeric(5, 4) check (confidence is null or confidence between 0 and 1),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,49}$'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (status in ('queued', 'processing') and completed_at is null)
    or (status in ('completed', 'failed') and completed_at is not null)
  )
);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  token text not null unique check (char_length(token) between 10 and 500),
  device_name text check (device_name is null or char_length(device_name) <= 100),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.push_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  push_token_id uuid references public.push_tokens (id) on delete set null,
  event_type text not null check (char_length(event_type) between 1 and 50),
  status text not null check (status in ('sent', 'failed', 'invalid_token')),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  created_at timestamptz not null default now()
);

create table public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  period_start date not null,
  ocr_scans_used integer not null default 0 check (ocr_scans_used >= 0),
  reminders_sent integer not null default 0 check (reminders_sent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, period_start)
);

create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  invited_email text check (invited_email is null or char_length(invited_email) <= 254),
  public_token_hash text unique check (public_token_hash is null or public_token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'accepted' and accepted_at is not null and accepted_by is not null) or status <> 'accepted')
);

create table private.endpoint_rate_limits (
  endpoint text not null,
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key (endpoint, key_hash, window_started_at)
);

create index groups_owner_idx on public.groups (owner_id, updated_at desc);
create index group_members_group_idx on public.group_members (group_id, status);
create index group_members_user_idx on public.group_members (user_id) where user_id is not null;
create unique index group_members_one_owner_idx on public.group_members (group_id) where role = 'owner';
create index expenses_creator_idx on public.expenses (created_by, occurred_at desc) where archived_at is null;
create index expenses_group_idx on public.expenses (group_id, occurred_at desc) where group_id is not null;
create index expenses_payer_member_idx on public.expenses (payer_member_id) where payer_member_id is not null;
create index expenses_payer_participant_idx on public.expenses (payer_participant_id) where payer_participant_id is not null;
create index participants_expense_idx on public.expense_participants (expense_id, sort_order);
create index participants_user_idx on public.expense_participants (user_id) where user_id is not null;
create index expense_items_expense_idx on public.expense_items (expense_id, sort_order);
create index allocations_participant_idx on public.item_allocations (participant_id);
create index claims_expense_status_idx on public.claims (expense_id, status);
create index claims_debtor_idx on public.claims (debtor_participant_id, created_at desc);
create index claims_creditor_idx on public.claims (creditor_participant_id, created_at desc);
create index claim_events_claim_idx on public.claim_events (claim_id, created_at desc);
create index claim_events_actor_idx on public.claim_events (actor_user_id) where actor_user_id is not null;
create index disputes_claim_idx on public.claim_disputes (claim_id, created_at desc);
create index disputes_resolver_idx on public.claim_disputes (resolved_by) where resolved_by is not null;
create index scan_jobs_expense_idx on public.receipt_scan_jobs (expense_id, created_at desc);
create index push_tokens_user_idx on public.push_tokens (user_id);
create index push_logs_user_idx on public.push_delivery_logs (user_id, created_at desc);
create index push_logs_token_idx on public.push_delivery_logs (push_token_id) where push_token_id is not null;
create index group_invites_group_idx on public.group_invites (group_id, status, created_at desc);
create index group_invites_creator_idx on public.group_invites (created_by, created_at desc);
create index group_invites_acceptor_idx on public.group_invites (accepted_by) where accepted_by is not null;
create index rate_limits_cleanup_idx on private.endpoint_rate_limits (window_started_at);

create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger groups_set_updated_at before update on public.groups
for each row execute function private.set_updated_at();
create trigger group_members_set_updated_at before update on public.group_members
for each row execute function private.set_updated_at();
create trigger expenses_set_updated_at before update on public.expenses
for each row execute function private.set_updated_at();
create trigger expense_items_set_updated_at before update on public.expense_items
for each row execute function private.set_updated_at();
create trigger allocations_set_updated_at before update on public.item_allocations
for each row execute function private.set_updated_at();
create trigger claims_set_updated_at before update on public.claims
for each row execute function private.set_updated_at();
create trigger usage_set_updated_at before update on public.usage_counters
for each row execute function private.set_updated_at();

create function private.guard_expense_post_send_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and old.status <> 'draft' then
    if new.id is distinct from old.id
      or new.group_id is distinct from old.group_id
      or new.created_by is distinct from old.created_by
      or new.payer_member_id is distinct from old.payer_member_id
      or new.payer_participant_id is distinct from old.payer_participant_id
      or new.merchant_name is distinct from old.merchant_name
      or new.occurred_at is distinct from old.occurred_at
      or new.currency is distinct from old.currency
      or new.total_cents is distinct from old.total_cents
      or new.recoverable_cents is distinct from old.recoverable_cents
      or new.own_share_cents is distinct from old.own_share_cents
      or new.receipt_path is distinct from old.receipt_path
      or new.receipt_visibility is distinct from old.receipt_visibility
      or new.status is distinct from old.status
      or new.notes is distinct from old.notes
      or new.scan_status is distinct from old.scan_status
      or new.created_at is distinct from old.created_at
      or new.sent_at is distinct from old.sent_at then
      raise exception using errcode = '55000', message = 'SENT_EXPENSE_AMOUNTS_IMMUTABLE';
    end if;
  end if;
  return new;
end;
$$;

create trigger expenses_guard_post_send_changes
before update on public.expenses
for each row execute function private.guard_expense_post_send_update();

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    update public.profiles set email = new.email where id = new.id;
    return new;
  end if;
  insert into public.profiles (id, display_name, email, locale, timezone)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, 'Usuario'), '@', 1)), 80),
    new.email,
    left(coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'es-ES'), 35),
    left(coalesce(nullif(new.raw_user_meta_data ->> 'timezone', ''), 'Europe/Madrid'), 100)
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert or update of email on auth.users
for each row execute function private.handle_new_user();

create function private.handle_new_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.group_members (
    group_id, user_id, display_name, avatar_path, email, role, status
  )
  select new.id, p.id, p.display_name, p.avatar_path, p.email, 'owner', 'active'
  from public.profiles p where p.id = new.owner_id
  on conflict (group_id, user_id) do update set
    display_name = excluded.display_name,
    avatar_path = excluded.avatar_path,
    email = excluded.email,
    role = 'owner',
    status = 'active';
  return new;
end;
$$;

create trigger on_group_created_add_owner
after insert on public.groups
for each row execute function private.handle_new_group();

create function private.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.groups g
    where g.id = p_group_id and g.owner_id = (select auth.uid())
  ) or exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = (select auth.uid())
      and gm.status = 'active'
  );
$$;

create function private.owns_expense(p_expense_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.expenses e
    where e.id = p_expense_id and e.created_by = (select auth.uid())
  );
$$;

create function private.expense_relationships_valid(p_group_id uuid, p_payer_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_group_id is null then p_payer_member_id is null
    when not private.is_group_member(p_group_id) then false
    when p_payer_member_id is null then true
    else exists (
      select 1 from public.group_members gm
      where gm.id = p_payer_member_id and gm.group_id = p_group_id and gm.status = 'active'
    )
  end;
$$;

create function private.owns_draft_expense(p_expense_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.expenses e
    where e.id = p_expense_id
      and e.created_by = (select auth.uid())
      and e.status = 'draft'
  );
$$;

create function private.can_read_expense(p_expense_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.expenses e
    where e.id = p_expense_id
      and (
        e.created_by = (select auth.uid())
        or (e.group_id is not null and private.is_group_member(e.group_id))
        or exists (
          select 1 from public.expense_participants ep
          where ep.expense_id = e.id and ep.user_id = (select auth.uid())
        )
      )
  );
$$;

create function private.can_read_claim(p_claim_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.claims c
    join public.expenses e on e.id = c.expense_id
    join public.expense_participants d on d.id = c.debtor_participant_id
    join public.expense_participants cr on cr.id = c.creditor_participant_id
    where c.id = p_claim_id
      and ((select auth.uid()) in (e.created_by, d.user_id, cr.user_id))
  );
$$;

create function private.receipt_object_owned(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    split_part(p_name, '/', 1) = (select auth.uid())::text
    and split_part(p_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.expenses e
      where e.id = case
        when split_part(p_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then split_part(p_name, '/', 2)::uuid
        else null
      end
        and e.created_by = (select auth.uid())
    );
$$;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_participants enable row level security;
alter table public.expense_items enable row level security;
alter table public.item_allocations enable row level security;
alter table public.claims enable row level security;
alter table public.claim_events enable row level security;
alter table public.claim_disputes enable row level security;
alter table public.receipt_scan_jobs enable row level security;
alter table public.push_tokens enable row level security;
alter table public.push_delivery_logs enable row level security;
alter table public.usage_counters enable row level security;
alter table public.group_invites enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated
using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy groups_select_members on public.groups for select to authenticated
using (private.is_group_member(id));
create policy groups_insert_owner on public.groups for insert to authenticated
with check ((select auth.uid()) = owner_id);
create policy groups_update_owner on public.groups for update to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy groups_delete_owner on public.groups for delete to authenticated
using ((select auth.uid()) = owner_id);

create policy group_members_select_owner_or_self on public.group_members for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (select 1 from public.groups g where g.id = group_id and g.owner_id = (select auth.uid()))
);
create policy group_members_insert_owner on public.group_members for insert to authenticated
with check (
  role <> 'owner'
  and exists (select 1 from public.groups g where g.id = group_id and g.owner_id = (select auth.uid()))
);
create policy group_members_update_owner on public.group_members for update to authenticated
using (
  role <> 'owner'
  and exists (select 1 from public.groups g where g.id = group_id and g.owner_id = (select auth.uid()))
)
with check (
  role <> 'owner'
  and exists (select 1 from public.groups g where g.id = group_id and g.owner_id = (select auth.uid()))
);
create policy group_members_delete_owner on public.group_members for delete to authenticated
using (
  role <> 'owner'
  and exists (select 1 from public.groups g where g.id = group_id and g.owner_id = (select auth.uid()))
);

create policy expenses_select_authorized on public.expenses for select to authenticated
using (private.can_read_expense(id));
create policy expenses_insert_owner on public.expenses for insert to authenticated
with check (
  (select auth.uid()) = created_by
  and private.expense_relationships_valid(group_id, payer_member_id)
);
create policy expenses_update_draft_owner on public.expenses for update to authenticated
using ((select auth.uid()) = created_by and status = 'draft')
with check (
  (select auth.uid()) = created_by
  and status = 'draft'
  and private.expense_relationships_valid(group_id, payer_member_id)
);
create policy expenses_update_sent_metadata_owner on public.expenses for update to authenticated
using ((select auth.uid()) = created_by and status in ('sent', 'settled', 'cancelled'))
with check ((select auth.uid()) = created_by and status in ('sent', 'settled', 'cancelled'));
create policy expenses_delete_draft_owner on public.expenses for delete to authenticated
using ((select auth.uid()) = created_by and status = 'draft');

create policy participants_select_authorized on public.expense_participants for select to authenticated
using (private.owns_expense(expense_id) or user_id = (select auth.uid()));
create policy participants_insert_draft_owner on public.expense_participants for insert to authenticated
with check (private.owns_draft_expense(expense_id));
create policy participants_update_draft_owner on public.expense_participants for update to authenticated
using (private.owns_draft_expense(expense_id)) with check (private.owns_draft_expense(expense_id));
create policy participants_delete_draft_owner on public.expense_participants for delete to authenticated
using (private.owns_draft_expense(expense_id));

create policy items_select_authorized on public.expense_items for select to authenticated
using (private.can_read_expense(expense_id));
create policy items_insert_draft_owner on public.expense_items for insert to authenticated
with check (private.owns_draft_expense(expense_id));
create policy items_update_draft_owner on public.expense_items for update to authenticated
using (private.owns_draft_expense(expense_id)) with check (private.owns_draft_expense(expense_id));
create policy items_delete_draft_owner on public.expense_items for delete to authenticated
using (private.owns_draft_expense(expense_id));

create policy allocations_select_authorized on public.item_allocations for select to authenticated
using (exists (
  select 1 from public.expense_items i where i.id = item_id and private.can_read_expense(i.expense_id)
));
create policy allocations_insert_draft_owner on public.item_allocations for insert to authenticated
with check (exists (
  select 1 from public.expense_items i
  join public.expense_participants p on p.id = participant_id and p.expense_id = i.expense_id
  where i.id = item_id and private.owns_draft_expense(i.expense_id)
));
create policy allocations_update_draft_owner on public.item_allocations for update to authenticated
using (exists (select 1 from public.expense_items i where i.id = item_id and private.owns_draft_expense(i.expense_id)))
with check (exists (
  select 1 from public.expense_items i
  join public.expense_participants p on p.id = participant_id and p.expense_id = i.expense_id
  where i.id = item_id and private.owns_draft_expense(i.expense_id)
));
create policy allocations_delete_draft_owner on public.item_allocations for delete to authenticated
using (exists (select 1 from public.expense_items i where i.id = item_id and private.owns_draft_expense(i.expense_id)));

create policy claims_select_authorized on public.claims for select to authenticated
using (private.can_read_claim(id));
create policy claim_events_select_authorized on public.claim_events for select to authenticated
using (private.can_read_claim(claim_id));
create policy disputes_select_authorized on public.claim_disputes for select to authenticated
using (private.can_read_claim(claim_id));
create policy scan_jobs_select_owner on public.receipt_scan_jobs for select to authenticated
using (private.owns_expense(expense_id));

create policy push_tokens_select_own on public.push_tokens for select to authenticated
using ((select auth.uid()) = user_id);
create policy push_tokens_insert_own on public.push_tokens for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy push_tokens_update_own on public.push_tokens for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy push_tokens_delete_own on public.push_tokens for delete to authenticated
using ((select auth.uid()) = user_id);
create policy push_logs_select_own on public.push_delivery_logs for select to authenticated
using ((select auth.uid()) = user_id);
create policy usage_select_own on public.usage_counters for select to authenticated
using ((select auth.uid()) = user_id);
create policy group_invites_select_owner on public.group_invites for select to authenticated
using (exists (select 1 from public.groups g where g.id = group_id and g.owner_id = (select auth.uid())));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy receipts_select_owner on storage.objects for select to authenticated
using (bucket_id = 'receipts' and private.receipt_object_owned(name));
create policy receipts_insert_owner on storage.objects for insert to authenticated
with check (bucket_id = 'receipts' and private.receipt_object_owned(name));
create policy receipts_update_owner on storage.objects for update to authenticated
using (bucket_id = 'receipts' and private.receipt_object_owned(name))
with check (bucket_id = 'receipts' and private.receipt_object_owned(name));
create policy receipts_delete_owner on storage.objects for delete to authenticated
using (bucket_id = 'receipts' and private.receipt_object_owned(name));

-- Critical operations below are single PostgreSQL transactions. Every SECURITY
-- DEFINER function has an empty search_path and an explicit, minimal EXECUTE grant.

create function public.create_claims_transaction(p_expense_id uuid, p_claims jsonb)
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
  if jsonb_typeof(p_claims) <> 'array' or jsonb_array_length(p_claims) = 0 or jsonb_array_length(p_claims) > 100 then
    raise exception using errcode = '22023', message = 'INVALID_CLAIMS';
  end if;

  select * into v_expense from public.expenses
  where id = p_expense_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'EXPENSE_NOT_FOUND'; end if;
  if v_expense.created_by is distinct from v_actor then raise exception using errcode = '42501', message = 'NOT_EXPENSE_OWNER'; end if;
  if v_expense.status <> 'draft' then raise exception using errcode = '55000', message = 'EXPENSE_NOT_DRAFT'; end if;
  if v_expense.total_cents <= 0 then raise exception using errcode = '23514', message = 'INVALID_TOTAL'; end if;

  select id into v_payer from public.expense_participants
  where expense_id = p_expense_id and is_payer;
  if v_payer is null then raise exception using errcode = '23514', message = 'PAYER_REQUIRED'; end if;

  select coalesce(sum(line_total_cents), 0) into v_item_total
  from public.expense_items where expense_id = p_expense_id;
  if v_item_total <> v_expense.total_cents then
    raise exception using errcode = '23514', message = 'ITEM_TOTAL_MISMATCH';
  end if;
  if exists (
    select 1 from public.expense_items i
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
    where i.expense_id = p_expense_id and p.expense_id <> p_expense_id
  ) then
    raise exception using errcode = '23514', message = 'ALLOCATION_PARTICIPANT_MISMATCH';
  end if;

  with supplied as (
    select (x."debtorParticipantId")::uuid debtor_id, x."amountCents" amount_cents, lower(x."tokenHash") token_hash
    from jsonb_to_recordset(p_claims) as x("debtorParticipantId" text, "amountCents" bigint, "tokenHash" text)
  ), calculated as (
    select a.participant_id debtor_id, sum(a.amount_cents)::bigint amount_cents
    from public.item_allocations a
    join public.expense_items i on i.id = a.item_id
    where i.expense_id = p_expense_id and a.participant_id <> v_payer
    group by a.participant_id having sum(a.amount_cents) > 0
  )
  select coalesce((select sum(a.amount_cents) from public.item_allocations a
    join public.expense_items i on i.id = a.item_id
    where i.expense_id = p_expense_id and a.participant_id = v_payer), 0),
    coalesce((select sum(amount_cents) from calculated), 0)
  into v_own_share, v_recoverable;

  if v_own_share + v_recoverable <> v_expense.total_cents then
    raise exception using errcode = '23514', message = 'DEBT_TOTAL_MISMATCH';
  end if;

  if exists (
    with supplied as (
      select (x."debtorParticipantId")::uuid debtor_id, x."amountCents" amount_cents, lower(x."tokenHash") token_hash
      from jsonb_to_recordset(p_claims) as x("debtorParticipantId" text, "amountCents" bigint, "tokenHash" text)
    ), calculated as (
      select a.participant_id debtor_id, sum(a.amount_cents)::bigint amount_cents
      from public.item_allocations a join public.expense_items i on i.id = a.item_id
      where i.expense_id = p_expense_id and a.participant_id <> v_payer
      group by a.participant_id having sum(a.amount_cents) > 0
    )
    select 1 from calculated c full join supplied s using (debtor_id)
    where c.debtor_id is null or s.debtor_id is null or c.amount_cents <> s.amount_cents
       or s.amount_cents is null or s.amount_cents <= 0
       or s.token_hash is null or s.token_hash !~ '^[0-9a-f]{64}$'
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
    select (x."debtorParticipantId")::uuid debtor_id, x."amountCents" amount_cents, lower(x."tokenHash") token_hash
    from jsonb_to_recordset(p_claims) as x("debtorParticipantId" text, "amountCents" bigint, "tokenHash" text)
  ), inserted as (
    insert into public.claims (
      expense_id, debtor_participant_id, creditor_participant_id, amount_cents,
      status, public_token_hash, sent_at
    )
    select p_expense_id, s.debtor_id, v_payer, s.amount_cents, 'sent', s.token_hash, now()
    from supplied s
    returning id, claims.debtor_participant_id, claims.amount_cents
  ), events as (
    insert into public.claim_events (claim_id, actor_type, actor_user_id, event_type)
    select i.id, 'owner', v_actor, 'claim_sent' from inserted i
  )
  select i.id, i.debtor_participant_id, i.amount_cents from inserted i;
end;
$$;

create function public.consume_endpoint_rate_limit(
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
  if p_endpoint not in ('get-public-claim', 'mark-claim-paid', 'dispute-claim', 'accept-invite')
    or p_key_hash !~ '^[0-9a-f]{64}$'
    or p_limit not between 1 and 1000
    or p_window_seconds not between 10 and 86400 then
    raise exception using errcode = '22023', message = 'INVALID_RATE_LIMIT_INPUT';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into private.endpoint_rate_limits (endpoint, key_hash, window_started_at, request_count)
  values (p_endpoint, p_key_hash, v_window, 1)
  on conflict (endpoint, key_hash, window_started_at)
  do update set request_count = private.endpoint_rate_limits.request_count + 1
  returning request_count into v_count;
  if random() < 0.01 then
    delete from private.endpoint_rate_limits where window_started_at < now() - interval '2 days';
  end if;
  return v_count <= p_limit;
end;
$$;

create function public.get_public_claim_payload(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.claims%rowtype;
  v_payload jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into v_claim from public.claims
  where public_token_hash = lower(p_token_hash) and status <> 'cancelled'
  for update;
  if not found then return null; end if;

  if v_claim.viewed_at is null then
    update public.claims set
      viewed_at = now(),
      status = case when status = 'sent' then 'viewed'::public.claim_status else status end
    where id = v_claim.id;
    insert into public.claim_events (claim_id, actor_type, event_type)
    values (v_claim.id, 'debtor', 'claim_viewed');
  end if;

  select jsonb_build_object(
    'payerDisplayName', creditor.display_name,
    'payerAvatarUrl', null,
    'expenseTitle', e.title,
    'merchantName', e.merchant_name,
    'occurredAt', e.occurred_at,
    'currency', e.currency,
    'amountCents', c.amount_cents,
    'status', case when c.status = 'sent' then 'viewed' else c.status::text end,
    'paymentConcept', left(e.title || ' - Pagaste', 140),
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
      where a.participant_id = c.debtor_participant_id and a.amount_cents <> 0
    ), '[]'::jsonb),
    'canMarkPaid', c.status in ('sent', 'viewed'),
    'canDispute', c.status in ('sent', 'viewed', 'marked_paid')
  ) into v_payload
  from public.claims c
  join public.expenses e on e.id = c.expense_id
  join public.expense_participants creditor on creditor.id = c.creditor_participant_id
  where c.id = v_claim.id;
  return v_payload;
end;
$$;

create function public.mark_claim_paid_by_token(
  p_token_hash text,
  p_payment_method text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.claims%rowtype;
  v_owner uuid;
  v_debtor_name text;
  v_currency text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_payment_method not in ('bizum', 'bank_transfer', 'cash', 'other')
    or char_length(coalesce(p_note, '')) > 500 then
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT_INPUT';
  end if;
  select * into v_claim from public.claims where public_token_hash = lower(p_token_hash) for update;
  if not found then return null; end if;
  if v_claim.status not in ('sent', 'viewed', 'marked_paid') then
    raise exception using errcode = '55000', message = 'CLAIM_STATE_NOT_ALLOWED';
  end if;
  if v_claim.status <> 'marked_paid' then
    update public.claims set status = 'marked_paid', marked_paid_at = now(),
      payment_method = p_payment_method, debtor_note = nullif(trim(p_note), '')
    where id = v_claim.id;
    insert into public.claim_events (claim_id, actor_type, event_type, metadata)
    values (v_claim.id, 'debtor', 'claim_marked_paid', jsonb_build_object('paymentMethod', p_payment_method));
  end if;
  select e.created_by, d.display_name, e.currency into v_owner, v_debtor_name, v_currency
  from public.expenses e join public.expense_participants d on d.id = v_claim.debtor_participant_id
  where e.id = v_claim.expense_id;
  return jsonb_build_object(
    'claimId', v_claim.id, 'expenseId', v_claim.expense_id,
    'status', 'marked_paid', 'markedPaidAt', coalesce(v_claim.marked_paid_at, now()),
    'ownerUserId', v_owner, 'debtorDisplayName', v_debtor_name,
    'amountCents', v_claim.amount_cents, 'currency', v_currency
  );
end;
$$;

create function public.dispute_claim_by_token(p_token_hash text, p_reason text, p_message text)
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
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_reason not in ('did_not_consume', 'incorrect_amount', 'already_paid', 'unknown_expense', 'other')
    or char_length(coalesce(p_message, '')) > 1000 then
    raise exception using errcode = '22023', message = 'INVALID_DISPUTE_INPUT';
  end if;
  select * into v_claim from public.claims where public_token_hash = lower(p_token_hash) for update;
  if not found then return null; end if;
  if v_claim.status not in ('sent', 'viewed', 'marked_paid', 'disputed') then
    raise exception using errcode = '55000', message = 'CLAIM_STATE_NOT_ALLOWED';
  end if;
  select id into v_dispute_id from public.claim_disputes where claim_id = v_claim.id and status = 'open';
  if v_dispute_id is null then
    insert into public.claim_disputes (claim_id, reason, message)
    values (v_claim.id, p_reason, nullif(trim(p_message), '')) returning id into v_dispute_id;
    update public.claims set status = 'disputed' where id = v_claim.id;
    insert into public.claim_events (claim_id, actor_type, event_type, metadata)
    values (v_claim.id, 'debtor', 'claim_disputed', jsonb_build_object('reason', p_reason));
  end if;
  select e.created_by, d.display_name into v_owner, v_debtor_name
  from public.expenses e join public.expense_participants d on d.id = v_claim.debtor_participant_id
  where e.id = v_claim.expense_id;
  return jsonb_build_object(
    'claimId', v_claim.id, 'expenseId', v_claim.expense_id,
    'disputeId', v_dispute_id, 'status', 'disputed',
    'createdAt', now(), 'ownerUserId', v_owner, 'debtorDisplayName', v_debtor_name
  );
end;
$$;

create function public.confirm_claim_payment(p_claim_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_owner uuid;
  v_debtor_user uuid;
  v_creditor_user uuid;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'CLAIM_NOT_FOUND'; end if;
  select e.created_by, d.user_id, cr.user_id into v_owner, v_debtor_user, v_creditor_user
  from public.expenses e
  join public.expense_participants d on d.id = v_claim.debtor_participant_id
  join public.expense_participants cr on cr.id = v_claim.creditor_participant_id
  where e.id = v_claim.expense_id;
  if v_actor is distinct from v_owner and v_actor is distinct from v_creditor_user then
    raise exception using errcode = '42501', message = 'NOT_CLAIM_CREDITOR';
  end if;
  if v_claim.status not in ('marked_paid', 'confirmed') then
    raise exception using errcode = '55000', message = 'CLAIM_STATE_NOT_ALLOWED';
  end if;
  if v_claim.status <> 'confirmed' then
    update public.claims set status = 'confirmed', confirmed_at = now() where id = v_claim.id;
    insert into public.claim_events (claim_id, actor_type, actor_user_id, event_type)
    values (v_claim.id, 'owner', v_actor, 'payment_confirmed');
  end if;
  if not exists (select 1 from public.claims where expense_id = v_claim.expense_id and status <> 'confirmed') then
    update public.expenses set status = 'settled' where id = v_claim.expense_id;
  end if;
  return jsonb_build_object(
    'claimId', v_claim.id, 'status', 'confirmed', 'confirmedAt', coalesce(v_claim.confirmed_at, now()),
    'debtorUserId', v_debtor_user
  );
end;
$$;

create function public.prepare_claim_reminder(p_claim_id uuid, p_new_token_hash text)
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
  if p_new_token_hash is null or p_new_token_hash !~ '^[0-9a-f]{64}$' then raise exception using errcode = '22023', message = 'INVALID_TOKEN_HASH'; end if;
  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'CLAIM_NOT_FOUND'; end if;
  select e.created_by, e.title, e.currency, d.display_name, d.user_id
    into v_owner, v_title, v_currency, v_debtor_name, v_debtor_user
  from public.expenses e join public.expense_participants d on d.id = v_claim.debtor_participant_id
  where e.id = v_claim.expense_id;
  if v_owner is distinct from v_actor then raise exception using errcode = '42501', message = 'NOT_EXPENSE_OWNER'; end if;
  if v_claim.status not in ('sent', 'viewed') then raise exception using errcode = '55000', message = 'REMINDER_NOT_ALLOWED'; end if;
  if v_claim.last_reminded_at is not null and v_claim.last_reminded_at > now() - interval '24 hours' then
    raise exception using errcode = '55000', message = 'REMINDER_TOO_SOON';
  end if;
  update public.claims set public_token_hash = lower(p_new_token_hash), token_version = token_version + 1,
    last_reminded_at = now(), reminder_count = reminder_count + 1
  where id = v_claim.id;
  insert into public.claim_events (claim_id, actor_type, actor_user_id, event_type)
  values (v_claim.id, 'owner', v_actor, 'reminder_sent');
  insert into public.usage_counters (user_id, period_start, reminders_sent)
  values (v_actor, date_trunc('month', now())::date, 1)
  on conflict (user_id, period_start) do update
  set reminders_sent = public.usage_counters.reminders_sent + 1;
  return jsonb_build_object(
    'claimId', v_claim.id, 'amountCents', v_claim.amount_cents, 'currency', v_currency,
    'expenseTitle', v_title, 'debtorDisplayName', v_debtor_name, 'debtorUserId', v_debtor_user,
    'reminderCount', v_claim.reminder_count + 1, 'lastRemindedAt', now()
  );
end;
$$;

create function public.reject_claim_payment(p_claim_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_owner uuid;
  v_creditor_user uuid;
  v_debtor_user uuid;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'CLAIM_NOT_FOUND'; end if;
  select e.created_by, creditor.user_id, debtor.user_id
    into v_owner, v_creditor_user, v_debtor_user
  from public.expenses e
  join public.expense_participants creditor on creditor.id = v_claim.creditor_participant_id
  join public.expense_participants debtor on debtor.id = v_claim.debtor_participant_id
  where e.id = v_claim.expense_id;
  if v_actor is distinct from v_owner and v_actor is distinct from v_creditor_user then
    raise exception using errcode = '42501', message = 'NOT_CLAIM_CREDITOR';
  end if;
  if v_claim.status <> 'marked_paid' then
    raise exception using errcode = '55000', message = 'CLAIM_STATE_NOT_ALLOWED';
  end if;
  update public.claims set
    status = case when viewed_at is null then 'sent'::public.claim_status else 'viewed'::public.claim_status end,
    marked_paid_at = null,
    payment_method = null,
    debtor_note = null
  where id = v_claim.id;
  insert into public.claim_events (claim_id, actor_type, actor_user_id, event_type)
  values (v_claim.id, 'owner', v_actor, 'payment_not_received');
  return jsonb_build_object(
    'claimId', v_claim.id,
    'status', case when v_claim.viewed_at is null then 'sent' else 'viewed' end,
    'debtorUserId', v_debtor_user
  );
end;
$$;

create function public.resolve_claim_dispute_transaction(
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
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if p_outcome is null
    or p_outcome not in ('reopen', 'cancel')
    or char_length(coalesce(p_resolution_note, '')) > 1000 then
    raise exception using errcode = '22023', message = 'INVALID_DISPUTE_RESOLUTION';
  end if;

  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'CLAIM_NOT_FOUND'; end if;
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

  select * into v_dispute from public.claim_disputes
  where claim_id = v_claim.id and status = 'open'
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'DISPUTE_NOT_FOUND'; end if;

  v_next_status := case
    when p_outcome = 'cancel' then 'cancelled'::public.claim_status
    when v_claim.viewed_at is null then 'sent'::public.claim_status
    else 'viewed'::public.claim_status
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
    update public.claims set
      status = v_next_status,
      marked_paid_at = null,
      payment_method = null,
      debtor_note = null
    where id = v_claim.id;
  end if;

  insert into public.claim_events (claim_id, actor_type, actor_user_id, event_type, metadata)
  values (
    v_claim.id,
    'owner',
    v_actor,
    case when p_outcome = 'cancel' then 'dispute_cancelled' else 'dispute_resolved' end,
    jsonb_build_object('outcome', p_outcome)
  );
  if p_outcome = 'cancel' then
    insert into public.claim_events (claim_id, actor_type, actor_user_id, event_type)
    values (v_claim.id, 'owner', v_actor, 'claim_cancelled');
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

create function public.archive_expense(p_expense_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_expense public.expenses%rowtype;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_expense from public.expenses where id = p_expense_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'EXPENSE_NOT_FOUND'; end if;
  if v_expense.created_by is distinct from v_actor then raise exception using errcode = '42501', message = 'NOT_EXPENSE_OWNER'; end if;
  if v_expense.archived_at is null then
    update public.expenses set archived_at = now() where id = v_expense.id;
  end if;
  return jsonb_build_object(
    'expenseId', v_expense.id,
    'archivedAt', coalesce(v_expense.archived_at, now())
  );
end;
$$;

create function public.revoke_claim_transaction(p_claim_id uuid)
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
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'CLAIM_NOT_FOUND'; end if;
  select created_by into v_owner from public.expenses where id = v_claim.expense_id;
  if v_owner is distinct from v_actor then raise exception using errcode = '42501', message = 'NOT_EXPENSE_OWNER'; end if;
  if v_claim.status = 'confirmed' then raise exception using errcode = '55000', message = 'CONFIRMED_CLAIM_CANNOT_BE_REVOKED'; end if;
  if v_claim.status <> 'cancelled' then
    update public.claim_disputes set
      status = 'dismissed',
      resolved_by = v_actor,
      resolution_note = coalesce(nullif(trim(resolution_note), ''), 'Solicitud cancelada'),
      resolved_at = now()
    where claim_id = v_claim.id and status = 'open'
    returning id into v_dispute_id;
    if v_dispute_id is not null then
      insert into public.claim_events (claim_id, actor_type, actor_user_id, event_type)
      values (v_claim.id, 'owner', v_actor, 'dispute_cancelled');
    end if;
    update public.claims set status = 'cancelled', public_token_hash = null,
      token_version = token_version + 1, cancelled_at = now()
    where id = v_claim.id;
    insert into public.claim_events (claim_id, actor_type, actor_user_id, event_type)
    values (v_claim.id, 'owner', v_actor, 'claim_cancelled');
  end if;
  return jsonb_build_object('claimId', v_claim.id, 'status', 'cancelled', 'cancelledAt', coalesce(v_claim.cancelled_at, now()));
end;
$$;

create function public.apply_receipt_scan_result(
  p_job_id uuid,
  p_expense_id uuid,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total bigint;
  v_confidence numeric;
begin
  select (p_result ->> 'totalCents')::bigint, (p_result ->> 'confidence')::numeric
  into v_total, v_confidence;
  if v_total <= 0 or v_confidence not between 0 and 1 or jsonb_typeof(p_result -> 'items') <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_OCR_RESULT';
  end if;
  perform 1 from public.expenses where id = p_expense_id and status = 'draft' for update;
  if not found then
    raise exception using errcode = '55000', message = 'EXPENSE_NOT_EDITABLE';
  end if;
  perform 1 from public.receipt_scan_jobs
  where id = p_job_id and expense_id = p_expense_id and status = 'processing'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SCAN_JOB_NOT_FOUND';
  end if;
  delete from public.expense_items where expense_id = p_expense_id and source = 'ocr';
  insert into public.expense_items (
    expense_id, name, quantity, unit_price_cents, line_total_cents,
    category, sort_order, ocr_confidence, source
  )
  select p_expense_id, x.name, x.quantity, x."unitPriceCents", x."lineTotalCents",
    null, x.ordinality::integer - 1, x.confidence, 'ocr'
  from jsonb_to_recordset(p_result -> 'items') with ordinality
    as x(name text, quantity numeric, "unitPriceCents" bigint, "lineTotalCents" bigint, confidence numeric, ordinality bigint);
  update public.expenses set
    merchant_name = nullif(left(p_result ->> 'merchantName', 120), ''),
    occurred_at = coalesce(nullif(p_result ->> 'occurredAt', '')::timestamptz, occurred_at),
    currency = p_result ->> 'currency',
    total_cents = v_total,
    own_share_cents = v_total,
    recoverable_cents = 0,
    scan_status = 'completed'
  where id = p_expense_id;
  update public.receipt_scan_jobs set status = 'completed', confidence = v_confidence,
    warnings = coalesce(p_result -> 'warnings', '[]'::jsonb), completed_at = now(), error_code = null
  where id = p_job_id and expense_id = p_expense_id;
end;
$$;

create function public.create_group_invite_transaction(
  p_group_id uuid,
  p_token_hash text,
  p_invited_email text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or char_length(coalesce(p_invited_email, '')) > 254
    or p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception using errcode = '22023', message = 'INVALID_INVITE_INPUT';
  end if;
  if not exists (select 1 from public.groups where id = p_group_id and owner_id = v_actor) then
    raise exception using errcode = '42501', message = 'NOT_GROUP_OWNER';
  end if;
  insert into public.group_invites (group_id, created_by, invited_email, public_token_hash, expires_at)
  values (p_group_id, v_actor, nullif(lower(trim(p_invited_email)), ''), lower(p_token_hash), p_expires_at)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.reserve_ocr_scan(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_user_id is null then raise exception using errcode = '22023', message = 'INVALID_USER_ID'; end if;
  insert into public.usage_counters (user_id, period_start, ocr_scans_used)
  values (p_user_id, date_trunc('month', now())::date, 1)
  on conflict (user_id, period_start) do update
  set ocr_scans_used = public.usage_counters.ocr_scans_used + 1
  where public.usage_counters.ocr_scans_used < 3
  returning ocr_scans_used into v_count;
  if v_count is null then
    raise exception using errcode = '55000', message = 'OCR_LIMIT_REACHED';
  end if;
  return v_count;
end;
$$;

create function public.delete_account_data_transaction(p_user_id uuid)
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

  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    return jsonb_build_object(
      'deleted', false,
      'groupsTransferred', 0,
      'groupsDeleted', 0,
      'expensesDeleted', 0,
      'expensesPreserved', 0
    );
  end if;

  -- A registered active member inherits each shared group. Groups without a
  -- registered successor are removed; their expenses are detached, not cascaded.
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
      update public.groups set owner_id = v_replacement where id = v_group.id;
      v_groups_transferred := v_groups_transferred + 1;
    end if;
  end loop;

  -- Invitation records identify their creator or acceptor and are not needed
  -- for the group's accounting history.
  delete from public.group_invites
  where created_by = p_user_id or accepted_by = p_user_id;

  -- No actionable public link may remain without its creditor. Draft claims
  -- have never been shared; active claims are cancelled, while confirmed
  -- claims keep their ledger status but lose their bearer token.
  delete from public.claims c
  using public.expenses e, public.expense_participants creditor
  where c.expense_id = e.id
    and creditor.id = c.creditor_participant_id
    and (e.created_by = p_user_id or creditor.user_id = p_user_id)
    and c.status = 'draft';

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
  select claim_id, 'system', 'dispute_cancelled', jsonb_build_object('reason', 'account_deleted')
  from dismissed;

  with affected as (
    update public.claims c set
      status = case
        when c.status = 'confirmed' then 'confirmed'::public.claim_status
        else 'cancelled'::public.claim_status
      end,
      public_token_hash = null,
      token_version = c.token_version + 1,
      cancelled_at = case
        when c.status = 'confirmed' then c.cancelled_at
        else coalesce(c.cancelled_at, now())
      end
    from public.expenses e, public.expense_participants creditor
    where c.expense_id = e.id
      and creditor.id = c.creditor_participant_id
      and (e.created_by = p_user_id or creditor.user_id = p_user_id)
      and (c.public_token_hash is not null or c.status not in ('confirmed', 'cancelled'))
    returning c.id
  )
  insert into public.claim_events (claim_id, actor_type, event_type, metadata)
  select id, 'system', 'account_deleted', jsonb_build_object('publicAccessRevoked', true)
  from affected;

  -- Free-form dispute text authored by this account is personal data. Keep the
  -- categorical reason/status so the other party retains the financial record.
  update public.claim_disputes d set message = null
  from public.claims c, public.expense_participants debtor
  where d.claim_id = c.id
    and debtor.id = c.debtor_participant_id
    and debtor.user_id = p_user_id;
  update public.claim_disputes
  set resolution_note = null, resolved_by = null
  where resolved_by = p_user_id;
  update public.claim_events set actor_user_id = null where actor_user_id = p_user_id;
  update public.claims c set debtor_note = null
  from public.expense_participants debtor
  where debtor.id = c.debtor_participant_id and debtor.user_id = p_user_id;
  update public.expenses set notes = null where created_by = p_user_id;

  -- Draft/private expenses disappear. An expense is shared when another linked
  -- participant or an active group member can have an interest in its history.
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

  -- Break the composite payer reference before cascading participant deletion.
  update public.expenses set payer_participant_id = null
  where id = any(v_expenses_to_delete);
  delete from public.expenses where id = any(v_expenses_to_delete);
  get diagnostics v_expenses_deleted = row_count;

  -- Receipt objects are deleted by the Edge Function before this transaction.
  -- Clear every matching pointer, including defensive handling of legacy rows.
  update public.expenses
  set receipt_path = null
  where receipt_path is not null
    and split_part(receipt_path, '/', 1) = p_user_id::text;

  update public.expenses
  set created_by = null
  where created_by = p_user_id;
  get diagnostics v_expenses_preserved = row_count;

  -- Shared participants and accounting events remain, but direct identifiers
  -- and contact fields belonging to this account are removed.
  update public.expense_participants set
    user_id = null,
    display_name = 'Usuario eliminado',
    avatar_path = null,
    email = null,
    phone_e164 = null
  where user_id = p_user_id;
  delete from public.group_members where user_id = p_user_id;

  if exists (select 1 from public.groups where owner_id = p_user_id)
    or exists (select 1 from public.expenses where created_by = p_user_id) then
    raise exception using errcode = '55000', message = 'ACCOUNT_DELETION_INCOMPLETE';
  end if;

  delete from public.profiles where id = p_user_id;
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

create function public.accept_group_invite_transaction(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_invite public.group_invites%rowtype;
  v_email text;
  v_name text;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception using errcode = '22023', message = 'INVALID_TOKEN'; end if;
  select * into v_invite from public.group_invites
  where public_token_hash = lower(p_token_hash) for update;
  if not found then raise exception using errcode = 'P0002', message = 'INVITE_NOT_FOUND'; end if;
  if v_invite.status <> 'pending' or v_invite.expires_at <= now() then
    if v_invite.status = 'pending' then
      update public.group_invites set status = 'expired' where id = v_invite.id;
    end if;
    raise exception using errcode = '55000', message = 'INVITE_NOT_ACTIVE';
  end if;
  select lower(email) into v_email from auth.users where id = v_actor;
  if v_invite.invited_email is not null and v_invite.invited_email <> v_email then
    raise exception using errcode = '42501', message = 'INVITE_EMAIL_MISMATCH';
  end if;
  select display_name into v_name from public.profiles where id = v_actor;
  insert into public.group_members (group_id, user_id, display_name, email, role, status)
  values (v_invite.group_id, v_actor, v_name, v_email, 'member', 'active')
  on conflict (group_id, user_id) do update set status = 'active', display_name = excluded.display_name;
  update public.group_invites set status = 'accepted', accepted_by = v_actor, accepted_at = now(), public_token_hash = null
  where id = v_invite.id;
  return jsonb_build_object('groupId', v_invite.group_id);
end;
$$;

revoke all on all tables in schema public from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.groups, public.group_members, public.expenses,
  public.expense_participants, public.expense_items, public.item_allocations to authenticated;
grant select on public.claims, public.claim_events, public.claim_disputes, public.receipt_scan_jobs,
  public.push_delivery_logs, public.usage_counters, public.group_invites to authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;
grant all on all tables in schema public to service_role;

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_group_member(uuid), private.owns_expense(uuid),
  private.expense_relationships_valid(uuid, uuid), private.owns_draft_expense(uuid),
  private.can_read_expense(uuid), private.can_read_claim(uuid),
  private.receipt_object_owned(text) to authenticated;
grant execute on function public.create_claims_transaction(uuid, jsonb),
  public.confirm_claim_payment(uuid), public.prepare_claim_reminder(uuid, text),
  public.reject_claim_payment(uuid),
  public.resolve_claim_dispute_transaction(uuid, text, text),
  public.archive_expense(uuid),
  public.revoke_claim_transaction(uuid),
  public.create_group_invite_transaction(uuid, text, text, timestamptz),
  public.accept_group_invite_transaction(text) to authenticated;
grant execute on function public.consume_endpoint_rate_limit(text, text, integer, integer),
  public.get_public_claim_payload(text), public.mark_claim_paid_by_token(text, text, text),
  public.dispute_claim_by_token(text, text, text),
  public.apply_receipt_scan_result(uuid, uuid, jsonb),
  public.reserve_ocr_scan(uuid),
  public.delete_account_data_transaction(uuid) to service_role;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
