-- Public claim links are bearer credentials. Give owners an explicit,
-- auditable lifecycle without exposing tokens or request metadata.

alter table public.claims
  add column if not exists public_link_expires_at timestamptz,
  add column if not exists last_link_accessed_at timestamptz,
  add column if not exists link_access_count bigint not null default 0;

update public.claims
set public_link_expires_at = now() + interval '30 days'
where public_token_hash is not null
  and public_link_expires_at is null;

update public.claims
set public_link_expires_at = null
where public_token_hash is null
  and public_link_expires_at is not null;

alter table public.claims
  drop constraint if exists claims_link_access_count_valid,
  drop constraint if exists claims_public_link_expiry_valid,
  drop constraint if exists claims_public_link_state_valid;

alter table public.claims
  add constraint claims_link_access_count_valid
    check (link_access_count >= 0),
  add constraint claims_public_link_expiry_valid
    check ((public_token_hash is null) = (public_link_expires_at is null)),
  add constraint claims_public_link_state_valid
    check (
      status not in ('received', 'cancelled')
      or public_token_hash is null
    );

create or replace function private.sync_claim_link_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.public_token_hash is null then
    new.public_link_expires_at := null;
    return new;
  end if;

  if tg_op = 'INSERT' and new.public_link_expires_at is null then
    new.public_link_expires_at := now() + interval '30 days';
  elsif tg_op = 'UPDATE'
    and new.public_token_hash is distinct from old.public_token_hash
    and (
      new.public_link_expires_at is null
      or new.public_link_expires_at is not distinct from old.public_link_expires_at
    )
  then
    new.public_link_expires_at := now() + interval '30 days';
  end if;

  return new;
end;
$$;

drop trigger if exists claims_sync_link_lifecycle on public.claims;
create trigger claims_sync_link_lifecycle
before insert or update of public_token_hash, public_link_expires_at
on public.claims
for each row execute function private.sync_claim_link_lifecycle();

create table if not exists private.claim_link_accesses (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  accessed_at timestamptz not null default now()
);

create index if not exists claim_link_accesses_claim_recent_idx
  on private.claim_link_accesses (claim_id, accessed_at desc);

revoke all on table private.claim_link_accesses
  from public, anon, authenticated, service_role;

