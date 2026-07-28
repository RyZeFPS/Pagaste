-- A received claim revokes its full public link immediately. Preserve only an
-- irreversible lookup for ten minutes so the payer can see a minimal terminal
-- confirmation without reopening the expense, participant or payment details.

create table private.claim_completion_receipts (
  token_hash text primary key
    check (token_hash ~ '^[0-9a-f]{64}$'),
  claim_id uuid not null references public.claims (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index claim_completion_receipts_expiry_idx
  on private.claim_completion_receipts (expires_at);

revoke all on table private.claim_completion_receipts
from public, anon, authenticated, service_role;

create or replace function private.capture_claim_completion_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('pending', 'reminder_sent')
    and new.status = 'received'
    and old.public_token_hash is not null
    and new.public_token_hash is null
  then
    delete from private.claim_completion_receipts
    where expires_at <= now();

    insert into private.claim_completion_receipts (
      token_hash,
      claim_id,
      expires_at
    ) values (
      old.public_token_hash,
      new.id,
      least(
        coalesce(old.public_link_expires_at, now() + interval '10 minutes'),
        now() + interval '10 minutes'
      )
    )
    on conflict (token_hash) do update
    set
      claim_id = excluded.claim_id,
      expires_at = excluded.expires_at,
      created_at = now();
  end if;

  return new;
end;
$$;

revoke all on function private.capture_claim_completion_receipt()
from public, anon, authenticated, service_role;

create trigger claims_capture_completion_receipt
after update of status, public_token_hash on public.claims
for each row execute function private.capture_claim_completion_receipt();

create function public.get_public_claim_completion(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select jsonb_build_object(
    'terminal', true,
    'status', 'received',
    'completed', true,
    'recipientLocale', coalesce(debtor_profile.locale, 'es-ES')
  )
  into v_payload
  from private.claim_completion_receipts receipt
  join public.claims claim on claim.id = receipt.claim_id
  join public.expense_participants debtor
    on debtor.id = claim.debtor_participant_id
  left join public.profiles debtor_profile
    on debtor_profile.id = debtor.user_id
  where receipt.token_hash = lower(p_token_hash)
    and receipt.expires_at > now()
    and claim.status = 'received';

  return v_payload;
end;
$$;

revoke all on function public.get_public_claim_completion(text)
from public, anon, authenticated, service_role;
grant execute on function public.get_public_claim_completion(text)
to service_role;
