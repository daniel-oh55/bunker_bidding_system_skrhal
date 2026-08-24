begin;
select plan(43);

select has_table('app_private', 'mail_connector_cursors', 'private connector cursor table exists'); -- 1
select ok(
  (select relrowsecurity from pg_class where oid = 'app_private.mail_connector_cursors'::regclass),
  'cursor table has RLS enabled'
); -- 2
select columns_are(
  'app_private',
  'mail_connector_cursors',
  array['source_provider', 'source_mailbox_key', 'cursor_value', 'revision', 'created_at', 'updated_at'],
  'cursor table stores only bounded provider-neutral metadata'
); -- 3

select ok(not has_table_privilege('anon', 'app_private.mail_connector_cursors', 'select'), 'anon cannot select cursor rows'); -- 4
select ok(not has_table_privilege('authenticated', 'app_private.mail_connector_cursors', 'select'), 'authenticated cannot select cursor rows'); -- 5
select ok(not has_table_privilege('service_role', 'app_private.mail_connector_cursors', 'select'), 'service_role cannot directly select cursor rows'); -- 6
select ok(not has_table_privilege('service_role', 'app_private.mail_connector_cursors', 'insert'), 'service_role cannot directly insert cursor rows'); -- 7
select ok(not has_table_privilege('service_role', 'app_private.mail_connector_cursors', 'update'), 'service_role cannot directly update cursor rows'); -- 8
select ok(not has_table_privilege('service_role', 'app_private.mail_connector_cursors', 'delete'), 'service_role cannot directly delete cursor rows'); -- 9
select ok(not has_table_privilege('service_role', 'app_private.mail_connector_cursors', 'truncate'), 'service_role cannot truncate cursor rows'); -- 10

select ok(not has_function_privilege('anon', 'public.get_mail_connector_cursor(text,text)', 'execute'), 'anon cannot execute cursor read RPC'); -- 11
select ok(not has_function_privilege('authenticated', 'public.get_mail_connector_cursor(text,text)', 'execute'), 'authenticated cannot execute cursor read RPC'); -- 12
select ok(has_function_privilege('service_role', 'public.get_mail_connector_cursor(text,text)', 'execute'), 'service_role can execute cursor read RPC'); -- 13
select ok(not has_function_privilege('anon', 'public.compare_and_swap_mail_connector_cursor(text,text,bigint,text)', 'execute'), 'anon cannot execute cursor CAS RPC'); -- 14
select ok(not has_function_privilege('authenticated', 'public.compare_and_swap_mail_connector_cursor(text,text,bigint,text)', 'execute'), 'authenticated cannot execute cursor CAS RPC'); -- 15
select ok(has_function_privilege('service_role', 'public.compare_and_swap_mail_connector_cursor(text,text,bigint,text)', 'execute'), 'service_role can execute cursor CAS RPC'); -- 16
select ok(
  (select prosecdef from pg_proc where oid = 'public.get_mail_connector_cursor(text,text)'::regprocedure),
  'cursor read RPC is SECURITY DEFINER'
); -- 17
select ok(
  (select prosecdef from pg_proc where oid = 'public.compare_and_swap_mail_connector_cursor(text,text,bigint,text)'::regprocedure),
  'cursor CAS RPC is SECURITY DEFINER'
); -- 18
select is(
  (select proconfig from pg_proc where oid = 'public.get_mail_connector_cursor(text,text)'::regprocedure),
  array['search_path=""'],
  'cursor read RPC has an empty fixed search path'
); -- 19
select is(
  (select proconfig from pg_proc where oid = 'public.compare_and_swap_mail_connector_cursor(text,text,bigint,text)'::regprocedure),
  array['search_path=""'],
  'cursor CAS RPC has an empty fixed search path'
); -- 20

