begin;
select plan(158);

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


-- Real local fixtures; every call below uses anon or authenticated caller context.

insert into auth.users (id, email, email_confirmed_at, invited_at, raw_user_meta_data, raw_app_meta_data) values
('a6700000-0000-4000-8000-000000000001', 'user-1@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000002', 'user-2@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000003', 'user-3@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000004', 'user-4@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000005', 'user-5@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000006', 'user-6@seller-registration-behavior.test', now(), now(), '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000007', 'user-7@seller-registration-behavior.test', null, null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000008', 'user-8@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000009', 'user-9@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000010', 'user-10@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000011', 'user-11@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000012', 'user-12@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000013', 'user-13@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000014', 'user-14@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000015', 'user-15@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000016', 'user-16@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000017', 'user-17@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000018', 'user-18@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000019', 'user-19@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb),
('a6700000-0000-4000-8000-000000000020', 'user-20@seller-registration-behavior.test', now(), null, '{"source":"invited","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb, '{"source":"self_signup","role":"buyer_admin","organization_id":"a6710000-0000-4000-8000-000000000001"}'::jsonb);

update app_private.user_accounts set status = 'active' where user_id in ('a6700000-0000-4000-8000-000000000001','a6700000-0000-4000-8000-000000000003','a6700000-0000-4000-8000-000000000004','a6700000-0000-4000-8000-000000000009');
update app_private.user_accounts set status = 'suspended' where user_id = 'a6700000-0000-4000-8000-000000000008';

insert into app_private.organizations (id, kind, name, status) values
('a6710000-0000-4000-8000-000000000001', 'buyer', 'Registration Buyer', 'active'),
('a6710000-0000-4000-8000-000000000002', 'trader', 'Registration Active A', 'active'),
('a6710000-0000-4000-8000-000000000003', 'trader', 'Registration Active B', 'active'),
('a6710000-0000-4000-8000-000000000004', 'trader', 'Registration Inactive', 'inactive'),
('a6710000-0000-4000-8000-000000000005', 'trader', 'Registration Suspended', 'suspended');

insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values
('a6720000-0000-4000-8000-000000000001', 'a6700000-0000-4000-8000-000000000001', 'a6710000-0000-4000-8000-000000000001', 'buyer_admin', 'active'),
('a6720000-0000-4000-8000-000000000003', 'a6700000-0000-4000-8000-000000000003', 'a6710000-0000-4000-8000-000000000001', 'buyer_operator', 'active'),
('a6720000-0000-4000-8000-000000000004', 'a6700000-0000-4000-8000-000000000004', 'a6710000-0000-4000-8000-000000000003', 'trader', 'active'),
('a6720000-0000-4000-8000-000000000010', 'a6700000-0000-4000-8000-000000000010', 'a6710000-0000-4000-8000-000000000002', 'trader', 'inactive'),
('a6720000-0000-4000-8000-000000000011', 'a6700000-0000-4000-8000-000000000011', 'a6710000-0000-4000-8000-000000000002', 'trader', 'suspended');

select ok(not has_table_privilege('anon', 'app_private.seller_registration_requests', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no direct seller_registration_requests privileges'); -- 19

select ok(not has_table_privilege('authenticated', 'app_private.seller_registration_requests', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has no direct seller_registration_requests privileges'); -- 20

select ok(not has_table_privilege('anon', 'app_private.seller_registration_audit_events', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no direct seller_registration_audit_events privileges'); -- 21

select ok(not has_table_privilege('authenticated', 'app_private.seller_registration_audit_events', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has no direct seller_registration_audit_events privileges'); -- 22

select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid in (
  'public.submit_seller_registration_request(text)'::regprocedure,
  'public.get_my_seller_registration_request()'::regprocedure,
  'public.list_seller_registration_requests_for_admin(uuid)'::regprocedure,
  'public.approve_seller_registration_request(uuid,uuid,integer,uuid)'::regprocedure,
  'public.reject_seller_registration_request(uuid,uuid,integer)'::regprocedure,
  'public.authorize_seller_registration_invite(uuid)'::regprocedure
)), 'all registration RPCs fix search_path and use privileged server execution'); -- 23

set local role anon;

select throws_like($test$select * from public.submit_seller_registration_request('Anon Seller')$test$, '%permission denied%', 'anon cannot submit'); -- 24

select throws_like($test$select * from public.get_my_seller_registration_request()$test$, '%permission denied%', 'anon cannot read applicant requests'); -- 25

select throws_like($test$select * from public.authorize_seller_registration_invite('a6720000-0000-4000-8000-000000000001')$test$, '%permission denied%', 'anon cannot authorize invites'); -- 26

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000005', true);

select set_config('request.jwt.claim.sub', '', true);

select throws_ok($test$select * from public.submit_seller_registration_request('No Identity')$test$, '42501', 'Authentication is required', 'authenticated role without an Auth identity cannot submit'); -- 27

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000007', true);

select throws_ok($test$select * from public.submit_seller_registration_request('Denied Seller')$test$, '55000', 'A confirmed email is required', 'unconfirmed email denies registration'); -- 28

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000008', true);

select throws_ok($test$select * from public.submit_seller_registration_request('Denied Seller')$test$, '55000', 'Only inactive accounts may submit a SELLER registration', 'suspended account denies registration'); -- 29

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000009', true);

select throws_ok($test$select * from public.submit_seller_registration_request('Denied Seller')$test$, '55000', 'Only inactive accounts may submit a SELLER registration', 'active account denies registration'); -- 30

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000010', true);

select throws_ok($test$select * from public.submit_seller_registration_request('Denied Seller')$test$, '55000', 'Users with memberships cannot submit a SELLER registration', 'inactive existing membership denies registration'); -- 31

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000011', true);

select throws_ok($test$select * from public.submit_seller_registration_request('Denied Seller')$test$, '55000', 'Users with memberships cannot submit a SELLER registration', 'suspended existing membership denies registration'); -- 32

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000005', true);

select throws_ok($test$select * from public.submit_seller_registration_request(null)$test$, '22023', 'Requested organization name must be between 1 and 120 characters', 'null requested name is rejected'); -- 33

select throws_ok($test$select * from public.submit_seller_registration_request('')$test$, '22023', 'Requested organization name must be between 1 and 120 characters', 'empty requested name is rejected'); -- 34

select throws_ok($test$select * from public.submit_seller_registration_request('   ')$test$, '22023', 'Requested organization name must be between 1 and 120 characters', 'blank requested name is rejected'); -- 35

select throws_ok($test$select * from public.submit_seller_registration_request(repeat('x', 121))$test$, '22023', 'Requested organization name must be between 1 and 120 characters', 'overlength requested name is rejected'); -- 36

reset role;

select is((select count(*) from app_private.seller_registration_requests where applicant_user_id = 'a6700000-0000-4000-8000-000000000005'), 0::bigint, 'invalid names create no request'); -- 37

select is((select count(*) from app_private.seller_registration_audit_events where applicant_user_id = 'a6700000-0000-4000-8000-000000000005'), 0::bigint, 'invalid names create no submitted audit'); -- 38

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000014', true);

select is((select requested_organization_name from public.submit_seller_registration_request('  ' || repeat('x', 120) || '  ')), repeat('x', 120), 'trimmed 120-character label is accepted'); -- 39

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000005', true);

create temporary table submitted_result on commit drop as select * from public.submit_seller_registration_request('  Candidate Seller  ');

select is((select requested_organization_name from submitted_result), 'Candidate Seller', 'submission returns trimmed name'); -- 40

select is((select source from submitted_result), 'self_signup', 'forged metadata cannot turn self-signup into invitation'); -- 41

select is((select status from submitted_result), 'pending', 'confirmed inactive applicant creates pending request'); -- 42

select is((select revision from submitted_result), 1, 'new pending request has revision one'); -- 43

select is((select request_id from public.get_my_seller_registration_request()), (select request_id from submitted_result), 'get_my returns the caller''s own request without business membership'); -- 44

select is((select request_id from public.submit_seller_registration_request('Candidate Seller')), (select request_id from submitted_result), 'same normalized pending submission is idempotent'); -- 45

select throws_ok($test$select * from public.submit_seller_registration_request('Different Seller')$test$, '55000', 'A different SELLER registration is already pending', 'different second pending request is rejected'); -- 46

select is((select count(*) from public.current_access_context()), 0::bigint, 'candidate has zero business contexts before approval'); -- 47

select throws_like($test$select * from app_private.seller_registration_requests$test$, '%permission denied%', 'authenticated cannot SELECT private requests'); -- 48

select throws_like($test$insert into app_private.seller_registration_requests(applicant_user_id,source,requested_organization_name) values ('a6700000-0000-4000-8000-000000000005','invited','Forged Direct')$test$, '%permission denied%', 'authenticated cannot INSERT private requests or forge source'); -- 49

select throws_like($test$update app_private.seller_registration_requests set status = 'approved' where applicant_user_id = 'a6700000-0000-4000-8000-000000000005'$test$, '%permission denied%', 'authenticated cannot UPDATE private requests'); -- 50

select throws_like($test$delete from app_private.seller_registration_requests where applicant_user_id = 'a6700000-0000-4000-8000-000000000005'$test$, '%permission denied%', 'authenticated cannot DELETE private requests'); -- 51

reset role;

select is((select count(*) from app_private.seller_registration_requests where applicant_user_id = 'a6700000-0000-4000-8000-000000000005'), 1::bigint, 'idempotent submission retains one pending request'); -- 52

select is((select count(*) from app_private.seller_registration_audit_events where applicant_user_id = 'a6700000-0000-4000-8000-000000000005' and event_type = 'submitted'), 1::bigint, 'idempotent submission appends submitted audit exactly once'); -- 53

select is((select count(*) from app_private.organization_memberships where user_id = 'a6700000-0000-4000-8000-000000000005'), 0::bigint, 'forged metadata cannot create any membership'); -- 54

select is((select status::text from app_private.user_accounts where user_id = 'a6700000-0000-4000-8000-000000000005'), 'inactive', 'submission keeps candidate inactive'); -- 55

select ok((select actor_user_id = 'a6700000-0000-4000-8000-000000000005' and actor_membership_id is null and actor_buyer_organization_id is null and before_snapshot = '{}'::jsonb and after_snapshot->>'status' = 'pending' and after_snapshot->>'revision' = '1' from app_private.seller_registration_audit_events where applicant_user_id = 'a6700000-0000-4000-8000-000000000005' and event_type = 'submitted'), 'submitted audit records actual applicant and bounded initial snapshot'); -- 56

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000006', true);

select is((select source from public.submit_seller_registration_request('Invited Candidate')), 'invited', 'trusted invited_at overrides forged app_metadata self_signup'); -- 57

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000012', true);

select is((select count(*) from public.get_my_seller_registration_request()), 0::bigint, 'another applicant cannot retrieve the first applicant''s request'); -- 58

create temporary table other_result on commit drop as select * from public.submit_seller_registration_request('Other Candidate');

select is((select request_id from public.get_my_seller_registration_request()), (select request_id from other_result), 'get_my returns only the second applicant''s own request'); -- 59

select ok((select request_id <> (select request_id from submitted_result) from public.get_my_seller_registration_request()), 'applicant isolation discriminates between two real requests'); -- 60

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000013', true);

create temporary table reject_result on commit drop as select * from public.submit_seller_registration_request('Reject Candidate');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000016', true);

create temporary table candidate_16_result on commit drop as select * from public.submit_seller_registration_request('Eligibility Candidate 16');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000017', true);

create temporary table candidate_17_result on commit drop as select * from public.submit_seller_registration_request('Eligibility Candidate 17');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000018', true);

create temporary table candidate_18_result on commit drop as select * from public.submit_seller_registration_request('Eligibility Candidate 18');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000019', true);

create temporary table candidate_19_result on commit drop as select * from public.submit_seller_registration_request('Eligibility Candidate 19');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000020', true);

create temporary table candidate_20_result on commit drop as select * from public.submit_seller_registration_request('Eligibility Candidate 20');

reset role;

update auth.users set email_confirmed_at = null where id = 'a6700000-0000-4000-8000-000000000016';
update app_private.user_accounts set status = 'active' where user_id = 'a6700000-0000-4000-8000-000000000017';
insert into app_private.organization_memberships(user_id,organization_id,role,status) values ('a6700000-0000-4000-8000-000000000018','a6710000-0000-4000-8000-000000000002','trader','inactive');

update auth.users set email = 'trusted-current@seller-registration-behavior.test' where id = 'a6700000-0000-4000-8000-000000000005';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000003', true);

select throws_ok($test$select * from public.list_seller_registration_requests_for_admin('a6720000-0000-4000-8000-000000000003')$test$, '42501', 'An active BUYER administrator membership is required', 'buyer_operator cannot list'); -- 61

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000003', (select request_id from submitted_result), 1, 'a6710000-0000-4000-8000-000000000002')$test$, '42501', 'An active BUYER administrator membership is required', 'buyer_operator cannot approve'); -- 62

select throws_ok($test$select * from public.reject_seller_registration_request('a6720000-0000-4000-8000-000000000003', (select request_id from submitted_result), 1)$test$, '42501', 'An active BUYER administrator membership is required', 'buyer_operator cannot reject'); -- 63

select throws_ok($test$select * from public.authorize_seller_registration_invite('a6720000-0000-4000-8000-000000000003')$test$, '42501', 'An active BUYER administrator membership is required', 'buyer_operator cannot invite authorization'); -- 64

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000004', true);

select throws_ok($test$select * from public.list_seller_registration_requests_for_admin('a6720000-0000-4000-8000-000000000004')$test$, '42501', 'An active BUYER administrator membership is required', 'TRADER cannot list'); -- 65

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000004', (select request_id from submitted_result), 1, 'a6710000-0000-4000-8000-000000000002')$test$, '42501', 'An active BUYER administrator membership is required', 'TRADER cannot approve'); -- 66

select throws_ok($test$select * from public.reject_seller_registration_request('a6720000-0000-4000-8000-000000000004', (select request_id from submitted_result), 1)$test$, '42501', 'An active BUYER administrator membership is required', 'TRADER cannot reject'); -- 67

select throws_ok($test$select * from public.authorize_seller_registration_invite('a6720000-0000-4000-8000-000000000004')$test$, '42501', 'An active BUYER administrator membership is required', 'TRADER cannot invite authorization'); -- 68

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000003', true);

select throws_ok($test$select * from public.list_seller_registration_requests_for_admin('a6720000-0000-4000-8000-000000000001')$test$, '42501', 'An active BUYER administrator membership is required', 'forged buyer_admin membership cannot list'); -- 69

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1, 'a6710000-0000-4000-8000-000000000002')$test$, '42501', 'An active BUYER administrator membership is required', 'forged buyer_admin membership cannot approve'); -- 70

select throws_ok($test$select * from public.reject_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1)$test$, '42501', 'An active BUYER administrator membership is required', 'forged buyer_admin membership cannot reject'); -- 71

select throws_ok($test$select * from public.authorize_seller_registration_invite('a6720000-0000-4000-8000-000000000001')$test$, '42501', 'An active BUYER administrator membership is required', 'forged buyer_admin membership cannot invite authorization'); -- 72

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000001', true);

select throws_ok($test$select * from public.list_seller_registration_requests_for_admin('a6720000-0000-4000-8000-000000000002')$test$, '42501', 'An active BUYER administrator membership is required', 'nonexistent actor membership cannot list'); -- 73

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000002', (select request_id from submitted_result), 1, 'a6710000-0000-4000-8000-000000000002')$test$, '42501', 'An active BUYER administrator membership is required', 'nonexistent actor membership cannot approve'); -- 74

select throws_ok($test$select * from public.reject_seller_registration_request('a6720000-0000-4000-8000-000000000002', (select request_id from submitted_result), 1)$test$, '42501', 'An active BUYER administrator membership is required', 'nonexistent actor membership cannot reject'); -- 75

select throws_ok($test$select * from public.authorize_seller_registration_invite('a6720000-0000-4000-8000-000000000002')$test$, '42501', 'An active BUYER administrator membership is required', 'nonexistent actor membership cannot invite authorization'); -- 76

reset role;

update app_private.user_accounts set status = 'inactive' where user_id = 'a6700000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000001', true);

select throws_ok($test$select * from public.list_seller_registration_requests_for_admin('a6720000-0000-4000-8000-000000000001')$test$, '42501', 'An active BUYER administrator membership is required', 'inactive account cannot list'); -- 77

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1, 'a6710000-0000-4000-8000-000000000002')$test$, '42501', 'An active BUYER administrator membership is required', 'inactive account cannot approve'); -- 78

select throws_ok($test$select * from public.reject_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1)$test$, '42501', 'An active BUYER administrator membership is required', 'inactive account cannot reject'); -- 79

