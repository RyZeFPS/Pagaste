begin;

create extension if not exists pgtap with schema extensions;
select plan(86);

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'expenses', 'expenses exists');
select has_table('public', 'claims', 'claims exists');
select has_table('public', 'group_invites', 'group invites exist');
select has_table('public', 'app_notifications', 'app notifications exist');
select has_column('public', 'profiles', 'payment_phone_e164', 'profile payment phone exists');
select has_column('public', 'profiles', 'share_payment_phone', 'profile phone consent exists');
select has_trigger('public', 'groups', 'on_group_created_add_owner', 'new groups automatically add their owner member');

select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'profiles has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.expenses'::regclass), 'expenses has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.claims'::regclass), 'claims has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.push_tokens'::regclass), 'push tokens have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.app_notifications'::regclass), 'app notifications have RLS');
select ok((
  select count(*) = 16 and bool_and(c.relrowsecurity)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname::text = any(array[
    'profiles', 'groups', 'group_members', 'expenses', 'expense_participants',
    'expense_items', 'item_allocations', 'claims', 'claim_events', 'claim_disputes',
    'receipt_scan_jobs', 'push_tokens', 'push_delivery_logs', 'usage_counters', 'group_invites',
    'app_notifications'
  ])
), 'every exposed Pagaste table has RLS');
select policies_are(
  'public',
  'app_notifications',
  array['app_notifications_select_own', 'app_notifications_update_own'],
  'app notifications expose only own-row policies'
);
select has_trigger(
  'public',
  'claims',
  'claims_create_requested_notification',
  'new linked claims create a durable notification'
);

select ok(not has_table_privilege('anon', 'public.claims', 'select'), 'anon cannot select claims');
select ok(not has_table_privilege('anon', 'public.expense_participants', 'select'), 'anon cannot select participants');
select ok(has_table_privilege('authenticated', 'public.expenses', 'select'), 'authenticated has Data API table grant');
select ok(not has_function_privilege('anon', 'public.get_public_claim_payload(text)', 'execute'), 'anon cannot call privileged public-claim RPC');
select ok(has_function_privilege('service_role', 'public.get_public_claim_payload(text)', 'execute'), 'service role can call public-claim RPC');

