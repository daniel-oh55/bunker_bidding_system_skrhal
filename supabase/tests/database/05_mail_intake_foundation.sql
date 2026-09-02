begin;
select plan(95);

-- Schema, constraints, result shape, and privilege boundary.
select has_type('app_private', 'mail_intake_status', 'mail intake status type exists'); -- 1
select is(
  (select array_agg(enum.enumlabel order by enum.enumsortorder) from pg_enum as enum where enum.enumtypid = 'app_private.mail_intake_status'::regtype),
  array['pending', 'dismissed']::name[],
  'mail intake status values are exact'
); -- 2
select has_table('app_private', 'mail_intake_items', 'private mail intake table exists'); -- 3
select columns_are(
  'app_private',
  'mail_intake_items',
  array[
    'id', 'source_provider', 'source_mailbox_key', 'source_message_id', 'received_at', 'subject',
    'vessel_voyage', 'port_name', 'delivery_window', 'fuel_items', 'warnings', 'status', 'revision',
    'created_at', 'updated_at', 'dismissed_at', 'dismissed_by_user_id', 'dismissed_by_membership_id',
    'converted_bid_id', 'converted_at', 'converted_by_user_id', 'converted_by_membership_id'
  ],
  'mail intake table has only the normalized contract columns'
); -- 4
select ok((select relrowsecurity from pg_class where oid = 'app_private.mail_intake_items'::regclass), 'mail intake table has RLS enabled'); -- 5

select ok(not has_table_privilege('anon', 'app_private.mail_intake_items', 'select'), 'anon cannot select intake rows'); -- 6
select ok(not has_table_privilege('anon', 'app_private.mail_intake_items', 'insert'), 'anon cannot insert intake rows'); -- 7
select ok(not has_table_privilege('anon', 'app_private.mail_intake_items', 'update'), 'anon cannot update intake rows'); -- 8
select ok(not has_table_privilege('anon', 'app_private.mail_intake_items', 'delete'), 'anon cannot delete intake rows'); -- 9
select ok(not has_table_privilege('authenticated', 'app_private.mail_intake_items', 'select'), 'authenticated cannot select intake rows'); -- 10
select ok(not has_table_privilege('authenticated', 'app_private.mail_intake_items', 'insert'), 'authenticated cannot insert intake rows'); -- 11
select ok(not has_table_privilege('authenticated', 'app_private.mail_intake_items', 'update'), 'authenticated cannot update intake rows'); -- 12
select ok(not has_table_privilege('authenticated', 'app_private.mail_intake_items', 'delete'), 'authenticated cannot delete intake rows'); -- 13

select has_index('app_private', 'mail_intake_items', 'mail_intake_items_source_identity_key', 'source identity has a database unique boundary'); -- 14
select ok(exists(select 1 from pg_constraint where conrelid = 'app_private.mail_intake_items'::regclass and conname = 'mail_intake_items_status_consistency'), 'status consistency is constrained'); -- 15
select ok(exists(select 1 from pg_constraint where conrelid = 'app_private.mail_intake_items'::regclass and conname = 'mail_intake_items_fuel_items_valid'), 'fuel item shape is constrained'); -- 16
select ok(exists(select 1 from pg_constraint where conrelid = 'app_private.mail_intake_items'::regclass and conname = 'mail_intake_items_warnings_valid'), 'warning shape is constrained'); -- 17

select ok((select prosecdef from pg_proc where oid = 'public.ingest_mail_intake_item(text,text,text,timestamptz,text,text,text,text,jsonb,jsonb)'::regprocedure), 'ingest RPC is SECURITY DEFINER'); -- 18
select is((select proconfig from pg_proc where oid = 'public.ingest_mail_intake_item(text,text,text,timestamptz,text,text,text,text,jsonb,jsonb)'::regprocedure), array['search_path=""']::text[], 'ingest RPC fixes an empty search path'); -- 19
select ok((select prosecdef from pg_proc where oid = 'public.list_mail_intake_items(uuid)'::regprocedure), 'list RPC is SECURITY DEFINER'); -- 20
select is((select proconfig from pg_proc where oid = 'public.list_mail_intake_items(uuid)'::regprocedure), array['search_path=""']::text[], 'list RPC fixes an empty search path'); -- 21
select ok((select prosecdef from pg_proc where oid = 'public.dismiss_mail_intake_item(uuid,uuid,bigint)'::regprocedure), 'dismiss RPC is SECURITY DEFINER'); -- 22
select is((select proconfig from pg_proc where oid = 'public.dismiss_mail_intake_item(uuid,uuid,bigint)'::regprocedure), array['search_path=""']::text[], 'dismiss RPC fixes an empty search path'); -- 23