select throws_ok($test$select * from public.authorize_seller_registration_invite('a6720000-0000-4000-8000-000000000001')$test$, '42501', 'An active BUYER administrator membership is required', 'inactive account cannot invite authorization'); -- 80

reset role;

update app_private.user_accounts set status = 'active' where user_id = 'a6700000-0000-4000-8000-000000000001';

update app_private.user_accounts set status = 'suspended' where user_id = 'a6700000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000001', true);

select throws_ok($test$select * from public.list_seller_registration_requests_for_admin('a6720000-0000-4000-8000-000000000001')$test$, '42501', 'An active BUYER administrator membership is required', 'suspended account cannot list'); -- 81

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1, 'a6710000-0000-4000-8000-000000000002')$test$, '42501', 'An active BUYER administrator membership is required', 'suspended account cannot approve'); -- 82

select throws_ok($test$select * from public.reject_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1)$test$, '42501', 'An active BUYER administrator membership is required', 'suspended account cannot reject'); -- 83

select throws_ok($test$select * from public.authorize_seller_registration_invite('a6720000-0000-4000-8000-000000000001')$test$, '42501', 'An active BUYER administrator membership is required', 'suspended account cannot invite authorization'); -- 84

reset role;

update app_private.user_accounts set status = 'active' where user_id = 'a6700000-0000-4000-8000-000000000001';

