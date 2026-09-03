begin;
select plan(42);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('61000000-0000-4000-8000-000000000001', 'order-admin@test.local', '{}', '{}'),
  ('61000000-0000-4000-8000-000000000002', 'order-operator@test.local', '{}', '{}'),
  ('61000000-0000-4000-8000-000000000003', 'order-trader@test.local', '{}', '{}'),
  ('61000000-0000-4000-8000-000000000004', 'order-inactive@test.local', '{}', '{}');
update app_private.user_accounts set status = 'active' where user_id::text like '61000000-%';
insert into app_private.organizations (id, kind, name, status) values
  ('62000000-0000-4000-8000-000000000001', 'buyer', 'Order BUYER', 'active'),
  ('62000000-0000-4000-8000-000000000002', 'trader', 'Order SELLER', 'active'),
  ('62000000-0000-4000-8000-000000000003', 'buyer', 'Inactive order BUYER', 'inactive');
insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values
  ('63000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', 'buyer_admin', 'active'),
  ('63000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000001', 'buyer_operator', 'active'),
  ('63000000-0000-4000-8000-000000000003', '61000000-0000-4000-8000-000000000003', '62000000-0000-4000-8000-000000000002', 'trader', 'active'),
  ('63000000-0000-4000-8000-000000000004', '61000000-0000-4000-8000-000000000004', '62000000-0000-4000-8000-000000000003', 'buyer_operator', 'active');