select ok(not has_function_privilege('anon', 'public.ingest_mail_intake_item(text,text,text,timestamptz,text,text,text,text,jsonb,jsonb)', 'execute'), 'anon cannot execute ingest'); -- 24
select ok(not has_function_privilege('authenticated', 'public.ingest_mail_intake_item(text,text,text,timestamptz,text,text,text,text,jsonb,jsonb)', 'execute'), 'authenticated cannot execute ingest'); -- 25
select ok(has_function_privilege('service_role', 'public.ingest_mail_intake_item(text,text,text,timestamptz,text,text,text,text,jsonb,jsonb)', 'execute'), 'service_role can execute ingest'); -- 26
select ok(not has_function_privilege('public', 'public.ingest_mail_intake_item(text,text,text,timestamptz,text,text,text,text,jsonb,jsonb)', 'execute'), 'PUBLIC cannot execute ingest'); -- 27
select ok(has_function_privilege('authenticated', 'public.list_mail_intake_items(uuid)', 'execute'), 'authenticated can execute the reviewed list RPC'); -- 28
select ok(has_function_privilege('authenticated', 'public.dismiss_mail_intake_item(uuid,uuid,bigint)', 'execute'), 'authenticated can execute the reviewed dismiss RPC'); -- 29
select ok(not has_function_privilege('anon', 'public.list_mail_intake_items(uuid)', 'execute'), 'anon cannot execute list'); -- 30
select ok(not has_function_privilege('anon', 'public.dismiss_mail_intake_item(uuid,uuid,bigint)', 'execute'), 'anon cannot execute dismiss'); -- 31
select ok(not has_function_privilege('authenticated', 'app_private.mail_intake_result(uuid)', 'execute'), 'authenticated cannot execute the private result helper'); -- 32

select is(
  (select array_agg(attribute.attname order by attribute.attnum)
   from pg_attribute as attribute
   where attribute.attrelid = 'app_private.mail_intake_api_result'::regclass and attribute.attnum > 0 and not attribute.attisdropped),
  array['id', 'received_at', 'subject', 'vessel_voyage', 'port_name', 'delivery_window', 'fuel_items', 'warnings', 'status', 'revision', 'created_at', 'updated_at', 'dismissed_at']::name[],
  'BUYER result contains only the narrow fields'
); -- 33
select ok(not exists(select 1 from pg_attribute where attrelid = 'app_private.mail_intake_api_result'::regclass and attname = 'source_message_id' and attnum > 0), 'BUYER result excludes source_message_id'); -- 34
select ok(not exists(select 1 from pg_attribute where attrelid = 'app_private.mail_intake_api_result'::regclass and attname = 'source_mailbox_key' and attnum > 0), 'BUYER result excludes source_mailbox_key'); -- 35
select ok(not exists(select 1 from pg_attribute where attrelid = 'app_private.mail_intake_api_result'::regclass and attname = 'source_provider' and attnum > 0), 'BUYER result excludes source_provider'); -- 36
select ok(not exists(select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'mail_intake_items' and column_name ~ '(raw|body|html|attachment)'), 'intake storage has no raw body, HTML, or attachment column'); -- 37
select ok(not exists(select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'mail_intake_items' and column_name ~ '(sender|recipient|cc|bcc|address|email)'), 'intake storage has no sender, recipient, or address column'); -- 38
select ok(not exists(select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'mail_intake_items' and column_name ~ '(deadline|responsible)'), 'intake storage has no deadline or responsible-BUYER column'); -- 39
select ok(not exists(select 1 from pg_attribute where attrelid = 'app_private.mail_intake_api_result'::regclass and attnum > 0 and not attisdropped and attname ~ '(source|converted|bid|actor|membership)'), 'BUYER queue result excludes source identity and conversion linkage'); -- 40