update app_private.organization_memberships set status = 'inactive' where id = 'a6720000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000001', true);

select throws_ok($test$select * from public.list_seller_registration_requests_for_admin('a6720000-0000-4000-8000-000000000001')$test$, '42501', 'An active BUYER administrator membership is required', 'inactive membership cannot list'); -- 85

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1, 'a6710000-0000-4000-8000-000000000002')$test$, '42501', 'An active BUYER administrator membership is required', 'inactive membership cannot approve'); -- 86

select throws_ok($test$select * from public.reject_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1)$test$, '42501', 'An active BUYER administrator membership is required', 'inactive membership cannot reject'); -- 87

select throws_ok($test$select * from public.authorize_seller_registration_invite('a6720000-0000-4000-8000-000000000001')$test$, '42501', 'An active BUYER administrator membership is required', 'inactive membership cannot invite authorization'); -- 88

reset role;

update app_private.organization_memberships set status = 'active' where id = 'a6720000-0000-4000-8000-000000000001';

update app_private.organization_memberships set status = 'suspended' where id = 'a6720000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000001', true);

select throws_ok($test$select * from public.list_seller_registration_requests_for_admin('a6720000-0000-4000-8000-000000000001')$test$, '42501', 'An active BUYER administrator membership is required', 'suspended membership cannot list'); -- 89

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1, 'a6710000-0000-4000-8000-000000000002')$test$, '42501', 'An active BUYER administrator membership is required', 'suspended membership cannot approve'); -- 90

