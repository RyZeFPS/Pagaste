-- Repair the public claim DTO contract and add durable, per-user claim
-- notifications. Public links continue to store only an HMAC hash.

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

create table public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('claim_requested')),
  claim_id uuid not null references public.claims (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, kind, claim_id)
);

create index app_notifications_user_created_idx
  on public.app_notifications (user_id, created_at desc);

create index app_notifications_user_unread_idx
  on public.app_notifications (user_id, created_at desc)
  where read_at is null;

alter table public.app_notifications enable row level security;

create policy app_notifications_select_own
on public.app_notifications
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy app_notifications_update_own
on public.app_notifications
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on table public.app_notifications from public, anon, authenticated;
grant select, update on table public.app_notifications to authenticated;

create or replace function private.create_claim_requested_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  select participant.user_id
  into v_user_id
  from public.expense_participants participant
  where participant.id = new.debtor_participant_id;

  if v_user_id is not null then
    insert into public.app_notifications (user_id, kind, claim_id)
    values (v_user_id, 'claim_requested', new.id)
    on conflict (user_id, kind, claim_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function private.create_claim_requested_notification()
from public, anon, authenticated, service_role;

create trigger claims_create_requested_notification
after insert on public.claims
for each row execute function private.create_claim_requested_notification();

-- Preserve the latest linked requests created before this migration so the
-- recipient sees them on their next app session.
insert into public.app_notifications (user_id, kind, claim_id)
select debtor.user_id, 'claim_requested', claim.id
from public.claims claim
join public.expense_participants debtor on debtor.id = claim.debtor_participant_id
where debtor.user_id is not null
  and claim.status in ('pending', 'reminder_sent', 'disputed')
on conflict (user_id, kind, claim_id) do nothing;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'app_notifications'
    ) then
    alter publication supabase_realtime add table public.app_notifications;
  end if;
end;
$$;

revoke execute on function public.get_public_claim_payload(text)
from public, anon, authenticated;
grant execute on function public.get_public_claim_payload(text)
to service_role;
