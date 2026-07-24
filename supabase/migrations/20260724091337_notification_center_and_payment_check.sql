alter table public.app_notifications
drop constraint if exists app_notifications_kind_check;

alter table public.app_notifications
add constraint app_notifications_kind_check
check (kind in ('claim_requested', 'payment_check_requested'));

create or replace function public.request_claim_payment_check(
  p_claim_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim_id uuid;
  v_expense_id uuid;
  v_amount_cents bigint;
  v_status public.claim_status;
  v_sent_at timestamptz;
  v_debtor_user_id uuid;
  v_creditor_user_id uuid;
  v_debtor_display_name text;
  v_expense_title text;
  v_currency text;
  v_group_name text;
  v_last_requested_at timestamptz;
  v_requested_at timestamptz := now();
begin
  if p_actor_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select
    claim.id,
    claim.expense_id,
    claim.amount_cents,
    claim.status,
    claim.sent_at,
    debtor.user_id,
    creditor.user_id,
    debtor.display_name,
    expense.title,
    expense.currency,
    expense_group.name
  into
    v_claim_id,
    v_expense_id,
    v_amount_cents,
    v_status,
    v_sent_at,
    v_debtor_user_id,
    v_creditor_user_id,
    v_debtor_display_name,
    v_expense_title,
    v_currency,
    v_group_name
  from public.claims claim
  join public.expense_participants debtor
    on debtor.id = claim.debtor_participant_id
  join public.expense_participants creditor
    on creditor.id = claim.creditor_participant_id
  join public.expenses expense
    on expense.id = claim.expense_id
  left join public.groups expense_group
    on expense_group.id = expense.group_id
  where claim.id = p_claim_id
  for update of claim;

  if not found then
    raise exception using errcode = 'P0002', message = 'CLAIM_NOT_FOUND';
  end if;
  if v_debtor_user_id is distinct from p_actor_user_id then
    raise exception using errcode = '42501', message = 'NOT_CLAIM_DEBTOR';
  end if;
  if v_creditor_user_id is null then
    raise exception using errcode = '55000', message = 'CLAIM_RECIPIENT_NOT_LINKED';
  end if;
  if v_status not in ('pending', 'reminder_sent') then
    raise exception using errcode = '55000', message = 'CLAIM_STATE_NOT_ALLOWED';
  end if;
  if v_sent_at is null or v_sent_at > now() - interval '10 minutes' then
    raise exception using errcode = '55000', message = 'PAYMENT_CHECK_TOO_EARLY';
  end if;

  select max(event.created_at)
  into v_last_requested_at
  from public.claim_events event
  where event.claim_id = p_claim_id
    and event.event_type = 'payment_check_requested';

  if v_last_requested_at is not null
    and v_last_requested_at > now() - interval '24 hours' then
    raise exception using errcode = '55000', message = 'PAYMENT_CHECK_TOO_SOON';
  end if;

  insert into public.claim_events (
    claim_id,
    actor_type,
    actor_user_id,
    event_type,
    metadata
  )
  values (
    p_claim_id,
    'debtor',
    p_actor_user_id,
    'payment_check_requested',
    jsonb_build_object(
      'notification_only', true,
      'claim_status_unchanged', true
    )
  );

  insert into public.app_notifications (
    user_id,
    kind,
    claim_id,
    read_at,
    created_at
  )
  values (
    v_creditor_user_id,
    'payment_check_requested',
    p_claim_id,
    null,
    v_requested_at
  )
  on conflict (user_id, kind, claim_id)
  do update set
    read_at = null,
    created_at = excluded.created_at;

  return jsonb_build_object(
    'claimId', v_claim_id,
    'expenseId', v_expense_id,
    'recipientUserId', v_creditor_user_id,
    'debtorDisplayName', v_debtor_display_name,
    'expenseTitle', v_expense_title,
    'currency', v_currency,
    'amountCents', v_amount_cents,
    'groupName', v_group_name,
    'requestedAt', v_requested_at,
    'nextAllowedAt', v_requested_at + interval '24 hours'
  );
end;
$$;

revoke execute on function public.request_claim_payment_check(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.request_claim_payment_check(uuid, uuid)
to service_role;
