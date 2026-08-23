begin;
select plan(23);

-- Exact elevated connector and browser-facing privilege boundary.
select ok(has_function_privilege('service_role', 'public.ingest_mail_intake_item(text,text,text,timestamptz,text,text,text,text,jsonb,jsonb)', 'execute'), 'service_role can execute ingest'); -- 1
select ok(not has_function_privilege('service_role', 'public.list_mail_intake_items(uuid)', 'execute'), 'service_role cannot execute list'); -- 2
select ok(not has_function_privilege('service_role', 'public.dismiss_mail_intake_item(uuid,uuid,bigint)', 'execute'), 'service_role cannot execute dismiss'); -- 3
select ok(not has_table_privilege('service_role', 'app_private.mail_intake_items', 'select'), 'service_role cannot directly select intake rows'); -- 4
select ok(not has_table_privilege('service_role', 'app_private.mail_intake_items', 'insert'), 'service_role cannot directly insert intake rows'); -- 5
select ok(not has_table_privilege('service_role', 'app_private.mail_intake_items', 'update'), 'service_role cannot directly update intake rows'); -- 6
select ok(not has_table_privilege('service_role', 'app_private.mail_intake_items', 'delete'), 'service_role cannot directly delete intake rows'); -- 7
select ok(not has_table_privilege('service_role', 'app_private.mail_intake_items', 'truncate'), 'service_role cannot truncate intake rows'); -- 8
select ok(has_function_privilege('authenticated', 'public.list_mail_intake_items(uuid)', 'execute'), 'authenticated retains list execute'); -- 9
select ok(has_function_privilege('authenticated', 'public.dismiss_mail_intake_item(uuid,uuid,bigint)', 'execute'), 'authenticated retains dismiss execute'); -- 10
select ok(not has_function_privilege('authenticated', 'public.ingest_mail_intake_item(text,text,text,timestamptz,text,text,text,text,jsonb,jsonb)', 'execute'), 'authenticated cannot execute ingest'); -- 11
select ok(not has_function_privilege('anon', 'public.ingest_mail_intake_item(text,text,text,timestamptz,text,text,text,text,jsonb,jsonb)', 'execute'), 'anon cannot execute ingest'); -- 12
select ok(not has_function_privilege('anon', 'public.list_mail_intake_items(uuid)', 'execute'), 'anon cannot execute list'); -- 13
select ok(not has_function_privilege('anon', 'public.dismiss_mail_intake_item(uuid,uuid,bigint)', 'execute'), 'anon cannot execute dismiss'); -- 14

set local role service_role;
select lives_ok(
  $$select set_config('mail_hardening.item_id', public.ingest_mail_intake_item(
    'hardening', 'mailbox-opaque-hardening', 'message-hardening',
    '2026-08-21 02:00:00+00', 'Hardening subject'
  )::text, true)$$,
  'service_role can execute valid ingest through SECURITY DEFINER defaults'
); -- 15
select isnt(current_setting('mail_hardening.item_id', true), '', 'service_role ingest returns an internal UUID'); -- 16
select throws_like(
  $$select * from app_private.mail_intake_items$$,
  '%permission denied%',
  'service_role direct-table operation is denied'
); -- 17
select throws_like(
  $$select * from public.list_mail_intake_items('00000000-0000-0000-0000-000000000321')$$,
  '%permission denied%',
  'service_role invocation of list is denied'
); -- 18
select throws_like(
  $$select public.dismiss_mail_intake_item('00000000-0000-0000-0000-000000000321', current_setting('mail_hardening.item_id')::uuid, 1)$$,
  '%permission denied%',
  'service_role invocation of dismiss is denied'
); -- 19
reset role;

-- Existing BUYER positive and TRADER denial contracts remain intact.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-000000000031', 'buyer@mail-hardening.test', '{}', '{}'),
  ('00000000-0000-0000-0000-000000000032', 'trader@mail-hardening.test', '{}', '{}');

update app_private.user_accounts set status = 'active'
where user_id in (
  '00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-000000000032'
);

insert into app_private.organizations (id, kind, name, status) values
  ('00000000-0000-0000-0000-000000000131', 'buyer', 'Hardening Buyer', 'active'),
  ('00000000-0000-0000-0000-000000000132', 'trader', 'Hardening Trader', 'active');

insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values
  ('00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000131', 'buyer_admin', 'active'),
  ('00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000132', 'trader', 'active');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000031', true);
select is(
  (select count(*) from public.list_mail_intake_items('00000000-0000-0000-0000-000000000231') where id = current_setting('mail_hardening.item_id')::uuid),
  1::bigint,
  'active BUYER retains pending-list access'
); -- 20
select is(
  (public.dismiss_mail_intake_item('00000000-0000-0000-0000-000000000231', current_setting('mail_hardening.item_id')::uuid, 1)).revision,
  2::bigint,
  'active BUYER retains revision-checked dismiss access'
); -- 21
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000032', true);
select throws_ok(
  $$select * from public.list_mail_intake_items('00000000-0000-0000-0000-000000000232')$$,
  '42501',
  'An active BUYER membership is required',
  'active TRADER remains denied list access'
); -- 22
select throws_ok(
  $$select public.dismiss_mail_intake_item('00000000-0000-0000-0000-000000000232', current_setting('mail_hardening.item_id')::uuid, 2)$$,
  '42501',
  'An active BUYER membership is required',
  'active TRADER remains denied dismiss access'
); -- 23
reset role;

select * from finish();
rollback;