select throws_ok($test$select * from public.reject_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1)$test$, '42501', 'An active BUYER administrator membership is required', 'suspended membership cannot reject'); -- 91

select throws_ok($test$select * from public.authorize_seller_registration_invite('a6720000-0000-4000-8000-000000000001')$test$, '42501', 'An active BUYER administrator membership is required', 'suspended membership cannot invite authorization'); -- 92

reset role;

update app_private.organization_memberships set status = 'active' where id = 'a6720000-0000-4000-8000-000000000001';

update app_private.organizations set status = 'inactive' where id = 'a6710000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000001', true);

select throws_ok($test$select * from public.list_seller_registration_requests_for_admin('a6720000-0000-4000-8000-000000000001')$test$, '42501', 'An active BUYER administrator membership is required', 'inactive BUYER organization cannot list'); -- 93

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1, 'a6710000-0000-4000-8000-000000000002')$test$, '42501', 'An active BUYER administrator membership is required', 'inactive BUYER organization cannot approve'); -- 94

select throws_ok($test$select * from public.reject_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1)$test$, '42501', 'An active BUYER administrator membership is required', 'inactive BUYER organization cannot reject'); -- 95

select throws_ok($test$select * from public.authorize_seller_registration_invite('a6720000-0000-4000-8000-000000000001')$test$, '42501', 'An active BUYER administrator membership is required', 'inactive BUYER organization cannot invite authorization'); -- 96