select has_function('public', 'create_claims_transaction', array['uuid', 'jsonb'], 'claim creation RPC exists');
select has_function('public', 'consume_endpoint_rate_limit', array['text', 'text', 'integer', 'integer'], 'rate-limit RPC exists');
select has_function('public', 'reserve_ocr_scan', array['uuid'], 'OCR quota reservation RPC exists');
select has_function(
  'public',
  'mark_claim_received',
  array['uuid', 'uuid'],
  'receiver can record a claim as received through the service RPC'
);
select has_function(
  'public',
  'request_claim_payment_check',
  array['uuid', 'uuid'],
  'debtor can request a bank-check notification through the service RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.request_claim_payment_check(uuid,uuid)',
    'execute'
  ),
  'service role can request a bank-check notification'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.request_claim_payment_check(uuid,uuid)',
    'execute'
  ),
  'authenticated clients cannot spoof bank-check notification actors'
);
select ok(
  to_regprocedure('public.confirm_claim_payment(uuid)') is null
    and to_regprocedure('public.reject_claim_payment(uuid)') is null
    and to_regprocedure('public.mark_claim_paid_by_token(text,text,text,uuid)') is null,
  'payer-paid and double-confirmation RPCs are removed'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.mark_claim_received(uuid,uuid)',
    'execute'
  )
    and not has_function_privilege(
      'authenticated',
      'public.mark_claim_received(uuid,uuid)',
      'execute'
    ),
  'only the service role can call the receiver-recording RPC'
);
select is(
  (select enum_range(null::public.claim_status)::text),
  '{pending,received,reminder_sent,disputed,cancelled}',
  'claim statuses are the five definitive states'
);
select has_function(
  'public',
  'resolve_claim_dispute_transaction',
  array['uuid', 'text', 'text'],
  'dispute resolution RPC exists'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.resolve_claim_dispute_transaction(uuid,text,text)',
    'execute'
  ),
  'authenticated can execute dispute resolution RPC'
);
select has_function('public', 'archive_expense', array['uuid'], 'expense archive RPC exists');
select has_function(
  'public',
  'repeat_expense',
  array['uuid'],
  'expense repetition RPC exists'
);
select has_function(
  'public',
  'update_repeated_expense_item',
  array['uuid', 'uuid', 'bigint', 'jsonb'],
  'repeated item price RPC exists'
);
select has_function(
  'public',
  'delete_repeated_expense_item',
  array['uuid', 'uuid'],
  'repeated item deletion RPC exists'
);
select ok(
  has_function_privilege('authenticated', 'public.repeat_expense(uuid)', 'execute')
    and has_function_privilege(
      'authenticated',
      'public.update_repeated_expense_item(uuid,uuid,bigint,jsonb)',
      'execute'
    )
    and has_function_privilege(
      'authenticated',
      'public.delete_repeated_expense_item(uuid,uuid)',
      'execute'
    )
    and not (
      select prosecdef
      from pg_proc
      where oid = 'public.repeat_expense(uuid)'::regprocedure
    ),
  'repeat expense RPCs are authenticated and the clone keeps caller RLS'
);
select has_function('public', 'accept_group_invite_transaction', array['text'], 'invite acceptance RPC exists');
select has_function(
  'public',
  'delete_account_data_transaction',
  array['uuid'],
  'account deletion RPC exists'
);
select ok(
  not has_function_privilege('anon', 'public.delete_account_data_transaction(uuid)', 'execute'),
  'anon cannot execute account deletion RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.delete_account_data_transaction(uuid)',
    'execute'
  ),
  'authenticated cannot execute account deletion RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.delete_account_data_transaction(uuid)',
    'execute'
  ),
  'service role can execute account deletion RPC'
);
select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'insert'),
  'authenticated users cannot recreate a deleted profile'
);

select is(
  (select public from storage.buckets where id = 'receipts'),
  false,
  'receipts bucket is private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'receipts'),
  10485760::bigint,
  'receipts bucket is limited to 10 MiB'
);

insert into public.groups (id, owner_id, name, type, currency)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'Plantillas semanales',
  'friends',
  'EUR'
);
update public.expenses
set
  group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  archived_at = now(),
  payer_member_id = (
    select id
    from public.group_members
    where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and user_id = '11111111-1111-4111-8111-111111111111'
  )