-- Execute grants are proven with actual caller roles.
set local role anon;
select throws_like(
  $$select public.ingest_mail_intake_item('graph', 'mailbox-1', 'anon-1', clock_timestamp(), 'Subject')$$,
  '%permission denied%',
  'anon invocation of ingest is denied'
); -- 41
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', true);
select throws_like(
  $$select public.ingest_mail_intake_item('graph', 'mailbox-1', 'auth-1', clock_timestamp(), 'Subject')$$,
  '%permission denied%',
  'authenticated invocation of ingest is denied'
); -- 42
reset role;

set local role service_role;
select lives_ok(
  $$select set_config('mail_test.main_id', public.ingest_mail_intake_item(
    ' graph ', ' mailbox-opaque-1 ', ' message-1 ', '2026-08-21 01:00:00+00', ' Main subject ',
    ' Vessel / Voyage ', ' Busan ', ' 1-3 September ',
    '[{"grade":"vlsfo","quantity":100},{"grade":"lsmgo","quantity":25.5}]'::jsonb,
    '["Port candidate needs review"]'::jsonb
  )::text, true)$$,
  'service_role can ingest a valid normalized item'
); -- 43
select isnt(current_setting('mail_test.main_id', true), '', 'valid ingest returns an internal UUID'); -- 44
reset role;

select is((select count(*) from app_private.mail_intake_items where source_message_id = 'message-1'), 1::bigint, 'valid item inserts exactly once'); -- 45
select is(
  (select concat_ws('|', source_provider, source_mailbox_key, source_message_id, subject, vessel_voyage, port_name, delivery_window) from app_private.mail_intake_items where id = current_setting('mail_test.main_id')::uuid),
  'graph|mailbox-opaque-1|message-1|Main subject|Vessel / Voyage|Busan|1-3 September',
  'bounded scalar inputs are stored trimmed'
); -- 46
select is(
  (select status::text || '|' || revision::text from app_private.mail_intake_items where id = current_setting('mail_test.main_id')::uuid),
  'pending|1',
  'a new identity starts pending at revision one'
); -- 47

set local role service_role;
select is(
  public.ingest_mail_intake_item(
    'graph', 'mailbox-opaque-1', 'message-1', '2026-08-22 01:00:00+00', 'Replacement subject',
    'Replacement vessel', null, null, '[{"grade":"hsfo","quantity":999}]'::jsonb, '["replacement"]'::jsonb
  )::text,
  current_setting('mail_test.main_id'),
  'exact duplicate returns the existing internal UUID'
); -- 48
reset role;
select is((select count(*) from app_private.mail_intake_items where source_provider = 'graph' and source_mailbox_key = 'mailbox-opaque-1' and source_message_id = 'message-1'), 1::bigint, 'exact duplicate does not insert another row'); -- 49
select is(
  (select subject || '|' || vessel_voyage || '|' || revision::text from app_private.mail_intake_items where id = current_setting('mail_test.main_id')::uuid),
  'Main subject|Vessel / Voyage|1',
  'duplicate ingest does not overwrite values or revision'
); -- 50

