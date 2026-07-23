begin;

-- Local demo account. Use the local email inbox/magic-link flow; no production
-- credential is embedded in the repository.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  'authenticated', 'authenticated', 'alex@pagaste.local',
  extensions.crypt('local-demo-only', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Alex","locale":"es-ES","timezone":"Europe/Madrid"}'::jsonb,
  now(), now(), '', '', '', ''
)
on conflict (id) do update set
  email = excluded.email,
  raw_user_meta_data = excluded.raw_user_meta_data,
  updated_at = now();

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '{"sub":"11111111-1111-4111-8111-111111111111","email":"alex@pagaste.local","email_verified":true}'::jsonb,
  'email', now(), now(), now()
)
on conflict do nothing;

insert into public.profiles (
  id, display_name, email, payment_phone_e164, share_payment_phone,
  default_currency, locale, timezone, notifications_enabled, onboarding_completed
)
values (
  '11111111-1111-4111-8111-111111111111', 'Alex', 'alex@pagaste.local',
  '+34600111222', true, 'EUR', 'es-ES', 'Europe/Madrid', true, true
)
on conflict (id) do update set display_name = excluded.display_name, onboarding_completed = true;

insert into public.expenses (
  id, created_by, title, merchant_name, occurred_at, currency, total_cents,
  recoverable_cents, own_share_cents, status, scan_status, sent_at
)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Cena del viernes', 'Pizzería Bella Napoli', now() - interval '2 days',
  'EUR', 4000, 2500, 1500, 'sent', 'completed', now() - interval '2 days'
)
on conflict (id) do nothing;

insert into public.expense_participants (
  id, expense_id, user_id, display_name, is_payer, sort_order
)
values
  ('33333333-3333-4333-8333-333333333330', '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Alex', true, 0),
  ('33333333-3333-4333-8333-333333333331', '22222222-2222-4222-8222-222222222222', null, 'Ferran', false, 1),
  ('33333333-3333-4333-8333-333333333332', '22222222-2222-4222-8222-222222222222', null, 'David', false, 2),
  ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', null, 'Marta', false, 3)
on conflict (id) do nothing;

update public.expenses
set payer_participant_id = '33333333-3333-4333-8333-333333333330'
where id = '22222222-2222-4222-8222-222222222222';

insert into public.expense_items (
  id, expense_id, name, quantity, unit_price_cents, line_total_cents,
  sort_order, ocr_confidence, source
)
values
  ('44444444-4444-4444-8444-444444444440', '22222222-2222-4222-8222-222222222222', 'Pizza', 1, 1200, 1200, 0, 0.98, 'ocr'),
  ('44444444-4444-4444-8444-444444444441', '22222222-2222-4222-8222-222222222222', 'Refrescos', 1, 700, 700, 1, 0.96, 'ocr'),
  ('44444444-4444-4444-8444-444444444442', '22222222-2222-4222-8222-222222222222', 'Patatas', 1, 420, 420, 2, 0.93, 'ocr'),
  ('44444444-4444-4444-8444-444444444443', '22222222-2222-4222-8222-222222222222', 'Ensalada', 1, 680, 680, 3, 0.91, 'ocr'),
  ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'Tiramisú', 1, 550, 550, 4, 0.97, 'ocr'),
  ('44444444-4444-4444-8444-444444444445', '22222222-2222-4222-8222-222222222222', 'Café', 1, 450, 450, 5, 0.95, 'ocr')
on conflict (id) do nothing;

