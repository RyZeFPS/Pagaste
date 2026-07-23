create index if not exists claims_marked_paid_by_user_idx
  on public.claims (marked_paid_by_user_id)
  where marked_paid_by_user_id is not null;