reset role;

update app_private.organizations set status = 'active' where id = 'a6710000-0000-4000-8000-000000000001';

update app_private.organizations set status = 'suspended' where id = 'a6710000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000001', true);

select throws_ok($test$select * from public.list_seller_registration_requests_for_admin('a6720000-0000-4000-8000-000000000001')$test$, '42501', 'An active BUYER administrator membership is required', 'suspended BUYER organization cannot list'); -- 97

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1, 'a6710000-0000-4000-8000-000000000002')$test$, '42501', 'An active BUYER administrator membership is required', 'suspended BUYER organization cannot approve'); -- 98

select throws_ok($test$select * from public.reject_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1)$test$, '42501', 'An active BUYER administrator membership is required', 'suspended BUYER organization cannot reject'); -- 99

select throws_ok($test$select * from public.authorize_seller_registration_invite('a6720000-0000-4000-8000-000000000001')$test$, '42501', 'An active BUYER administrator membership is required', 'suspended BUYER organization cannot invite authorization'); -- 100

reset role;

update app_private.organizations set status = 'active' where id = 'a6710000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000001', true);

select is((select status from public.authorize_seller_registration_invite('a6720000-0000-4000-8000-000000000001')), 'authorized', 'active buyer_admin can authorize seller invitation'); -- 101

select is((select applicant_email from public.list_seller_registration_requests_for_admin('a6720000-0000-4000-8000-000000000001') where request_id = (select request_id from submitted_result)), 'trusted-current@seller-registration-behavior.test', 'admin list presents current trusted Auth email'); -- 102

select is((select applicant_user_id from public.list_seller_registration_requests_for_admin('a6720000-0000-4000-8000-000000000001') where request_id = (select request_id from submitted_result)), 'a6700000-0000-4000-8000-000000000005'::uuid, 'admin list identifies the actual pending applicant'); -- 103

reset role;

create temporary table before_failed_approval on commit drop as select (select jsonb_build_object(
  'request', (select to_jsonb(r) from app_private.seller_registration_requests r where r.applicant_user_id = 'a6700000-0000-4000-8000-000000000005'),
  'account', (select to_jsonb(a) from app_private.user_accounts a where a.user_id = 'a6700000-0000-4000-8000-000000000005'),
  'memberships', (select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb) from app_private.organization_memberships m where m.user_id = 'a6700000-0000-4000-8000-000000000005'),
  'audit', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb) from app_private.seller_registration_audit_events e where e.applicant_user_id = 'a6700000-0000-4000-8000-000000000005')
)) as state;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000001', true);

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1, 'a6710000-0000-4000-8000-000000000001')$test$, '22023', 'Target must be an active TRADER organization', 'BUYER target cannot be approved'); -- 104

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1, 'a6710000-0000-4000-8000-000000000004')$test$, '22023', 'Target must be an active TRADER organization', 'inactive TRADER target cannot be approved'); -- 105

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1, 'a6710000-0000-4000-8000-000000000005')$test$, '22023', 'Target must be an active TRADER organization', 'suspended TRADER target cannot be approved'); -- 106

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1, 'a6710000-0000-4000-8000-000000000099')$test$, '22023', 'Target must be an active TRADER organization', 'missing organization target cannot be approved'); -- 107

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 0, 'a6710000-0000-4000-8000-000000000002')$test$, '40001', 'SELLER registration changed; reload and try again', 'stale pending revision cannot be approved'); -- 108

