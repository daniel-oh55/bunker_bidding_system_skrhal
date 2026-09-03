begin;
select plan(75);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('81000000-0000-4000-8000-000000000001', 'admin@seller-admin.test', '{"role":"trader"}', '{"role":"trader"}'),
  ('81000000-0000-4000-8000-000000000002', 'operator@seller-admin.test', '{"role":"buyer_admin"}', '{"role":"buyer_admin"}'),
  ('81000000-0000-4000-8000-000000000003', 'trader-a@seller-admin.test', '{"role":"buyer_admin"}', '{"role":"buyer_admin"}'),
  ('81000000-0000-4000-8000-000000000004', 'trader-b@seller-admin.test', '{}', '{}');
update app_private.user_accounts set status = 'active' where user_id::text like '81000000-%';

insert into app_private.organizations (id, kind, name, status) values
  ('82000000-0000-4000-8000-000000000001', 'buyer', 'Ocean Bunker', 'active'),
  ('82000000-0000-4000-8000-000000000005', 'buyer', ' ocean bunker ', 'active'),
  ('82000000-0000-4000-8000-000000000002', 'trader', 'Ocean Bunker', 'active'),
  ('82000000-0000-4000-8000-000000000003', 'trader', 'Quiet Seller', 'inactive'),
  ('82000000-0000-4000-8000-000000000004', 'trader', 'Held Seller', 'suspended');

insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values
  ('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'buyer_admin', 'active'),
  ('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', 'buyer_operator', 'active'),
  ('83000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000002', 'trader', 'active'),
  ('83000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000002', 'trader', 'active');

insert into app_private.bids (id, vessel_voyage, port_name, delivery_window, deadline_at, status, created_by, responsible_buyer_user_id)
values ('84000000-0000-4000-8000-000000000001', 'Synthetic Seller Retention', 'Busan', 'Synthetic window', clock_timestamp() + interval '1 day', 'open', '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001');
insert into app_private.bid_items (bid_id, fuel_grade, quantity_mt, display_order)
values ('84000000-0000-4000-8000-000000000001', 'vlsfo', 10, 1);
insert into app_private.bid_trader_organization_access (bid_id, trader_organization_id, granted_by_user_id, granted_by_membership_id)
values ('84000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001');
insert into app_private.quotes (id, bid_id, trader_organization_id, created_by, barge_fee)
values ('85000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000003', 1);
insert into app_private.bid_trader_organization_responses (bid_id, trader_organization_id, response_status)
values ('84000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002', 'quoted');
insert into app_private.quote_items (quote_id, fuel_grade, unit_price, display_order)
values ('85000000-0000-4000-8000-000000000001', 'vlsfo', 100, 1);
update app_private.bids
set status = 'awarded', closed_at = clock_timestamp(), awarded_quote_id = '85000000-0000-4000-8000-000000000001', awarded_at = clock_timestamp()
where id = '84000000-0000-4000-8000-000000000001';

select has_table('app_private', 'trader_organization_admin_audit_events', 'private SELLER-admin audit table exists'); -- 1
select ok((select relrowsecurity from pg_class where oid = 'app_private.trader_organization_admin_audit_events'::regclass), 'SELLER-admin audit has RLS'); -- 2
select ok(exists(select 1 from pg_indexes where schemaname = 'app_private' and indexname = 'organizations_trader_normalized_name_uidx' and indexdef like '%UNIQUE%lower(btrim(name))%' and indexdef like '%kind = ''trader''%'), 'TRADER normalized identity has a partial unique index'); -- 3
select ok(not has_function_privilege('anon', 'public.list_trader_organizations_for_admin(uuid)'::regprocedure, 'execute'), 'anon lacks admin-list EXECUTE'); -- 4
select ok(not has_function_privilege('anon', 'public.create_trader_organization(uuid,text)'::regprocedure, 'execute'), 'anon lacks create EXECUTE'); -- 5
select ok(not has_function_privilege('anon', 'public.deactivate_trader_organization(uuid,uuid)'::regprocedure, 'execute'), 'anon lacks deactivate EXECUTE'); -- 6
select ok(has_function_privilege('authenticated', 'public.list_trader_organizations_for_admin(uuid)'::regprocedure, 'execute'), 'authenticated receives narrow admin-list EXECUTE'); -- 7
select ok(has_function_privilege('authenticated', 'public.create_trader_organization(uuid,text)'::regprocedure, 'execute'), 'authenticated receives narrow create EXECUTE'); -- 8
select ok(has_function_privilege('authenticated', 'public.deactivate_trader_organization(uuid,uuid)'::regprocedure, 'execute'), 'authenticated receives narrow deactivate EXECUTE'); -- 9
select ok(not has_function_privilege('authenticated', 'app_private.require_active_buyer_admin_actor(uuid)'::regprocedure, 'execute'), 'authenticated cannot execute BUYER-admin helper'); -- 10
select ok(not has_function_privilege('authenticated', 'app_private.append_trader_organization_admin_audit(app_private.organizations,app_private.trader_organization_admin_event_type,uuid,uuid,uuid,app_private.membership_role,jsonb)'::regprocedure, 'execute'), 'authenticated cannot execute audit append helper'); -- 11
select ok(not has_table_privilege('authenticated', 'app_private.trader_organization_admin_audit_events', 'select'), 'authenticated cannot read admin audit directly'); -- 12
select ok(not has_table_privilege('authenticated', 'app_private.trader_organization_admin_audit_events', 'update'), 'authenticated cannot update admin audit directly'); -- 13
select ok(not has_table_privilege('authenticated', 'app_private.trader_organization_admin_audit_events', 'delete'), 'authenticated cannot delete admin audit directly'); -- 14
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where (n.nspname, p.proname) in (('app_private','reject_trader_organization_admin_audit_mutation'),('app_private','require_active_buyer_admin_actor'),('app_private','trader_organization_admin_snapshot'),('app_private','append_trader_organization_admin_audit'),('public','list_trader_organizations_for_admin'),('public','create_trader_organization'),('public','deactivate_trader_organization')) and p.prosecdef), 7::bigint, 'all seven new functions are SECURITY DEFINER'); -- 15
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where (n.nspname, p.proname) in (('app_private','reject_trader_organization_admin_audit_mutation'),('app_private','require_active_buyer_admin_actor'),('app_private','trader_organization_admin_snapshot'),('app_private','append_trader_organization_admin_audit'),('public','list_trader_organizations_for_admin'),('public','create_trader_organization'),('public','deactivate_trader_organization')) and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'), 7::bigint, 'all seven new functions pin an empty search path'); -- 16
select ok(to_regprocedure('public.reactivate_trader_organization(uuid,uuid)') is null and to_regprocedure('public.update_trader_organization_status(uuid,uuid,text)') is null, 'no reactivation or generic status-update RPC exists'); -- 17