where id = '22222222-2222-4222-8222-222222222222';
update public.expense_participants
set email = 'ferran@example.com', phone_e164 = '+34600123456'
where id = '33333333-3333-4333-8333-333333333331';

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', current_setting('request.jwt.claim.sub'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;
select lives_ok(
  $$select public.repeat_expense('22222222-2222-4222-8222-222222222222')$$,
  'owner can repeat an archived completed expense transactionally'
);
select ok(
  (
    select
      status = 'draft'
      and scan_status = 'idle'
      and receipt_path is null
      and sent_at is null
      and group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and payer_member_id is not null
      and total_cents = 4000
      and recoverable_cents = 0
      and own_share_cents = 4000
    from public.expenses
    where created_by = auth.uid()
      and id <> '22222222-2222-4222-8222-222222222222'
      and title = 'Cena del viernes'
    order by created_at desc
    limit 1
  ),
  'repeated expense reuses metadata but resets receipt and collection state'
);
select ok(
  (
    select
      count(*) = 4
      and bool_or(
        display_name = 'Ferran'
        and email = 'ferran@example.com'
        and phone_e164 = '+34600123456'
      )
      and count(*) filter (where is_payer) = 1
    from public.expense_participants
    where expense_id = (
      select id
      from public.expenses
      where created_by = auth.uid()
        and id <> '22222222-2222-4222-8222-222222222222'
        and title = 'Cena del viernes'
      order by created_at desc
      limit 1
    )
  ),
  'repeated expense reuses participants and their contact method'
);
select ok(
  (
    select count(*) = 6 and sum(line_total_cents) = 4000 and bool_and(source = 'manual')
    from public.expense_items
    where expense_id = (
      select id
      from public.expenses
      where created_by = auth.uid()
        and id <> '22222222-2222-4222-8222-222222222222'
        and title = 'Cena del viernes'
      order by created_at desc
      limit 1
    )
  ),
  'repeated expense copies every product as editable template data'
);
select ok(
  (
    select (
      select jsonb_agg(
        jsonb_build_array(
          item.name,
          participant.display_name,
          allocation.method,
          allocation.shares,
          allocation.percentage,
          allocation.units,
          allocation.amount_cents
        )
        order by item.name, participant.display_name
      )
      from public.item_allocations allocation
      join public.expense_items item on item.id = allocation.item_id
      join public.expense_participants participant on participant.id = allocation.participant_id
      where item.expense_id = '22222222-2222-4222-8222-222222222222'
    ) = (
      select jsonb_agg(
        jsonb_build_array(
          item.name,
          participant.display_name,
          allocation.method,
          allocation.shares,
          allocation.percentage,
          allocation.units,
          allocation.amount_cents
        )
        order by item.name, participant.display_name
      )
      from public.item_allocations allocation
      join public.expense_items item on item.id = allocation.item_id
      join public.expense_participants participant on participant.id = allocation.participant_id
      where item.expense_id = (
        select id
        from public.expenses
        where created_by = auth.uid()
          and id <> '22222222-2222-4222-8222-222222222222'
          and title = 'Cena del viernes'
        order by created_at desc
        limit 1
      )
    )
  ),
  'repeated expense keeps product assignments, split type and split metadata'
);
select is(
  (
    select count(*)
    from public.claims
    where expense_id = (
      select id
      from public.expenses
      where created_by = auth.uid()
        and id <> '22222222-2222-4222-8222-222222222222'
        and title = 'Cena del viernes'
      order by created_at desc
      limit 1
    )
  ),
  0::bigint,
  'repeated expense never copies claims or public links'
);
select lives_ok(
  $$select public.update_repeated_expense_item(
      (
        select id
        from public.expenses
        where created_by = auth.uid()
          and id <> '22222222-2222-4222-8222-222222222222'
          and title = 'Cena del viernes'
        order by created_at desc
        limit 1
      ),
      (
        select item.id
        from public.expense_items item
        join public.expenses expense on expense.id = item.expense_id
        where expense.created_by = auth.uid()
          and expense.id <> '22222222-2222-4222-8222-222222222222'
          and expense.title = 'Cena del viernes'
          and item.name = 'Pizza'
        order by expense.created_at desc
        limit 1
      ),
      1300,
      (
        select jsonb_agg(
          jsonb_build_object(
            'participant_id', participant.id,
            'method', 'custom',
            'shares', null,
            'percentage', null,
            'units', null,
            'amount_cents', case participant.display_name
              when 'Alex' then 375
              when 'Ferran' then 325
              when 'David' then 375
              else 225
            end
          )
        )
        from public.expense_participants participant
        where participant.expense_id = (
          select id
          from public.expenses
          where created_by = auth.uid()
            and id <> '22222222-2222-4222-8222-222222222222'
            and title = 'Cena del viernes'
          order by created_at desc
          limit 1
        )
      )
    )$$,
  'owner can change a repeated product price and allocations atomically'
);
select ok(
  (
    select expense.total_cents = 4100
      and item.line_total_cents = 1300
      and (
        select sum(allocation.amount_cents)
        from public.item_allocations allocation
        where allocation.item_id = item.id
      ) = 1300
      and (
        select bool_and(allocation.method = 'custom')
        from public.item_allocations allocation
        where allocation.item_id = item.id
      )
    from public.expenses expense
    join public.expense_items item on item.expense_id = expense.id and item.name = 'Pizza'
    where expense.created_by = auth.uid()
      and expense.id <> '22222222-2222-4222-8222-222222222222'
      and expense.title = 'Cena del viernes'
    order by expense.created_at desc
    limit 1
  ),
  'changing a repeated price preserves its split and recalculates the expense total'
);
select lives_ok(
  $$select public.delete_repeated_expense_item(
      (
        select id
        from public.expenses
        where created_by = auth.uid()
          and id <> '22222222-2222-4222-8222-222222222222'
          and title = 'Cena del viernes'
        order by created_at desc
        limit 1
      ),
      (
        select item.id
        from public.expense_items item
        join public.expenses expense on expense.id = item.expense_id
        where expense.created_by = auth.uid()
          and expense.id <> '22222222-2222-4222-8222-222222222222'
          and expense.title = 'Cena del viernes'
          and item.name = 'Café'
        order by expense.created_at desc
        limit 1
      )
    )$$,
  'owner can remove a repeated product atomically'
);
select ok(
  (
    select total_cents = 3650
      and not exists (
        select 1
        from public.expense_items item
        where item.expense_id = expense.id and item.name = 'Café'
      )
    from public.expenses expense
    where created_by = auth.uid()
      and id <> '22222222-2222-4222-8222-222222222222'
      and title = 'Cena del viernes'
    order by created_at desc
    limit 1
  ),
  'removing a repeated product recalculates its total'
);
select ok(
  (
    select total_cents = 4000
      and (
        select line_total_cents
        from public.expense_items
        where expense_id = expense.id and name = 'Pizza'
      ) = 1200
      and (
        select count(*)
        from public.expense_items
        where expense_id = expense.id
      ) = 6
    from public.expenses expense
    where id = '22222222-2222-4222-8222-222222222222'
  ),
  'editing the repeated draft never mutates its source expense'
);
reset role;