select throws_ok($test$select * from public.reject_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 0)$test$, '40001', 'SELLER registration changed; reload and try again', 'stale pending revision cannot be rejected'); -- 109

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from candidate_16_result), 1, 'a6710000-0000-4000-8000-000000000002')$test$, '55000', 'Applicant is no longer eligible for approval', 'approval rechecks unconfirmed email'); -- 110

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from candidate_17_result), 1, 'a6710000-0000-4000-8000-000000000002')$test$, '55000', 'Applicant is no longer eligible for approval', 'approval rechecks active applicant account'); -- 111

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from candidate_18_result), 1, 'a6710000-0000-4000-8000-000000000002')$test$, '55000', 'Applicant is no longer eligible for approval', 'approval rechecks new existing membership'); -- 112

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from candidate_19_result), null, 'a6710000-0000-4000-8000-000000000002')$test$, '40001', 'SELLER registration changed; reload and try again', 'approval requires an exact non-null revision'); -- 113

select throws_ok($test$select * from public.reject_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from candidate_20_result), null)$test$, '40001', 'SELLER registration changed; reload and try again', 'rejection requires an exact non-null revision'); -- 114

reset role;

select is((select jsonb_build_object(
  'request', (select to_jsonb(r) from app_private.seller_registration_requests r where r.applicant_user_id = 'a6700000-0000-4000-8000-000000000005'),
  'account', (select to_jsonb(a) from app_private.user_accounts a where a.user_id = 'a6700000-0000-4000-8000-000000000005'),
  'memberships', (select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb) from app_private.organization_memberships m where m.user_id = 'a6700000-0000-4000-8000-000000000005'),
  'audit', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb) from app_private.seller_registration_audit_events e where e.applicant_user_id = 'a6700000-0000-4000-8000-000000000005')
)), (select state from before_failed_approval), 'failed approval/rejection leaves request/account/membership/audit unchanged'); -- 115

create function pg_temp.fail_registration_approved_audit() returns trigger language plpgsql as $fixture$
begin
  if new.applicant_user_id = 'a6700000-0000-4000-8000-000000000012' and new.event_type = 'approved' then
    raise exception using errcode = '23514', message = 'Fixture approved audit failure';
  end if;
  return new;
end;
$fixture$;
create trigger fixture_registration_approved_audit_failure before insert on app_private.seller_registration_audit_events
for each row execute function pg_temp.fail_registration_approved_audit();
create temporary table before_audit_failure on commit drop as select (select jsonb_build_object(
  'request', (select to_jsonb(r) from app_private.seller_registration_requests r where r.applicant_user_id = 'a6700000-0000-4000-8000-000000000012'),
  'account', (select to_jsonb(a) from app_private.user_accounts a where a.user_id = 'a6700000-0000-4000-8000-000000000012'),
  'memberships', (select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb) from app_private.organization_memberships m where m.user_id = 'a6700000-0000-4000-8000-000000000012'),
  'audit', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb) from app_private.seller_registration_audit_events e where e.applicant_user_id = 'a6700000-0000-4000-8000-000000000012')
)) as state;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000001', true);

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from other_result), 1, 'a6710000-0000-4000-8000-000000000002')$test$, '23514', 'Fixture approved audit failure', 'late audit failure rejects the entire approval transaction'); -- 116

reset role;

select is((select jsonb_build_object(
  'request', (select to_jsonb(r) from app_private.seller_registration_requests r where r.applicant_user_id = 'a6700000-0000-4000-8000-000000000012'),
  'account', (select to_jsonb(a) from app_private.user_accounts a where a.user_id = 'a6700000-0000-4000-8000-000000000012'),
  'memberships', (select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb) from app_private.organization_memberships m where m.user_id = 'a6700000-0000-4000-8000-000000000012'),
  'audit', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb) from app_private.seller_registration_audit_events e where e.applicant_user_id = 'a6700000-0000-4000-8000-000000000012')
)), (select state from before_audit_failure), 'late failure rolls back new membership, activation, decision, and audit'); -- 117

drop trigger fixture_registration_approved_audit_failure on app_private.seller_registration_audit_events;
drop function pg_temp.fail_registration_approved_audit();

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000001', true);

create temporary table approval_result on commit drop as select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 1, 'a6710000-0000-4000-8000-000000000002');

select is((select status from approval_result), 'approved', 'active TRADER target can be approved by active buyer_admin'); -- 118

select is((select revision from approval_result), 2, 'approved response increments revision once'); -- 119

select is((select mapped_trader_organization_id from approval_result), 'a6710000-0000-4000-8000-000000000002'::uuid, 'approval maps only to the selected existing TRADER'); -- 120

