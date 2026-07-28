create or replace function private.remove_fully_offset_claim_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.app_notifications notification
  using public.claims claim
  where notification.claim_id = new.claim_id
    and notification.claim_id = claim.id
    and notification.kind = 'claim_requested'
    and claim.status = 'cancelled';

  return new;
end;
$$;

revoke all on function private.remove_fully_offset_claim_notification()
from public, anon, authenticated, service_role;

create trigger claim_events_remove_fully_offset_notification
after insert on public.claim_events
for each row
when (new.event_type = 'debt_offset')
execute function private.remove_fully_offset_claim_notification();