-- Exact cent allocations: Alex 15.00, Ferran 8.50, David 11.00, Marta 5.50.
insert into public.item_allocations (item_id, participant_id, method, amount_cents)
values
  ('44444444-4444-4444-8444-444444444440','33333333-3333-4333-8333-333333333330','custom',350),
  ('44444444-4444-4444-8444-444444444440','33333333-3333-4333-8333-333333333331','custom',300),
  ('44444444-4444-4444-8444-444444444440','33333333-3333-4333-8333-333333333332','custom',350),
  ('44444444-4444-4444-8444-444444444440','33333333-3333-4333-8333-333333333333','custom',200),
  ('44444444-4444-4444-8444-444444444441','33333333-3333-4333-8333-333333333330','custom',250),
  ('44444444-4444-4444-8444-444444444441','33333333-3333-4333-8333-333333333331','custom',200),
  ('44444444-4444-4444-8444-444444444441','33333333-3333-4333-8333-333333333332','custom',200),
  ('44444444-4444-4444-8444-444444444441','33333333-3333-4333-8333-333333333333','custom',50),
  ('44444444-4444-4444-8444-444444444442','33333333-3333-4333-8333-333333333330','custom',200),
  ('44444444-4444-4444-8444-444444444442','33333333-3333-4333-8333-333333333331','custom',100),
  ('44444444-4444-4444-8444-444444444442','33333333-3333-4333-8333-333333333332','custom',100),
  ('44444444-4444-4444-8444-444444444442','33333333-3333-4333-8333-333333333333','custom',20),
  ('44444444-4444-4444-8444-444444444443','33333333-3333-4333-8333-333333333330','custom',300),
  ('44444444-4444-4444-8444-444444444443','33333333-3333-4333-8333-333333333331','custom',100),
  ('44444444-4444-4444-8444-444444444443','33333333-3333-4333-8333-333333333332','custom',200),
  ('44444444-4444-4444-8444-444444444443','33333333-3333-4333-8333-333333333333','custom',80),
  ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333330','custom',200),
  ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333331','custom',100),
  ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333332','custom',150),
  ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','custom',100),
  ('44444444-4444-4444-8444-444444444445','33333333-3333-4333-8333-333333333330','custom',200),
  ('44444444-4444-4444-8444-444444444445','33333333-3333-4333-8333-333333333331','custom',50),
  ('44444444-4444-4444-8444-444444444445','33333333-3333-4333-8333-333333333332','custom',100),
  ('44444444-4444-4444-8444-444444444445','33333333-3333-4333-8333-333333333333','custom',100)
on conflict (item_id, participant_id) do nothing;

insert into public.claims (
  id, expense_id, debtor_participant_id, creditor_participant_id, amount_cents,
  status, public_token_hash, sent_at, viewed_at, received_at, received_by_user_id,
  last_reminded_at, reminder_count
)
values
  ('55555555-5555-4555-8555-555555555551','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333331','33333333-3333-4333-8333-333333333330',850,'received',null,now()-interval '2 days',now()-interval '1 day',now()-interval '20 hours','11111111-1111-4111-8111-111111111111',null,0),
  ('55555555-5555-4555-8555-555555555552','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333332','33333333-3333-4333-8333-333333333330',1100,'pending',repeat('b',64),now()-interval '2 days',null,null,null,null,0),
  ('55555555-5555-4555-8555-555555555553','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','33333333-3333-4333-8333-333333333330',550,'reminder_sent',repeat('c',64),now()-interval '2 days',now()-interval '1 day',null,null,now()-interval '2 hours',1)
on conflict (id) do nothing;

insert into public.claim_events (id, claim_id, actor_type, actor_user_id, event_type, created_at)
values
  ('77777777-7777-4777-8777-777777777771','55555555-5555-4555-8555-555555555551','owner','11111111-1111-4111-8111-111111111111','claim_sent',now()-interval '2 days'),
  ('77777777-7777-4777-8777-777777777772','55555555-5555-4555-8555-555555555551','debtor',null,'claim_viewed',now()-interval '1 day'),
  ('77777777-7777-4777-8777-777777777773','55555555-5555-4555-8555-555555555551','owner','11111111-1111-4111-8111-111111111111','claim_received',now()-interval '20 hours'),
  ('77777777-7777-4777-8777-777777777774','55555555-5555-4555-8555-555555555552','debtor',null,'claim_viewed',now()-interval '1 day'),
  ('77777777-7777-4777-8777-777777777775','55555555-5555-4555-8555-555555555552','owner','11111111-1111-4111-8111-111111111111','claim_sent',now()-interval '2 days'),
  ('77777777-7777-4777-8777-777777777776','55555555-5555-4555-8555-555555555553','owner','11111111-1111-4111-8111-111111111111','claim_sent',now()-interval '2 days'),
  ('77777777-7777-4777-8777-777777777777','55555555-5555-4555-8555-555555555553','owner','11111111-1111-4111-8111-111111111111','reminder_sent',now()-interval '2 hours')
on conflict (id) do nothing;

insert into public.receipt_scan_jobs (
  id, expense_id, provider, status, confidence, warnings, started_at, completed_at
)
values (
  '66666666-6666-4666-8666-666666666666', '22222222-2222-4222-8222-222222222222',
  'mock', 'completed', 0.95, '[]', now()-interval '2 days', now()-interval '2 days'+interval '2 seconds'
)
on conflict (id) do nothing;

insert into public.usage_counters (user_id, period_start, ocr_scans_used, reminders_sent)
values ('11111111-1111-4111-8111-111111111111', date_trunc('month', now())::date, 1, 0)
on conflict (user_id, period_start) do update set ocr_scans_used = 1;

commit;