reset role;

select is((select count(*) from app_private.organization_memberships where user_id = 'a6700000-0000-4000-8000-000000000005'), 1::bigint, 'approval creates exactly one membership'); -- 121

select is((select role::text from app_private.organization_memberships where user_id = 'a6700000-0000-4000-8000-000000000005'), 'trader', 'approval creates exactly role trader'); -- 122

select is((select status::text from app_private.organization_memberships where user_id = 'a6700000-0000-4000-8000-000000000005'), 'active', 'approval creates exactly active membership'); -- 123

select is((select status::text from app_private.user_accounts where user_id = 'a6700000-0000-4000-8000-000000000005'), 'active', 'approval activates the inactive account'); -- 124

select ok((select status = 'approved' and revision = 2 and decided_at is not null and decided_by_user_id = 'a6700000-0000-4000-8000-000000000001' and decided_by_membership_id = 'a6720000-0000-4000-8000-000000000001' and decided_by_buyer_organization_id = 'a6710000-0000-4000-8000-000000000001' and mapped_trader_organization_id = 'a6710000-0000-4000-8000-000000000002' from app_private.seller_registration_requests where id = (select request_id from submitted_result)), 'request retains approved state and actual decision actor user/membership/BUYER org'); -- 125

select is((select count(*) from app_private.seller_registration_audit_events where applicant_user_id = 'a6700000-0000-4000-8000-000000000005' and event_type = 'approved'), 1::bigint, 'approval appends exactly one approved audit'); -- 126

select ok((select actor_user_id = 'a6700000-0000-4000-8000-000000000001' and actor_membership_id = 'a6720000-0000-4000-8000-000000000001' and actor_buyer_organization_id = 'a6710000-0000-4000-8000-000000000001' and before_snapshot->>'status' = 'pending' and before_snapshot->>'revision' = '1' and after_snapshot->>'status' = 'approved' and after_snapshot->>'revision' = '2' and after_snapshot->>'mapped_trader_organization_id' = 'a6710000-0000-4000-8000-000000000002' from app_private.seller_registration_audit_events where applicant_user_id = 'a6700000-0000-4000-8000-000000000005' and event_type = 'approved'), 'approved audit retains actor and exact bounded state transition'); -- 127

select is((select count(*) from app_private.organization_memberships m join app_private.organizations o on o.id = m.organization_id where m.user_id = 'a6700000-0000-4000-8000-000000000005' and o.kind = 'buyer'), 0::bigint, 'registration cannot create a BUYER membership'); -- 128

select is((select count(*) from app_private.bid_trader_organization_access where trader_organization_id in ('a6710000-0000-4000-8000-000000000002','a6710000-0000-4000-8000-000000000003')), 0::bigint, 'registration approval creates no BID access row'); -- 129

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000005', true);

select is((select count(*) from public.current_access_context()), 1::bigint, 'approved account exposes exactly one access context'); -- 130

select ok((select organization_id = 'a6710000-0000-4000-8000-000000000002' and organization_kind = 'trader' and membership_role = 'trader' from public.current_access_context()), 'approved context is only the selected TRADER organization'); -- 131

select is((select status from public.get_my_seller_registration_request()), 'approved', 'approved applicant can read own authoritative decision'); -- 132

select throws_ok($test$select * from public.submit_seller_registration_request('After Approval')$test$, '55000', 'Only inactive accounts may submit a SELLER registration', 'approved active applicant cannot resubmit'); -- 133

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000001', true);

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 2, 'a6710000-0000-4000-8000-000000000003')$test$, '40001', 'SELLER registration changed; reload and try again', 'approved terminal request cannot be approved twice'); -- 134

select throws_ok($test$select * from public.reject_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from submitted_result), 2)$test$, '40001', 'SELLER registration changed; reload and try again', 'approved terminal request cannot be rejected'); -- 135

select is((select count(*) from public.list_seller_registration_requests_for_admin('a6720000-0000-4000-8000-000000000001') where request_id = (select request_id from submitted_result)), 0::bigint, 'admin pending list omits approved requests'); -- 136

create temporary table rejected_response on commit drop as select * from public.reject_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from reject_result), 1);

select is((select status from rejected_response), 'rejected', 'active buyer_admin may reject a pending request'); -- 137

select is((select revision from rejected_response), 2, 'rejection increments revision once'); -- 138

reset role;

select is((select status::text from app_private.user_accounts where user_id = 'a6700000-0000-4000-8000-000000000013'), 'inactive', 'rejection leaves applicant inactive'); -- 139

select is((select count(*) from app_private.organization_memberships where user_id = 'a6700000-0000-4000-8000-000000000013'), 0::bigint, 'rejection creates no membership'); -- 140