select lives_ok(
  $$insert into public.expense_items (
      expense_id, name, quantity, unit_price_cents, line_total_cents, source
    )
    select id, 'Descuento test', 1, -100, -100, 'adjustment'
    from public.expenses where title = 'Cena del viernes' limit 1$$,
  'signed adjustment amounts are accepted'
);

select lives_ok(
  $$insert into public.item_allocations (item_id, participant_id, method, amount_cents)
    select i.id, p.id, 'custom', -100
    from public.expense_items i
    join public.expense_participants p on p.expense_id = i.expense_id and p.is_payer
    where i.name = 'Descuento test'
    limit 1$$,
  'signed adjustment allocations are accepted'
);

select throws_ok(
  $$insert into public.expense_items (
      expense_id, name, quantity, line_total_cents, source
    )
    select id, 'Importe cero', 1, 0, 'manual'
    from public.expenses where title = 'Cena del viernes' limit 1$$,
  '23514',
  null,
  'zero-value lines are rejected'
);

update public.claims c
set status = 'disputed'
from public.expense_participants debtor, public.expenses e
where debtor.id = c.debtor_participant_id
  and e.id = c.expense_id
  and debtor.display_name = 'David'
  and e.title = 'Cena del viernes';
update public.claims c
set status = 'disputed'
from public.expense_participants debtor, public.expenses e
where debtor.id = c.debtor_participant_id
  and e.id = c.expense_id
  and debtor.display_name = 'Marta'
  and e.title = 'Cena del viernes';