-- Defensive normalized-input validation fails closed with 22023.
set local role service_role;
select throws_ok($$select public.ingest_mail_intake_item('Graph!', 'mailbox-2', 'invalid-provider', clock_timestamp(), 'Subject')$$, '22023', 'source_provider is invalid', 'malformed provider is rejected'); -- 51
select throws_ok($$select public.ingest_mail_intake_item('graph', 'buyer@example.test', 'mailbox-address', clock_timestamp(), 'Subject')$$, '22023', 'source_mailbox_key is invalid', 'mailbox key containing at-sign is rejected'); -- 52
select throws_ok($$select public.ingest_mail_intake_item(repeat('a', 33), 'mailbox-2', 'provider-long', clock_timestamp(), 'Subject')$$, '22023', 'source_provider is invalid', 'overlong provider is rejected'); -- 53
select throws_ok($$select public.ingest_mail_intake_item('graph', repeat('a', 129), 'mailbox-long', clock_timestamp(), 'Subject')$$, '22023', 'source_mailbox_key is invalid', 'overlong mailbox key is rejected'); -- 54
select throws_ok($$select public.ingest_mail_intake_item('graph', 'mailbox-2', repeat('a', 513), clock_timestamp(), 'Subject')$$, '22023', 'source_message_id is invalid', 'overlong source message ID is rejected'); -- 55
select throws_ok($$select public.ingest_mail_intake_item('graph', 'mailbox-2', 'subject-long', clock_timestamp(), repeat('a', 513))$$, '22023', 'subject is invalid', 'overlong subject is rejected'); -- 56
select throws_ok($$select public.ingest_mail_intake_item('graph', 'mailbox-2', 'blank-optional', clock_timestamp(), 'Subject', '   ')$$, '22023', 'vessel_voyage is invalid', 'blank optional candidate is rejected instead of stored'); -- 57
select throws_ok($$select public.ingest_mail_intake_item('graph', 'mailbox-2', 'fuel-object', clock_timestamp(), 'Subject', null, null, null, '{}'::jsonb)$$, '22023', 'fuel_items is invalid', 'non-array fuel items are rejected'); -- 58
select throws_ok($$select public.ingest_mail_intake_item('graph', 'mailbox-2', 'fuel-extra', clock_timestamp(), 'Subject', null, null, null, '[{"grade":"vlsfo","quantity":1,"raw":"x"}]'::jsonb)$$, '22023', 'fuel_items is invalid', 'fuel item with extra field is rejected'); -- 59
select throws_ok($$select public.ingest_mail_intake_item('graph', 'mailbox-2', 'fuel-grade', clock_timestamp(), 'Subject', null, null, null, '[{"grade":"mgo","quantity":1}]'::jsonb)$$, '22023', 'fuel_items is invalid', 'unsupported fuel grade is rejected'); -- 60
select throws_ok($$select public.ingest_mail_intake_item('graph', 'mailbox-2', 'fuel-zero', clock_timestamp(), 'Subject', null, null, null, '[{"grade":"vlsfo","quantity":0}]'::jsonb)$$, '22023', 'fuel_items is invalid', 'zero quantity is rejected'); -- 61
select throws_ok($$select public.ingest_mail_intake_item('graph', 'mailbox-2', 'fuel-negative', clock_timestamp(), 'Subject', null, null, null, '[{"grade":"vlsfo","quantity":-1}]'::jsonb)$$, '22023', 'fuel_items is invalid', 'negative quantity is rejected'); -- 62
select throws_ok($$select public.ingest_mail_intake_item('graph', 'mailbox-2', 'fuel-duplicate', clock_timestamp(), 'Subject', null, null, null, '[{"grade":"vlsfo","quantity":1},{"grade":"vlsfo","quantity":2}]'::jsonb)$$, '22023', 'fuel_items is invalid', 'duplicate fuel grade is rejected'); -- 63
select throws_ok($$select public.ingest_mail_intake_item('graph', 'mailbox-2', 'fuel-count', clock_timestamp(), 'Subject', null, null, null, '[{"grade":"vlsfo","quantity":1},{"grade":"hsfo","quantity":1},{"grade":"ulsfo","quantity":1},{"grade":"lsfo","quantity":1},{"grade":"lsmgo","quantity":1},{"grade":"vlsfo","quantity":2}]'::jsonb)$$, '22023', 'fuel_items is invalid', 'more than five fuel items are rejected'); -- 64
select throws_ok($$select public.ingest_mail_intake_item('graph', 'mailbox-2', 'warning-object', clock_timestamp(), 'Subject', null, null, null, '[]'::jsonb, '{}'::jsonb)$$, '22023', 'warnings is invalid', 'non-array warnings are rejected'); -- 65
select throws_ok($$select public.ingest_mail_intake_item('graph', 'mailbox-2', 'warning-number', clock_timestamp(), 'Subject', null, null, null, '[]'::jsonb, '[1]'::jsonb)$$, '22023', 'warnings is invalid', 'non-string warning is rejected'); -- 66
select throws_ok($$select public.ingest_mail_intake_item('graph', 'mailbox-2', 'warning-count', clock_timestamp(), 'Subject', null, null, null, '[]'::jsonb, (select jsonb_agg(value::text) from generate_series(1, 21) as value))$$, '22023', 'warnings is invalid', 'more than twenty warnings are rejected'); -- 67
select throws_ok($$select public.ingest_mail_intake_item('graph', 'mailbox-2', 'warning-long', clock_timestamp(), 'Subject', null, null, null, '[]'::jsonb, jsonb_build_array(repeat('a', 301)))$$, '22023', 'warnings is invalid', 'oversized warning is rejected'); -- 68
select throws_ok($$select public.ingest_mail_intake_item('graph', 'mailbox-2', 'warning-blank', clock_timestamp(), 'Subject', null, null, null, '[]'::jsonb, '["   "]'::jsonb)$$, '22023', 'warnings is invalid', 'blank warning is rejected'); -- 69
reset role;

