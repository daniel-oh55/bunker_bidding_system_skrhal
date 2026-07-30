begin;
select plan(22);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000001', 'buyer@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'trader@example.test'),
  ('00000000-0000-0000-0000-000000000003', 'metadata@example.test'),
  ('00000000-0000-0000-0000-000000000004', 'new-user@example.test');

select is(
  (select status::text from app_private.user_accounts where user_id = '00000000-0000-0000-0000-000000000004'),
  'inactive',
  'an auth user insert creates an inactive account'
);
select is(
  (select count(*) from app_private.organization_memberships where user_id = '00000000-0000-0000-0000-000000000004'),
  0::bigint,
  'the account trigger does not create membership rows'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select is((select count(*) from public.current_access_context()), 0::bigint, 'the account trigger never grants active access');
reset role;

update auth.users
set raw_user_meta_data = '{"organization_id":"00000000-0000-0000-0000-000000000102","role":"trader"}'::jsonb
where id = '00000000-0000-0000-0000-000000000003';

insert into app_private.organizations (id, kind, name, status)
values
  ('00000000-0000-0000-0000-000000000101', 'buyer', 'Buyer One', 'active'),
  ('00000000-0000-0000-0000-000000000102', 'trader', 'Trader One', 'active'),
  ('00000000-0000-0000-0000-000000000103', 'buyer', 'Buyer Two', 'active');

update app_private.user_accounts set status = 'active';

insert into app_private.organization_memberships (id, user_id, organization_id, role, status)
values
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'buyer_admin', 'active'),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000102', 'trader', 'active'),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000103', 'buyer_operator', 'active');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is((select count(*) from public.current_access_context()), 0::bigint, 'metadata alone never grants context');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is((select organization_kind from public.current_access_context() where membership_id = '00000000-0000-0000-0000-000000000201'), 'buyer', 'active buyer membership returns buyer context');
select is((select membership_role from public.current_access_context() where membership_id = '00000000-0000-0000-0000-000000000201'), 'buyer_admin', 'active buyer membership returns its role');
select is((select organization_id from public.current_access_context() where membership_id = '00000000-0000-0000-0000-000000000201'), '00000000-0000-0000-0000-000000000101'::uuid, 'buyer context returns its organization ID');
select is((select membership_id from public.current_access_context() where membership_id = '00000000-0000-0000-0000-000000000201'), '00000000-0000-0000-0000-000000000201'::uuid, 'buyer context returns its membership ID');
select is((select count(*) from public.current_access_context()), 2::bigint, 'multiple active memberships return multiple rows');
select is((select count(*) from public.current_access_context() where organization_id = '00000000-0000-0000-0000-000000000102'), 0::bigint, 'a user cannot request another users context');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is((select organization_kind from public.current_access_context()), 'trader', 'active trader membership returns trader context');
select is((select membership_role from public.current_access_context()), 'trader', 'active trader membership returns its role');
reset role;

update app_private.user_accounts set status = 'inactive' where user_id = '00000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.current_access_context()), 0::bigint, 'inactive account returns no context');
reset role;
update app_private.user_accounts set status = 'suspended' where user_id = '00000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.current_access_context()), 0::bigint, 'suspended account returns no context');
reset role;
update app_private.user_accounts set status = 'active' where user_id = '00000000-0000-0000-0000-000000000001';

update app_private.organizations set status = 'inactive' where id = '00000000-0000-0000-0000-000000000101';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.current_access_context() where membership_id = '00000000-0000-0000-0000-000000000201'), 0::bigint, 'inactive organization returns no context');
reset role;
update app_private.organizations set status = 'suspended' where id = '00000000-0000-0000-0000-000000000101';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.current_access_context() where membership_id = '00000000-0000-0000-0000-000000000201'), 0::bigint, 'suspended organization returns no context');
reset role;
update app_private.organizations set status = 'active' where id = '00000000-0000-0000-0000-000000000101';

update app_private.organization_memberships set status = 'inactive' where id = '00000000-0000-0000-0000-000000000201';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.current_access_context() where membership_id = '00000000-0000-0000-0000-000000000201'), 0::bigint, 'inactive membership returns no context');
reset role;
update app_private.organization_memberships set status = 'suspended' where id = '00000000-0000-0000-0000-000000000201';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.current_access_context() where membership_id = '00000000-0000-0000-0000-000000000201'), 0::bigint, 'suspended membership returns no context');
reset role;
update app_private.organization_memberships set status = 'active' where id = '00000000-0000-0000-0000-000000000201';

set local role anon;
select throws_like($$select * from public.current_access_context()$$, '%permission denied%', 'anonymous execution is denied');
reset role;

select throws_like(
  $$insert into app_private.organization_memberships (user_id, organization_id, role) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000102', 'buyer_admin')$$,
  '%Membership role % incompatible%',
  'buyer roles in a trader organization are rejected'
);
select throws_like(
  $$insert into app_private.organization_memberships (user_id, organization_id, role) values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000101', 'trader')$$,
  '%Membership role % incompatible%',
  'trader role in a buyer organization is rejected'
);
select throws_like(
  $$update app_private.organization_memberships set role = 'trader' where id = '00000000-0000-0000-0000-000000000201'$$,
  '%Membership role % incompatible%',
  'incompatible role changes are rejected'
);

select * from finish();
rollback;