create or replace function public.rotate_claim_link(
  p_claim_id uuid,
  p_new_token_hash text,
  p_expires_in_days integer default 30
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
  v_creditor_user uuid;
  v_recipient_locale text := 'es-ES';
  v_expires_at timestamptz;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_new_token_hash is null
    or p_new_token_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_TOKEN_HASH';
  end if;
  if p_expires_in_days is null
    or p_expires_in_days < 1
    or p_expires_in_days > 90
  then
    raise exception using errcode = '22023', message = 'INVALID_LINK_EXPIRY';
  end if;

  select c.*
  into v_claim
  from public.claims c
  where c.id = p_claim_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'CLAIM_NOT_FOUND';
  end if;

  select
    e.created_by,
    creditor.user_id,
    coalesce(debtor_profile.locale, 'es-ES')
  into v_owner, v_creditor_user, v_recipient_locale
  from public.expenses e
  join public.expense_participants creditor
    on creditor.id = v_claim.creditor_participant_id
  join public.expense_participants debtor
    on debtor.id = v_claim.debtor_participant_id
  left join public.profiles debtor_profile on debtor_profile.id = debtor.user_id
  where e.id = v_claim.expense_id;
  if v_actor is distinct from v_owner
    and v_actor is distinct from v_creditor_user
  then
    raise exception using errcode = '42501', message = 'NOT_CLAIM_CREDITOR';
  end if;
  if v_claim.status not in ('pending', 'reminder_sent', 'disputed') then
    raise exception using errcode = '55000', message = 'CLAIM_LINK_NOT_ROTATABLE';
  end if;

  v_expires_at := now() + make_interval(days => p_expires_in_days);

  update public.claims
  set
    public_token_hash = lower(p_new_token_hash),
    token_version = token_version + 1,
    public_link_expires_at = v_expires_at
  where id = v_claim.id;

  insert into public.claim_events (
    claim_id,
    actor_type,
    actor_user_id,
    event_type,
    metadata
  ) values (
    v_claim.id,
    'owner',
    v_actor,
    'claim_link_regenerated',
    jsonb_build_object('expiresAt', v_expires_at)
  );

  return jsonb_build_object(
    'claimId', v_claim.id,
    'expiresAt', v_expires_at,
    'recipientLocale', v_recipient_locale
  );
end;
$$;

create or replace function public.revoke_claim_link(p_claim_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_claim public.claims%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select claim.*
  into v_claim
  from public.claims claim
  join public.expenses expense on expense.id = claim.expense_id
  join public.expense_participants creditor
    on creditor.id = claim.creditor_participant_id
  where claim.id = p_claim_id
    and v_actor in (expense.created_by, creditor.user_id)
  for update of claim;

  if not found then
    raise exception using errcode = '42501', message = 'NOT_CLAIM_CREDITOR';
  end if;
  if v_claim.status not in ('pending', 'reminder_sent', 'disputed') then
    raise exception using errcode = '55000', message = 'CLAIM_LINK_NOT_REVOCABLE';
  end if;

  if v_claim.public_token_hash is not null then
    update public.claims
    set
      public_token_hash = null,
      token_version = token_version + 1
    where id = v_claim.id;

    insert into public.claim_events (
      claim_id,
      actor_type,
      actor_user_id,
      event_type
    ) values (
      v_claim.id,
      'owner',
      v_actor,
      'claim_link_revoked'
    );
  end if;

  return jsonb_build_object(
    'claimId', v_claim.id,
    'active', false
  );
end;
$$;

create or replace function public.get_claim_link_activity(p_claim_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_payload jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if not exists (
    select 1
    from public.claims claim
    join public.expenses expense on expense.id = claim.expense_id
    join public.expense_participants creditor
      on creditor.id = claim.creditor_participant_id
    where claim.id = p_claim_id
      and v_actor in (expense.created_by, creditor.user_id)
  ) then
    raise exception using errcode = '42501', message = 'CLAIM_NOT_VISIBLE';
  end if;

  select jsonb_build_object(
    'claimId', c.id,
    'active',
      c.public_token_hash is not null
      and c.public_link_expires_at > now()
      and c.status in ('pending', 'reminder_sent', 'disputed'),
    'expiresAt', c.public_link_expires_at,
    'accessCount', c.link_access_count,
    'lastAccessedAt', c.last_link_accessed_at,
    'recentAccesses', coalesce((
      select jsonb_agg(jsonb_build_object('accessedAt', recent.accessed_at)
        order by recent.accessed_at desc)
      from (
        select access.accessed_at
        from private.claim_link_accesses access
        where access.claim_id = c.id
        order by access.accessed_at desc
        limit 10
      ) recent
    ), '[]'::jsonb)
  )
  into v_payload
  from public.claims c
  where c.id = p_claim_id;

  if v_payload is null then
    raise exception using errcode = 'P0002', message = 'CLAIM_NOT_FOUND';
  end if;

  return v_payload;
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
  v_recipient_locale text := 'es-ES';
  v_should_log boolean;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select c.*
  into v_claim
  from public.claims c
  where c.public_token_hash = lower(p_token_hash)
    and c.public_link_expires_at > now()
    and c.status in ('pending', 'reminder_sent', 'disputed')
  for update;
  if not found then return null; end if;

  -- A public page may load more than once while hydrating. Count at most one
  -- access per five-minute window so a leaked bearer token cannot grow this
  -- audit table or inflate its counters without bound.
  v_should_log :=
    v_claim.last_link_accessed_at is null
    or v_claim.last_link_accessed_at <= now() - interval '5 minutes';

  select coalesce(debtor_profile.locale, 'es-ES')
  into v_recipient_locale
  from public.expense_participants debtor
  left join public.profiles debtor_profile on debtor_profile.id = debtor.user_id
  where debtor.id = v_claim.debtor_participant_id;

  if v_claim.viewed_at is null or v_should_log then
    update public.claims
    set
      viewed_at = coalesce(viewed_at, now()),
      last_link_accessed_at = case
        when v_should_log then now()
        else last_link_accessed_at
      end,
      link_access_count = link_access_count
        + case when v_should_log then 1 else 0 end
    where id = v_claim.id;
  end if;

  if v_should_log then
    insert into private.claim_link_accesses (claim_id)
    values (v_claim.id);
  end if;

  if v_claim.viewed_at is null then
    insert into public.claim_events (claim_id, actor_type, event_type)
    values (v_claim.id, 'debtor', 'claim_viewed');
  end if;

  select jsonb_build_object(
    'creditorDisplayName', creditor.display_name,
    'creditorAvatarUrl', null,
    'creditorPhoneE164', case
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
    'recipientLocale', v_recipient_locale,
    'linkExpiresAt', c.public_link_expires_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', i.name,
        'originalLineTotalCents', i.line_total_cents,
        'assignedAmountCents', a.amount_cents,
        'allocationLabel', case
          when left(lower(v_recipient_locale), 2) = 'en' then
            case a.method
              when 'equal' then 'Split equally'
              when 'shares' then
                rtrim(rtrim(a.shares::text, '0'), '.') || ' shares'
              when 'percentage' then
                rtrim(rtrim(a.percentage::text, '0'), '.') || '%'
              when 'units' then
                rtrim(rtrim(a.units::text, '0'), '.') || ' units'
              else 'Custom amount'
            end
          else
            case a.method
              when 'equal' then 'A partes iguales'
              when 'shares' then
                rtrim(rtrim(a.shares::text, '0'), '.') || ' partes'
              when 'percentage' then
                rtrim(rtrim(a.percentage::text, '0'), '.') || '%'
              when 'units' then
                rtrim(rtrim(a.units::text, '0'), '.') || ' unidades'
              else 'Importe personalizado'
            end
        end
      ) order by i.sort_order, i.id)
      from public.item_allocations a
      join public.expense_items i on i.id = a.item_id
      where a.participant_id = c.debtor_participant_id
        and a.amount_cents <> 0
    ), '[]'::jsonb),
    'canDispute', c.status in ('pending', 'reminder_sent')
  )
  into v_payload
  from public.claims c
  join public.expenses e on e.id = c.expense_id
  join public.expense_participants creditor on creditor.id = c.creditor_participant_id
  left join public.profiles creditor_profile on creditor_profile.id = creditor.user_id
  where c.id = v_claim.id;

  return v_payload;
end;
$$;

revoke all on function private.sync_claim_link_lifecycle()
  from public, anon, authenticated;
revoke all on function public.rotate_claim_link(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.revoke_claim_link(uuid)
  from public, anon, authenticated;
revoke all on function public.get_claim_link_activity(uuid)
  from public, anon, authenticated;
revoke all on function public.get_public_claim_payload(text)
  from public, anon, authenticated;

grant execute on function public.rotate_claim_link(uuid, text, integer)
  to authenticated;
grant execute on function public.revoke_claim_link(uuid)
  to authenticated;
grant execute on function public.get_claim_link_activity(uuid)
  to authenticated;
grant execute on function public.get_public_claim_payload(text)
  to service_role;