insert into public.claim_disputes (claim_id, reason, message)
select c.id, 'incorrect_amount', 'Prueba de ciclo'
from public.claims c
join public.expense_participants debtor on debtor.id = c.debtor_participant_id
join public.expenses e on e.id = c.expense_id
where debtor.display_name = 'David' and e.title = 'Cena del viernes';
insert into public.claim_disputes (claim_id, reason, message)
select c.id, 'already_paid', 'Prueba de revocación'
from public.claims c
join public.expense_participants debtor on debtor.id = c.debtor_participant_id
join public.expenses e on e.id = c.expense_id
where debtor.display_name = 'Marta' and e.title = 'Cena del viernes';
select set_config(
  'request.jwt.claim.sub',
  (select id::text from public.profiles where display_name = 'Alex' limit 1),
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', current_setting('request.jwt.claim.sub'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;
select lives_ok(
  $$insert into public.groups (owner_id, name, type, currency)
    values (auth.uid(), 'Grupo RETURNING', 'other', 'EUR')
    returning id$$,
  'group owners can create a group and receive its representation'
);
select lives_ok(
  $$insert into public.expenses (
      created_by, title, currency, total_cents, recoverable_cents,
      own_share_cents, status, scan_status
    )
    values (auth.uid(), 'Gasto RETURNING', 'EUR', 100, 0, 100, 'draft', 'idle')
    returning id$$,
  'expense owners can create an expense and receive its representation'
);
select lives_ok(
  $$select public.resolve_claim_dispute_transaction(
      (select c.id
       from public.claims c
       join public.expense_participants debtor on debtor.id = c.debtor_participant_id
       where debtor.display_name = 'David'
       limit 1),
      'reopen'
    )$$,
  'owner can resolve and reopen a disputed claim'
);
select is(
  (select c.status::text
   from public.claims c
   join public.expense_participants debtor on debtor.id = c.debtor_participant_id
   where debtor.display_name = 'David'
   limit 1),
  'pending',
  'resolved claim returns to pending when it has no reminder'
);
select is(
  (select d.status::text
   from public.claim_disputes d
   join public.claims c on c.id = d.claim_id
   join public.expense_participants debtor on debtor.id = c.debtor_participant_id
   where debtor.display_name = 'David'
   order by d.created_at desc
   limit 1),
  'resolved',
  'open dispute is marked resolved'
);
select lives_ok(
  $$select public.revoke_claim_transaction(
      (select c.id
       from public.claims c
       join public.expense_participants debtor on debtor.id = c.debtor_participant_id
       where debtor.display_name = 'Marta'
       limit 1)
    )$$,
  'owner can revoke a disputed claim'
);
select is(
  (select c.status::text
   from public.claims c
   join public.expense_participants debtor on debtor.id = c.debtor_participant_id
   where debtor.display_name = 'Marta'
   limit 1),
  'cancelled',
  'revoked disputed claim is cancelled'
);
select is(
  (select d.status::text
   from public.claim_disputes d
   join public.claims c on c.id = d.claim_id
   join public.expense_participants debtor on debtor.id = c.debtor_participant_id
   where debtor.display_name = 'Marta'
   order by d.created_at desc
   limit 1),
  'dismissed',
  'revocation closes the open dispute'
);
reset role;
update public.expenses
set archived_at = null
where id = '22222222-2222-4222-8222-222222222222';

set local role authenticated;
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', current_setting('request.jwt.claim.sub'), 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$select public.repeat_expense('22222222-2222-4222-8222-222222222222')$$,
  '42501',
  'EXPENSE_REPEAT_FORBIDDEN',
  'an unrelated authenticated user cannot repeat another owner expense'
);
select is((select count(*) from public.claims), 0::bigint, 'unrelated authenticated user cannot read claims');
select is((select count(*) from public.expenses), 0::bigint, 'unrelated authenticated user cannot read expenses');
reset role;