select ok((select status = 'rejected' and revision = 2 and decided_at is not null and decided_by_user_id = 'a6700000-0000-4000-8000-000000000001' and decided_by_membership_id = 'a6720000-0000-4000-8000-000000000001' and decided_by_buyer_organization_id = 'a6710000-0000-4000-8000-000000000001' and mapped_trader_organization_id is null from app_private.seller_registration_requests where applicant_user_id = 'a6700000-0000-4000-8000-000000000013'), 'rejected request retains actual actor and no TRADER mapping'); -- 141

select is((select count(*) from app_private.seller_registration_audit_events where applicant_user_id = 'a6700000-0000-4000-8000-000000000013' and event_type = 'rejected'), 1::bigint, 'rejection appends exactly one rejected audit'); -- 142

select ok((select actor_user_id = 'a6700000-0000-4000-8000-000000000001' and actor_membership_id = 'a6720000-0000-4000-8000-000000000001' and actor_buyer_organization_id = 'a6710000-0000-4000-8000-000000000001' and before_snapshot->>'status' = 'pending' and after_snapshot->>'status' = 'rejected' and after_snapshot->>'revision' = '2' from app_private.seller_registration_audit_events where applicant_user_id = 'a6700000-0000-4000-8000-000000000013' and event_type = 'rejected'), 'rejection audit describes actual actor and terminal transition'); -- 143

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000013', true);

select is((select status from public.get_my_seller_registration_request()), 'rejected', 'rejected applicant reads only own rejected request'); -- 144

select is((select count(*) from public.current_access_context()), 0::bigint, 'rejected applicant remains without business context'); -- 145

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6700000-0000-4000-8000-000000000001', true);

select throws_ok($test$select * from public.reject_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from reject_result), 2)$test$, '40001', 'SELLER registration changed; reload and try again', 'rejected terminal request cannot be rejected twice'); -- 146

select throws_ok($test$select * from public.approve_seller_registration_request('a6720000-0000-4000-8000-000000000001', (select request_id from reject_result), 2, 'a6710000-0000-4000-8000-000000000002')$test$, '40001', 'SELLER registration changed; reload and try again', 'rejected terminal request cannot be approved'); -- 147

select throws_like($test$select * from app_private.seller_registration_audit_events$test$, '%permission denied%', 'authenticated cannot directly select registration audit'); -- 148

select throws_like($test$insert into app_private.seller_registration_audit_events(request_id,applicant_user_id,event_type,actor_user_id,before_snapshot,after_snapshot) values ((select request_id from submitted_result),'a6700000-0000-4000-8000-000000000005','submitted','a6700000-0000-4000-8000-000000000005','{}','{}')$test$, '%permission denied%', 'authenticated cannot directly insert registration audit'); -- 149

select throws_like($test$update app_private.seller_registration_audit_events set after_snapshot = '{}' where request_id = (select request_id from submitted_result)$test$, '%permission denied%', 'authenticated cannot directly update registration audit'); -- 150

select throws_like($test$delete from app_private.seller_registration_audit_events where request_id = (select request_id from submitted_result)$test$, '%permission denied%', 'authenticated cannot directly delete registration audit'); -- 151

reset role;

select throws_ok($test$update app_private.seller_registration_audit_events set after_snapshot = '{}' where applicant_user_id = 'a6700000-0000-4000-8000-000000000005' and event_type = 'approved'$test$, '42501', 'SELLER registration audit is append-only', 'approved audit UPDATE rejected even for owner'); -- 152

select throws_ok($test$delete from app_private.seller_registration_audit_events where applicant_user_id = 'a6700000-0000-4000-8000-000000000005' and event_type = 'approved'$test$, '42501', 'SELLER registration audit is append-only', 'approved audit DELETE rejected even for owner'); -- 153

select throws_ok($test$update app_private.seller_registration_audit_events set after_snapshot = '{}' where applicant_user_id = 'a6700000-0000-4000-8000-000000000013' and event_type = 'rejected'$test$, '42501', 'SELLER registration audit is append-only', 'rejected audit UPDATE rejected even for owner'); -- 154

select throws_ok($test$delete from app_private.seller_registration_audit_events where applicant_user_id = 'a6700000-0000-4000-8000-000000000013' and event_type = 'rejected'$test$, '42501', 'SELLER registration audit is append-only', 'rejected audit DELETE rejected even for owner'); -- 155

select is((select count(*) from app_private.seller_registration_audit_events where applicant_user_id = 'a6700000-0000-4000-8000-000000000005'), 2::bigint, 'audit mutation denials retain submitted and approved events'); -- 156

select is((select count(*) from app_private.seller_registration_audit_events where applicant_user_id = 'a6700000-0000-4000-8000-000000000013'), 2::bigint, 'audit mutation denials retain submitted and rejected events'); -- 157

select is((select count(*) from auth.users where id in ('a6700000-0000-4000-8000-000000000005','a6700000-0000-4000-8000-000000000013')), 2::bigint, 'approval/rejection preserves both Auth identities'); -- 158

select * from finish();
rollback;