-- The pre-existing queue privilege split remains unchanged.
select ok(has_function_privilege('service_role', 'public.ingest_mail_intake_item(text,text,text,timestamptz,text,text,text,text,jsonb,jsonb)', 'execute'), 'service_role retains ingest execute'); -- 21
select ok(not has_function_privilege('service_role', 'public.list_mail_intake_items(uuid)', 'execute'), 'service_role still cannot execute queue list'); -- 22
select ok(not has_function_privilege('service_role', 'public.dismiss_mail_intake_item(uuid,uuid,bigint)', 'execute'), 'service_role still cannot execute queue dismiss'); -- 23
select ok(has_function_privilege('authenticated', 'public.list_mail_intake_items(uuid)', 'execute'), 'authenticated retains queue list execute'); -- 24
select ok(has_function_privilege('authenticated', 'public.dismiss_mail_intake_item(uuid,uuid,bigint)', 'execute'), 'authenticated retains queue dismiss execute'); -- 25
select ok(not has_function_privilege('authenticated', 'public.ingest_mail_intake_item(text,text,text,timestamptz,text,text,text,text,jsonb,jsonb)', 'execute'), 'authenticated still cannot execute ingest'); -- 26
select ok(not has_table_privilege('service_role', 'app_private.mail_intake_items', 'select'), 'service_role still cannot directly select queue rows'); -- 27
select ok(not has_table_privilege('service_role', 'app_private.mail_intake_items', 'insert'), 'service_role still cannot directly insert queue rows'); -- 28

set local role service_role;
select is(
  (select count(*) from public.get_mail_connector_cursor('gmail', 'gmail-bunker-primary')),
  0::bigint,
  'cursor read returns no row before initialization'
); -- 29
select is(
  (select cursor_value from public.compare_and_swap_mail_connector_cursor('gmail', 'gmail-bunker-primary', null, '1000')),
  '1000',
  'null expected revision initializes the cursor'
); -- 30
select is(
  (select cursor_value from public.get_mail_connector_cursor('gmail', 'gmail-bunker-primary')),
  '1000',
  'cursor read returns the initialized opaque value'
); -- 31
select is(
  (select revision from public.get_mail_connector_cursor('gmail', 'gmail-bunker-primary')),
  1::bigint,
  'initialized cursor starts at revision one'
); -- 32
select is(
  (select revision from public.compare_and_swap_mail_connector_cursor('gmail', 'gmail-bunker-primary', 1, '1001')),
  2::bigint,
  'matching expected revision advances the cursor once'
); -- 33
select is(
  (select cursor_value from public.get_mail_connector_cursor('gmail', 'gmail-bunker-primary')),
  '1001',
  'advanced cursor value is visible through the read RPC'
); -- 34
select throws_ok(
  $$select * from public.compare_and_swap_mail_connector_cursor('gmail', 'gmail-bunker-primary', 1, 'stale-overwrite')$$,
  '40001',
  'mail connector cursor revision conflict',
  'stale revision is rejected with serialization failure'
); -- 35
select is(
  (select cursor_value from public.get_mail_connector_cursor('gmail', 'gmail-bunker-primary')),
  '1001',
  'stale CAS cannot overwrite the current cursor'
); -- 36
select throws_ok(
  $$select * from public.compare_and_swap_mail_connector_cursor('gmail', 'gmail-bunker-primary', null, 'duplicate-init')$$,
  '40001',
  'mail connector cursor revision conflict',
  'concurrent-style duplicate initialization is rejected'
); -- 37
select throws_ok(
  $$select * from public.get_mail_connector_cursor('GMAIL', 'gmail-bunker-primary')$$,
  '22023',
  'source_provider is invalid',
  'provider validation rejects non-canonical values'
); -- 38
select throws_ok(
  $$select * from public.get_mail_connector_cursor('gmail', 'mailbox@example.test')$$,
  '22023',
  'source_mailbox_key is invalid',
  'mailbox cursor key cannot contain an address marker'
); -- 39
select throws_ok(
  $$select * from public.compare_and_swap_mail_connector_cursor('gmail', 'another-mailbox', null, E'bad\ncursor')$$,
  '22023',
  'cursor_value is invalid',
  'cursor validation rejects control characters'
); -- 40
select throws_ok(
  $$select * from public.compare_and_swap_mail_connector_cursor('gmail', 'gmail-bunker-primary', 0, '1002')$$,
  '22023',
  'expected_revision is invalid',
  'cursor CAS rejects an invalid expected revision'
); -- 41
select throws_like(
  $$select * from app_private.mail_connector_cursors$$,
  '%permission denied%',
  'service_role direct cursor-table access is denied at runtime'
); -- 42
reset role;

set local role authenticated;
select throws_like(
  $$select * from public.get_mail_connector_cursor('gmail', 'gmail-bunker-primary')$$,
  '%permission denied%',
  'authenticated cursor RPC invocation is denied at runtime'
); -- 43
reset role;

select * from finish();
rollback;