select is(
  (select sum(amount_cents) from public.claims where expense_id = (
    select id from public.expenses where title = 'Cena del viernes' limit 1
  )),
  2500::bigint,
  'seed claim totals are exact cents'
);
select is(
  (select sum(line_total_cents) from public.expense_items where expense_id = (
    select id from public.expenses where title = 'Cena del viernes' limit 1
  ) and name <> 'Descuento test'),
  4000::bigint,
  'seed receipt line totals are exact cents'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
values (
  '00000000-0000-0000-0000-000000000000',
  '88888888-8888-4888-8888-888888888888',
  'authenticated', 'authenticated', 'successor@pagaste.local',
  extensions.crypt('local-test-only', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Sucesora"}'::jsonb,
  now(), now(), '', '', '', ''
);

insert into public.groups (id, owner_id, name)
values
  ('99999999-9999-4999-8999-999999999991', '11111111-1111-4111-8111-111111111111', 'Grupo compartido'),
  ('99999999-9999-4999-8999-999999999992', '11111111-1111-4111-8111-111111111111', 'Grupo privado');
insert into public.group_members (group_id, user_id, display_name, email, role, status)
values (
  '99999999-9999-4999-8999-999999999991',
  '88888888-8888-4888-8888-888888888888',
  'Sucesora',
  'successor@pagaste.local',
  'admin',
  'active'
);

select set_config(
  'request.jwt.claim.sub',
  '88888888-8888-4888-8888-888888888888',
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', current_setting('request.jwt.claim.sub'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;
select is(
  (
    select count(*)
    from public.group_members
    where group_id = '99999999-9999-4999-8999-999999999991'
  ),
  2::bigint,
  'active group members can read every member in their shared group'
);
reset role;

insert into public.expenses (
  id, created_by, title, total_cents, recoverable_cents, own_share_cents, status
)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '11111111-1111-4111-8111-111111111111',
  'Gasto privado borrable',
  0, 0, 0, 'draft'
);
insert into public.expense_participants (
  id, expense_id, user_id, display_name, is_payer
)
values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '11111111-1111-4111-8111-111111111111',
  'Alex',
  true
);
update public.expenses
set payer_participant_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

select throws_ok(
  $$delete from auth.users where id = '11111111-1111-4111-8111-111111111111'$$,
  '23503',
  null,
  'direct Auth deletion is blocked until account data is prepared'
);

set local role service_role;
select lives_ok(
  $$select public.delete_account_data_transaction(
      '11111111-1111-4111-8111-111111111111'
    )$$,
  'service role can delete account data transactionally'
);
select is(
  (select count(*) from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  0::bigint,
  'profile is deleted'
);
select ok(
  (select created_by is null from public.expenses where id = '22222222-2222-4222-8222-222222222222'),
  'shared expense is preserved without account ownership'
);
select ok(
  (select user_id is null and display_name = 'Usuario eliminado'
   from public.expense_participants
   where id = '33333333-3333-4333-8333-333333333330'),
  'shared participant snapshot is anonymized'
);
select is(
  (select owner_id from public.groups where id = '99999999-9999-4999-8999-999999999991'),
  '88888888-8888-4888-8888-888888888888'::uuid,
  'shared group is transferred to its active admin'
);
select is(
  (select count(*) from public.groups where id = '99999999-9999-4999-8999-999999999992'),
  0::bigint,
  'group without a successor is deleted'
);
select is(
  (select count(*) from public.expenses where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0::bigint,
  'unshared draft expense is deleted'
);
select is(
  (select count(*) from public.claim_events
   where actor_user_id = '11111111-1111-4111-8111-111111111111'),
  0::bigint,
  'claim event actor references are anonymized'
);
select ok(
  (select status = 'cancelled' and public_token_hash is null
   from public.claims where id = '55555555-5555-4555-8555-555555555552'),
  'active creditor claim is cancelled and its bearer token revoked'
);
select ok(
  (select status = 'received' and public_token_hash is null
   from public.claims where id = '55555555-5555-4555-8555-555555555551'),
  'received shared claim is preserved with public access revoked'
);
select lives_ok(
  $$select public.delete_account_data_transaction(
      '11111111-1111-4111-8111-111111111111'
    )$$,
  'account data deletion RPC is idempotent after profile removal'
);
reset role;

select * from finish();
rollback;