set local role anon;
select throws_like($$select * from public.list_trader_organizations_for_admin('83000000-0000-4000-8000-000000000001')$$, '%permission denied%', 'anon cannot call admin list'); -- 18
select throws_like($$select * from public.create_trader_organization('83000000-0000-4000-8000-000000000001', 'Anon Seller')$$, '%permission denied%', 'anon cannot create'); -- 19
select throws_like($$select * from public.deactivate_trader_organization('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002')$$, '%permission denied%', 'anon cannot deactivate'); -- 20
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select throws_ok($$select * from public.list_trader_organizations_for_admin('83000000-0000-4000-8000-000000000002')$$, '42501', 'An active BUYER administrator membership is required', 'buyer_operator cannot list SELLER masters'); -- 21
select throws_ok($$select * from public.create_trader_organization('83000000-0000-4000-8000-000000000002', 'Operator Seller')$$, '42501', 'An active BUYER administrator membership is required', 'buyer_operator cannot create SELLER masters'); -- 22
select throws_ok($$select * from public.deactivate_trader_organization('83000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000002')$$, '42501', 'An active BUYER administrator membership is required', 'buyer_operator cannot deactivate SELLER masters'); -- 23
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000003', true);
select throws_ok($$select * from public.list_trader_organizations_for_admin('83000000-0000-4000-8000-000000000003')$$, '42501', 'An active BUYER administrator membership is required', 'TRADER cannot list SELLER masters'); -- 24
select throws_ok($$select * from public.create_trader_organization('83000000-0000-4000-8000-000000000003', 'Trader Seller')$$, '42501', 'An active BUYER administrator membership is required', 'TRADER cannot create SELLER masters'); -- 25
select throws_ok($$select * from public.deactivate_trader_organization('83000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000002')$$, '42501', 'An active BUYER administrator membership is required', 'TRADER cannot deactivate SELLER masters'); -- 26

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.list_trader_organizations_for_admin('83000000-0000-4000-8000-000000000001')), 3::bigint, 'buyer_admin lists all active, inactive, and suspended TRADER organizations'); -- 27
select is((select array_agg(organization_status order by organization_status) from public.list_trader_organizations_for_admin('83000000-0000-4000-8000-000000000001')), array['active','inactive','suspended']::text[], 'admin list returns every exact status'); -- 28
select is((select active_trader_membership_count from public.list_trader_organizations_for_admin('83000000-0000-4000-8000-000000000001') where organization_id = '82000000-0000-4000-8000-000000000002'), 2::bigint, 'admin list counts only active TRADER memberships'); -- 29
select is((select array_agg(key order by key) from (select distinct jsonb_object_keys(to_jsonb(result)) as key from public.list_trader_organizations_for_admin('83000000-0000-4000-8000-000000000001') as result) keys), array['active_trader_membership_count','created_at','organization_id','organization_label','organization_status','updated_at']::text[], 'admin list exposes only six narrow fields and no member identity/email'); -- 30
select is((select array_agg(organization_label order by lower(organization_label), organization_id) from public.list_trader_organizations_for_admin('83000000-0000-4000-8000-000000000001')), array['Held Seller','Ocean Bunker','Quiet Seller']::text[], 'admin list order is deterministic by normalized label then ID'); -- 31
select throws_ok($$select * from public.create_trader_organization('83000000-0000-4000-8000-000000000001', '   ')$$, '22023', 'SELLER organization name is required', 'blank normalized name is rejected'); -- 32
select throws_ok($$select * from public.create_trader_organization('83000000-0000-4000-8000-000000000001', repeat('x', 121))$$, '22023', 'SELLER organization name must be at most 120 characters', 'normalized name longer than 120 characters is rejected'); -- 33

