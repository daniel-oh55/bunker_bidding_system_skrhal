begin;
select plan(18);

select has_type('app_private', 'seller_registration_source', 'registration source enum exists');
select has_type('app_private', 'seller_registration_status', 'registration status enum exists');
select has_type('app_private', 'seller_registration_audit_event_type', 'registration audit enum exists');
select has_table('app_private', 'seller_registration_requests', 'requests are private');
select has_table('app_private', 'seller_registration_audit_events', 'audit is private');
select ok((select relrowsecurity from pg_class where oid = 'app_private.seller_registration_requests'::regclass), 'request RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'app_private.seller_registration_audit_events'::regclass), 'audit RLS is enabled');
select ok(not has_table_privilege('authenticated', 'app_private.seller_registration_requests', 'select'), 'authenticated cannot read requests directly');
select ok(not has_table_privilege('authenticated', 'app_private.seller_registration_audit_events', 'insert'), 'authenticated cannot write audit directly');
select has_function('public', 'submit_seller_registration_request', array['text'], 'applicant RPC exists');
select has_function('public', 'get_my_seller_registration_request', array[]::text[], 'own-request RPC exists');
select has_function('public', 'list_seller_registration_requests_for_admin', array['uuid'], 'admin list RPC exists');
select has_function('public', 'approve_seller_registration_request', array['uuid','uuid','integer','uuid'], 'approve RPC exists');
select has_function('public', 'reject_seller_registration_request', array['uuid','uuid','integer'], 'reject RPC exists');
select has_function('public', 'authorize_seller_registration_invite', array['uuid'], 'invite authorization RPC exists');
select function_privs_are('public', 'submit_seller_registration_request', array['text'], 'authenticated', array['EXECUTE'], 'authenticated may submit only through RPC');
select function_privs_are('public', 'submit_seller_registration_request', array['text'], 'anon', array[]::text[], 'anon cannot submit');
select has_trigger('app_private', 'seller_registration_audit_events', 'reject_seller_registration_audit_mutation', 'audit mutation rejection trigger exists');

select * from finish();
rollback;