-- A second pending item proves shared queue ordering and post-dismiss visibility.
set local role service_role;
select set_config('mail_test.second_id', public.ingest_mail_intake_item('gmail', 'mailbox-opaque-2', 'message-2', '2026-08-22 01:00:00+00', '')::text, true);
reset role;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-000000000011', 'buyer-a@mail.test', '{}', '{}'),
  ('00000000-0000-0000-0000-000000000012', 'buyer-b@mail.test', '{}', '{}'),
  ('00000000-0000-0000-0000-000000000013', 'trader@mail.test', '{"role":"buyer_admin"}', '{"role":"buyer_admin"}'),
  ('00000000-0000-0000-0000-000000000014', 'inactive-account@mail.test', '{"role":"buyer_admin"}', '{"role":"buyer_admin"}'),
  ('00000000-0000-0000-0000-000000000015', 'inactive-membership@mail.test', '{}', '{}'),
  ('00000000-0000-0000-0000-000000000016', 'inactive-organization@mail.test', '{}', '{}');

update app_private.user_accounts set status = 'active'
where user_id in (
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000013',
  '00000000-0000-0000-0000-000000000015',
  '00000000-0000-0000-0000-000000000016'
);

insert into app_private.organizations (id, kind, name, status) values
  ('00000000-0000-0000-0000-000000000111', 'buyer', 'Mail Buyer A', 'active'),
  ('00000000-0000-0000-0000-000000000112', 'buyer', 'Mail Buyer B', 'active'),
  ('00000000-0000-0000-0000-000000000113', 'trader', 'Mail Trader', 'active'),
  ('00000000-0000-0000-0000-000000000114', 'buyer', 'Mail Inactive Account Org', 'active'),
  ('00000000-0000-0000-0000-000000000115', 'buyer', 'Mail Inactive Membership Org', 'active'),
  ('00000000-0000-0000-0000-000000000116', 'buyer', 'Mail Inactive Org', 'inactive');

insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values
  ('00000000-0000-0000-0000-000000000211', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000111', 'buyer_admin', 'active'),
  ('00000000-0000-0000-0000-000000000212', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000112', 'buyer_operator', 'active'),
  ('00000000-0000-0000-0000-000000000213', '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000113', 'trader', 'active'),
  ('00000000-0000-0000-0000-000000000214', '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000114', 'buyer_admin', 'active'),
  ('00000000-0000-0000-0000-000000000215', '00000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000115', 'buyer_operator', 'inactive'),
  ('00000000-0000-0000-0000-000000000216', '00000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-000000000116', 'buyer_admin', 'active');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select is((select count(*) from public.list_mail_intake_items('00000000-0000-0000-0000-000000000211')), 2::bigint, 'active BUYER A lists every pending item'); -- 70
select is((select id from public.list_mail_intake_items('00000000-0000-0000-0000-000000000211') limit 1), current_setting('mail_test.second_id')::uuid, 'pending list uses received-at descending order'); -- 71
select throws_like($$select * from app_private.mail_intake_items$$, '%permission denied%', 'authenticated BUYER still cannot directly read the private queue'); -- 72

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', true);
select is((select count(*) from public.list_mail_intake_items('00000000-0000-0000-0000-000000000212')), 2::bigint, 'active BUYER B sees the same pending queue'); -- 73
select is((select count(*) from public.list_mail_intake_items('00000000-0000-0000-0000-000000000212') where id = current_setting('mail_test.main_id')::uuid), 1::bigint, 'cross-organization BUYER sees the same pending identity'); -- 74

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000013', true);
select throws_ok($$select * from public.list_mail_intake_items('00000000-0000-0000-0000-000000000213')$$, '42501', 'An active BUYER membership is required', 'active TRADER cannot list intake'); -- 75
select throws_ok($$select public.dismiss_mail_intake_item('00000000-0000-0000-0000-000000000213', current_setting('mail_test.main_id')::uuid, 1)$$, '42501', 'An active BUYER membership is required', 'active TRADER cannot dismiss intake'); -- 76

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000014', true);
select throws_ok($$select * from public.list_mail_intake_items('00000000-0000-0000-0000-000000000214')$$, '42501', 'An active BUYER membership is required', 'inactive BUYER account is denied'); -- 77
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000015', true);
select throws_ok($$select * from public.list_mail_intake_items('00000000-0000-0000-0000-000000000215')$$, '42501', 'An active BUYER membership is required', 'inactive BUYER membership is denied'); -- 78
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000016', true);
select throws_ok($$select * from public.list_mail_intake_items('00000000-0000-0000-0000-000000000216')$$, '42501', 'An active BUYER membership is required', 'inactive BUYER organization is denied'); -- 79
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select throws_ok($$select * from public.list_mail_intake_items('00000000-0000-0000-0000-000000000212')$$, '42501', 'An active BUYER membership is required', 'forged membership ID is denied'); -- 80
select throws_ok($$select public.dismiss_mail_intake_item('00000000-0000-0000-0000-000000000211', '00000000-0000-0000-0000-000000000299', 1)$$, 'P0002', 'Mail intake item not found', 'dismiss rejects a missing item'); -- 81
select is((public.dismiss_mail_intake_item('00000000-0000-0000-0000-000000000211', current_setting('mail_test.main_id')::uuid, 1)).revision, 2::bigint, 'active BUYER dismiss increments revision exactly once'); -- 82
reset role;

select is((select dismissed_by_user_id from app_private.mail_intake_items where id = current_setting('mail_test.main_id')::uuid), '00000000-0000-0000-0000-000000000011'::uuid, 'dismiss records the actual authenticated user'); -- 83
select is((select dismissed_by_membership_id from app_private.mail_intake_items where id = current_setting('mail_test.main_id')::uuid), '00000000-0000-0000-0000-000000000211'::uuid, 'dismiss records the verified selected membership'); -- 84
select ok((select status = 'dismissed' and dismissed_at is not null and updated_at >= created_at from app_private.mail_intake_items where id = current_setting('mail_test.main_id')::uuid), 'dismiss stores coherent status and server timestamps'); -- 85

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select throws_ok($$select public.dismiss_mail_intake_item('00000000-0000-0000-0000-000000000211', current_setting('mail_test.main_id')::uuid, 1)$$, '40001', 'Mail intake revision conflict', 'stale dismiss revision is rejected'); -- 86
select throws_ok($$select public.dismiss_mail_intake_item('00000000-0000-0000-0000-000000000211', current_setting('mail_test.main_id')::uuid, 2)$$, '55000', 'Mail intake item is already dismissed', 'second dismiss is rejected'); -- 87
select is((select count(*) from public.list_mail_intake_items('00000000-0000-0000-0000-000000000211')), 1::bigint, 'dismissed item disappears from BUYER A pending list'); -- 88
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', true);
select is((select count(*) from public.list_mail_intake_items('00000000-0000-0000-0000-000000000212')), 1::bigint, 'another BUYER observes the dismissed item removed'); -- 89
reset role;

set local role service_role;
select is(
  public.ingest_mail_intake_item('graph', 'mailbox-opaque-1', 'message-1', clock_timestamp(), 'Reopen attempt')::text,
  current_setting('mail_test.main_id'),
  'duplicate of dismissed identity still returns the existing UUID'
); -- 90
reset role;
select is((select status::text from app_private.mail_intake_items where id = current_setting('mail_test.main_id')::uuid), 'dismissed', 'duplicate ingest does not reopen a dismissed item'); -- 91
select is((select subject || '|' || revision::text from app_private.mail_intake_items where id = current_setting('mail_test.main_id')::uuid), 'Main subject|2', 'duplicate dismissed ingest does not overwrite data or revision'); -- 92

select throws_like(
  $$update app_private.mail_intake_items set status = 'pending' where id = current_setting('mail_test.main_id')::uuid$$,
  '%mail_intake_items_status_consistency%',
  'status constraint rejects inconsistent pending dismissal fields'
); -- 93
select throws_like(
  $$update app_private.mail_intake_items set revision = 0 where id = current_setting('mail_test.second_id')::uuid$$,
  '%mail_intake_items_revision_valid%',
  'revision constraint rejects values below one'
); -- 94
select is((select count(*) from app_private.mail_intake_items), 2::bigint, 'all duplicate and rejected ingests leave exactly two valid identities'); -- 95

select * from finish();
rollback;