reset role;
delete from realtime.messages;
set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
create temporary table created_seller_admin_result on commit drop as
select * from public.create_trader_organization('83000000-0000-4000-8000-000000000001', '  New Seller  ');
reset role;
select ok((select organization.kind = 'trader' and organization.name = 'New Seller' and organization.status = 'active' from app_private.organizations as organization join created_seller_admin_result as result on result.organization_id = organization.id), 'create trims name and creates active kind=trader organization'); -- 34
select is((select count(*) from app_private.organization_memberships where organization_id = (select organization_id from created_seller_admin_result)), 0::bigint, 'create adds no automatic membership'); -- 35
select is((select count(*) from app_private.bid_trader_organization_access where trader_organization_id = (select organization_id from created_seller_admin_result)), 0::bigint, 'create grants no automatic BID scope'); -- 36
select is((select count(*) from auth.users), 4::bigint, 'create adds no Auth user'); -- 37
select is((select count(*) from app_private.trader_organization_admin_audit_events where trader_organization_id = (select organization_id from created_seller_admin_result) and event_type = 'created'), 1::bigint, 'create appends exactly one created audit event'); -- 38
select ok((select actor_user_id = '81000000-0000-4000-8000-000000000001' and actor_membership_id = '83000000-0000-4000-8000-000000000001' and actor_buyer_organization_id = '82000000-0000-4000-8000-000000000001' and actor_role = 'buyer_admin' from app_private.trader_organization_admin_audit_events where trader_organization_id = (select organization_id from created_seller_admin_result)), 'created audit records the server-verified BUYER administrator actor'); -- 39
select ok((select before_snapshot is null and after_snapshot = jsonb_build_object('organization_id', trader_organization_id, 'organization_label', 'New Seller', 'organization_status', 'active') from app_private.trader_organization_admin_audit_events where trader_organization_id = (select organization_id from created_seller_admin_result)), 'created audit has null before and bounded identity/status after snapshot'); -- 40
select is((select count(*) from realtime.messages where event = 'workspace_changed' and topic = 'workspace:buyer' and (payload - 'id') = '{"kind":"workspace_changed"}'::jsonb), 1::bigint, 'creation sends one data-free BUYER workspace invalidation'); -- 41
set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select throws_like($$select * from public.create_trader_organization('83000000-0000-4000-8000-000000000001', ' ocean bunker ')$$, '%duplicate key%', 'active normalized duplicate creation is rejected'); -- 42
select throws_like($$select * from public.create_trader_organization('83000000-0000-4000-8000-000000000001', ' quiet seller ')$$, '%duplicate key%', 'inactive normalized identity remains reserved'); -- 43
select throws_like($$select * from public.create_trader_organization('83000000-0000-4000-8000-000000000001', ' HELD SELLER ')$$, '%duplicate key%', 'suspended normalized identity remains reserved'); -- 44
reset role;
select throws_like($$insert into app_private.organizations(kind,name,status) values ('trader',' OCEAN BUNKER ','active')$$, '%duplicate key%', 'database index rejects direct normalized TRADER duplicates'); -- 45
select is((select count(*) from app_private.organizations where kind = 'buyer' and lower(btrim(name)) = 'ocean bunker'), 2::bigint, 'TRADER uniqueness does not affect duplicate BUYER organization names'); -- 46

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.list_trader_bids('83000000-0000-4000-8000-000000000003') where id = '84000000-0000-4000-8000-000000000001'), 1::bigint, 'active scoped TRADER can list retained test bid before deactivation'); -- 47
reset role;
delete from realtime.messages;
set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
create temporary table deactivated_seller_admin_result on commit drop as
select * from public.deactivate_trader_organization('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002');
reset role;
select is((select organization_status from deactivated_seller_admin_result), 'inactive', 'deactivation returns the narrow inactive organization result'); -- 48
select is((select status::text from app_private.organizations where id = '82000000-0000-4000-8000-000000000002'), 'inactive', 'deactivation transitions active to inactive'); -- 49
select is((select count(*) from realtime.messages where event = 'access_changed' and topic in ('workspace:access:81000000-0000-4000-8000-000000000003','workspace:access:81000000-0000-4000-8000-000000000004')), 2::bigint, 'existing organization trigger invalidates every SELLER member access topic'); -- 50
select is((select count(*) from realtime.messages where event = 'workspace_changed' and topic = 'workspace:buyer'), 1::bigint, 'existing organization trigger invalidates BUYER workspace on deactivation'); -- 51
select is((select count(*) from app_private.trader_organization_admin_audit_events where trader_organization_id = '82000000-0000-4000-8000-000000000002' and event_type = 'deactivated'), 1::bigint, 'actual deactivation appends exactly one audit event'); -- 52
select ok((select actor_role = 'buyer_admin' and before_snapshot ->> 'organization_status' = 'active' and after_snapshot ->> 'organization_status' = 'inactive' and (select count(*) from jsonb_object_keys(before_snapshot)) = 3 and (select count(*) from jsonb_object_keys(after_snapshot)) = 3 from app_private.trader_organization_admin_audit_events where trader_organization_id = '82000000-0000-4000-8000-000000000002' and event_type = 'deactivated'), 'deactivation audit stores bounded before/after identity-status snapshots and actor role'); -- 53
set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select is((select organization_status from public.deactivate_trader_organization('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002')), 'inactive', 'second deactivation is idempotently already complete'); -- 54
reset role;
select is((select count(*) from app_private.trader_organization_admin_audit_events where trader_organization_id = '82000000-0000-4000-8000-000000000002' and event_type = 'deactivated'), 1::bigint, 'idempotent repeat adds no second deactivation audit'); -- 55
set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select throws_ok($$select * from public.deactivate_trader_organization('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000004')$$, '55000', 'Suspended SELLER organizations cannot be deactivated', 'suspended to inactive is rejected'); -- 56
reset role;
select is((select status::text from app_private.organizations where id = '82000000-0000-4000-8000-000000000004'), 'suspended', 'rejected suspended target remains suspended'); -- 57
select is((select count(*) from app_private.organizations where id = '82000000-0000-4000-8000-000000000002'), 1::bigint, 'deactivated organization row is retained'); -- 58
select is((select count(*) from app_private.organization_memberships where organization_id = '82000000-0000-4000-8000-000000000002'), 2::bigint, 'deactivated organization memberships are retained'); -- 59
select is((select count(*) from app_private.bid_trader_organization_access where trader_organization_id = '82000000-0000-4000-8000-000000000002'), 1::bigint, 'deactivated organization old BID scope is retained'); -- 60
select ok((select count(*) = 1 from app_private.quotes where trader_organization_id = '82000000-0000-4000-8000-000000000002') and (select awarded_quote_id = '85000000-0000-4000-8000-000000000001' from app_private.bids where id = '84000000-0000-4000-8000-000000000001'), 'deactivated organization quotes and award identity are retained'); -- 61
set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.list_active_trader_organizations('83000000-0000-4000-8000-000000000001') where organization_id = '82000000-0000-4000-8000-000000000002'), 0::bigint, 'deactivated organization disappears from existing active TRADER list'); -- 62
select is((select organization_status from public.list_trader_organizations_for_admin('83000000-0000-4000-8000-000000000001') where organization_id = '82000000-0000-4000-8000-000000000002'), 'inactive', 'admin list retains deactivated organization as inactive'); -- 63
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.current_access_context()), 0::bigint, 'deactivated SELLER member immediately loses active access context'); -- 64
select throws_ok($$select * from public.list_trader_bids('83000000-0000-4000-8000-000000000003')$$, '42501', 'An active TRADER membership is required', 'deactivated SELLER member cannot list scoped TRADER bids'); -- 65
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select throws_like($$select * from app_private.organizations$$, '%permission denied%', 'authenticated direct organization SELECT remains denied'); -- 66
select throws_like($$update app_private.organizations set name = 'Browser write' where id = '82000000-0000-4000-8000-000000000003'$$, '%permission denied%', 'authenticated direct organization UPDATE remains denied'); -- 67
select throws_like($$insert into app_private.trader_organization_admin_audit_events(trader_organization_id,event_type,actor_user_id,actor_membership_id,actor_buyer_organization_id,actor_role,before_snapshot,after_snapshot) values ('82000000-0000-4000-8000-000000000003','created','81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','buyer_admin',null,'{}')$$, '%permission denied%', 'authenticated direct admin-audit INSERT is denied'); -- 68
select throws_like($$delete from app_private.trader_organization_admin_audit_events$$, '%permission denied%', 'authenticated direct admin-audit DELETE is denied'); -- 69
reset role;
select throws_ok($$update app_private.trader_organization_admin_audit_events set occurred_at = clock_timestamp() where trader_organization_id = '82000000-0000-4000-8000-000000000002'$$, '42501', 'TRADER organization administration audit is append-only', 'append-only trigger rejects elevated audit mutation'); -- 70
select throws_ok($$delete from app_private.trader_organization_admin_audit_events where trader_organization_id = '82000000-0000-4000-8000-000000000002'$$, '42501', 'TRADER organization administration audit is append-only', 'append-only trigger rejects elevated audit deletion'); -- 71

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select ok((select id is not null from public.create_bid('83000000-0000-4000-8000-000000000002', 'Operator authority retained', 'Busan', 'Synthetic window', clock_timestamp() + interval '2 days', null, array['vlsfo'], array[1]::numeric[], array[(select organization_id from created_seller_admin_result)]::uuid[])), 'existing BUYER operator publishing authority remains intact'); -- 72
select throws_ok($$select * from public.list_trader_organizations_for_admin('83000000-0000-4000-8000-000000000001')$$, '42501', 'An active BUYER administrator membership is required', 'forged buyer_admin membership ID does not authorize buyer_operator caller'); -- 73
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select throws_ok($$select * from public.deactivate_trader_organization('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001')$$, '22023', 'Target organization must be a TRADER organization', 'BUYER organization cannot be deactivated through SELLER RPC'); -- 74
reset role;
select is((select count(*) from app_private.trader_organization_admin_audit_events where event_type = 'deactivated'), 1::bigint, 'rejected and idempotent transitions produce no extra deactivation audit'); -- 75

select * from finish();
rollback;