insert into app_private.bids (id, vessel_voyage, port_name, delivery_window, status, created_by, responsible_buyer_user_id, bid_date, created_at, updated_at) values
  ('64000000-0000-4000-8000-000000000001', 'Order first', 'Busan', 'Window', 'open', '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '2026-09-03', '2026-09-03T01:00:00Z', '2026-09-03T01:00:00Z'),
  ('64000000-0000-4000-8000-000000000002', 'Order second', 'Busan', 'Window', 'open', '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '2026-09-03', '2026-09-03T02:00:00Z', '2026-09-03T02:00:00Z'),
  ('64000000-0000-4000-8000-000000000003', 'Order third', 'Busan', 'Window', 'open', '61000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000002', '2026-09-03', '2026-09-03T03:00:00Z', '2026-09-03T03:00:00Z'),
  ('64000000-0000-4000-8000-000000000004', 'Other date', 'Busan', 'Window', 'open', '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '2026-09-02', '2026-09-02T03:00:00Z', '2026-09-02T03:00:00Z');

select has_table('app_private', 'buyer_bid_order_states', 'private order state table exists'); -- 1
select has_table('app_private', 'buyer_bid_preferences', 'private preference table exists'); -- 2
select ok((select relation.relrowsecurity from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace where namespace.nspname = 'app_private' and relation.relname = 'buyer_bid_order_states'), 'state RLS is enabled'); -- 3
select ok((select relation.relrowsecurity from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace where namespace.nspname = 'app_private' and relation.relname = 'buyer_bid_preferences'), 'preference RLS is enabled'); -- 4
select ok(not has_table_privilege('anon', 'app_private.buyer_bid_order_states', 'select,insert,update,delete'), 'anon has no state table privileges'); -- 5
select ok(not has_table_privilege('authenticated', 'app_private.buyer_bid_order_states', 'select,insert,update,delete'), 'authenticated has no state table privileges'); -- 6
select ok(not has_table_privilege('anon', 'app_private.buyer_bid_preferences', 'select,insert,update,delete'), 'anon has no preference table privileges'); -- 7
select ok(not has_table_privilege('authenticated', 'app_private.buyer_bid_preferences', 'select,insert,update,delete'), 'authenticated has no preference table privileges'); -- 8
select ok(not exists (select 1 from pg_class relation cross join lateral aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) privilege join pg_namespace namespace on namespace.oid = relation.relnamespace where namespace.nspname = 'app_private' and relation.relname = 'buyer_bid_order_states' and privilege.grantee = 0), 'PUBLIC has no state table privileges'); -- 9
select ok(not exists (select 1 from pg_class relation cross join lateral aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) privilege join pg_namespace namespace on namespace.oid = relation.relnamespace where namespace.nspname = 'app_private' and relation.relname = 'buyer_bid_preferences' and privilege.grantee = 0), 'PUBLIC has no preference table privileges'); -- 10
select has_function('public', 'get_my_bid_order', array['uuid','date'], 'narrow GET RPC exists'); -- 11
select has_function('public', 'save_my_bid_order', array['uuid','date','integer','uuid[]'], 'narrow SAVE RPC exists'); -- 12
select is((select proconfig from pg_proc where oid = 'public.get_my_bid_order(uuid,date)'::regprocedure), array['search_path=""']::text[], 'GET has fixed empty search_path'); -- 13
select is((select proconfig from pg_proc where oid = 'public.save_my_bid_order(uuid,date,integer,uuid[])'::regprocedure), array['search_path=""']::text[], 'SAVE has fixed empty search_path'); -- 14
select ok(not has_function_privilege('anon', 'public.get_my_bid_order(uuid,date)'::regprocedure, 'execute'), 'anon cannot GET'); -- 15
select ok(not has_function_privilege('anon', 'public.save_my_bid_order(uuid,date,integer,uuid[])'::regprocedure, 'execute'), 'anon cannot SAVE'); -- 16
select ok(has_function_privilege('authenticated', 'public.get_my_bid_order(uuid,date)'::regprocedure, 'execute'), 'authenticated can GET'); -- 17
select ok(has_function_privilege('authenticated', 'public.save_my_bid_order(uuid,date,integer,uuid[])'::regprocedure, 'execute'), 'authenticated can SAVE'); -- 18

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select is((select revision from public.get_my_bid_order('63000000-0000-4000-8000-000000000001', '2026-09-03')), 0, 'new preference revision starts at zero'); -- 19
select is((select ordered_bid_ids from public.get_my_bid_order('63000000-0000-4000-8000-000000000001', '2026-09-03')), array['64000000-0000-4000-8000-000000000003','64000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000001']::uuid[], 'GET uses list_bids fallback order'); -- 18
select is((select revision from public.save_my_bid_order('63000000-0000-4000-8000-000000000001', '2026-09-03', 0, array['64000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000003']::uuid[])), 1, 'active buyer_admin first save succeeds'); -- 19
select is((select revision from public.save_my_bid_order('63000000-0000-4000-8000-000000000001', '2026-09-03', 1, array['64000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000003']::uuid[])), 2, 'subsequent save increments exactly once'); -- 20
select is((select ordered_bid_ids from public.get_my_bid_order('63000000-0000-4000-8000-000000000001', '2026-09-03')), array['64000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000003']::uuid[], 'GET returns saved full order'); -- 21
select throws_ok($$select * from public.save_my_bid_order('63000000-0000-4000-8000-000000000001', '2026-09-03', 1, array['64000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000003']::uuid[])$$, '40001', 'BID order revision conflict', 'stale revision is rejected'); -- 22
select throws_ok($$select * from public.save_my_bid_order('63000000-0000-4000-8000-000000000001', '2026-09-03', 2, null)$$, '22023', 'A complete BID order is required', 'null array is rejected'); -- 23
select throws_ok($$select * from public.save_my_bid_order('63000000-0000-4000-8000-000000000001', '2026-09-03', 2, array['64000000-0000-4000-8000-000000000001',null,'64000000-0000-4000-8000-000000000003']::uuid[])$$, '22023', 'BID order cannot contain null IDs', 'null element is rejected'); -- 24
select throws_ok($$select * from public.save_my_bid_order('63000000-0000-4000-8000-000000000001', '2026-09-03', 2, array['64000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000003']::uuid[])$$, '22023', 'BID order cannot contain duplicate IDs', 'duplicate IDs are rejected'); -- 25
select throws_ok($$select * from public.save_my_bid_order('63000000-0000-4000-8000-000000000001', '2026-09-03', 2, array['64000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000099']::uuid[])$$, '22023', 'BID order contains an unknown BID', 'unknown BID is rejected'); -- 26
select throws_ok($$select * from public.save_my_bid_order('63000000-0000-4000-8000-000000000001', '2026-09-03', 2, array['64000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000004']::uuid[])$$, '22023', 'BID order must contain only BIDs from the selected date', 'cross-date BID is rejected'); -- 27
select throws_ok($$select * from public.save_my_bid_order('63000000-0000-4000-8000-000000000001', '2026-09-03', 2, array['64000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000002']::uuid[])$$, '40001', 'BID order conflicts with the latest BID list', 'incomplete stale BID set is rejected'); -- 28
select is((select count(*) from app_private.buyer_bid_preferences where user_id = '61000000-0000-4000-8000-000000000001' and bid_date = '2026-09-03'), 3::bigint, 'all submitted BID IDs are retained exactly once'); -- 29
select is((select revision from app_private.bids where id = '64000000-0000-4000-8000-000000000001'), 1::bigint, 'preference save did not increment BID revision'); -- 30
select is((select count(*) from app_private.bid_audit_events where bid_id in ('64000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000003')), 0::bigint, 'preference save created no BID audit'); -- 31
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
select is((select revision from public.save_my_bid_order('63000000-0000-4000-8000-000000000002', '2026-09-03', 0, array['64000000-0000-4000-8000-000000000003','64000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000001']::uuid[])), 1, 'active buyer_operator may SAVE independently'); -- 32
select isnt((select ordered_bid_ids from public.get_my_bid_order('63000000-0000-4000-8000-000000000002', '2026-09-03')), (select ordered_bid_ids from public.get_my_bid_order('63000000-0000-4000-8000-000000000001', '2026-09-03')), 'two BUYER users have independent orders'); -- 33
select throws_ok($$select * from public.get_my_bid_order('63000000-0000-4000-8000-000000000001', '2026-09-03')$$, '42501', 'An active BUYER membership is required', 'forged membership is denied'); -- 34
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000003', true);
select throws_ok($$select * from public.get_my_bid_order('63000000-0000-4000-8000-000000000003', '2026-09-03')$$, '42501', 'An active BUYER membership is required', 'TRADER is denied'); -- 35
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000004', true);
select throws_ok($$select * from public.get_my_bid_order('63000000-0000-4000-8000-000000000004', '2026-09-03')$$, '42501', 'An active BUYER membership is required', 'inactive BUYER organization is denied'); -- 36
reset role;
update app_private.user_accounts set status = 'inactive' where user_id = '61000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
select throws_ok($$select * from public.get_my_bid_order('63000000-0000-4000-8000-000000000002', '2026-09-03')$$, '42501', 'An active BUYER membership is required', 'inactive account is denied'); -- 37
reset role;
update app_private.user_accounts set status = 'active' where user_id = '61000000-0000-4000-8000-000000000002';
update app_private.organization_memberships set status = 'inactive' where id = '63000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
select throws_ok($$select * from public.get_my_bid_order('63000000-0000-4000-8000-000000000002', '2026-09-03')$$, '42501', 'An active BUYER membership is required', 'inactive membership is denied'); -- 38
reset role;
insert into app_private.bids (id, vessel_voyage, port_name, delivery_window, status, created_by, responsible_buyer_user_id, bid_date, created_at, updated_at) values ('64000000-0000-4000-8000-000000000005', 'New unsaved preference BID', 'Busan', 'Window', 'open', '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '2026-09-03', '2026-09-03T04:00:00Z', '2026-09-03T04:00:00Z');
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select is((select ordered_bid_ids from public.get_my_bid_order('63000000-0000-4000-8000-000000000001', '2026-09-03')), array['64000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000003','64000000-0000-4000-8000-000000000005']::uuid[], 'new BID missing from preference is appended and never hidden'); -- 39
select is((select count(*) from app_private.buyer_bid_preferences where user_id = '61000000-0000-4000-8000-000000000001' and bid_id = '64000000-0000-4000-8000-000000000005'), 0::bigint, 'GET does not mutate storage for newly missing BID'); -- 40
select * from finish();
rollback;
