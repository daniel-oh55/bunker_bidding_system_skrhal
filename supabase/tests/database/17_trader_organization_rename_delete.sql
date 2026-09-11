begin;
select plan(50);

insert into auth.users (id, email) values
  ('91000000-0000-4000-8000-000000000001', 'admin@seller-rename-delete.test'),
  ('91000000-0000-4000-8000-000000000002', 'operator@seller-rename-delete.test'),
  ('91000000-0000-4000-8000-000000000003', 'trader@seller-rename-delete.test'),
  ('91000000-0000-4000-8000-000000000004', 'inactive@seller-rename-delete.test');
update app_private.user_accounts set status = 'active' where user_id::text like '91000000-%';

insert into app_private.organizations (id, kind, name, status) values
  ('92000000-0000-4000-8000-000000000001', 'buyer', 'Rename Delete Buyer', 'active'),
  ('92000000-0000-4000-8000-000000000002', 'buyer', 'Not A Seller', 'active'),
  ('92000000-0000-4000-8000-000000000003', 'trader', 'Rename Alpha', 'active'),
  ('92000000-0000-4000-8000-000000000004', 'trader', 'Duplicate Seller', 'active'),
  ('92000000-0000-4000-8000-000000000005', 'trader', 'Inactive Rename', 'inactive'),
  ('92000000-0000-4000-8000-000000000006', 'trader', 'Suspended Rename', 'suspended'),
  ('92000000-0000-4000-8000-000000000007', 'trader', 'Trader Actor', 'active'),
  ('92000000-0000-4000-8000-000000000008', 'trader', 'Membership History', 'active'),
  ('92000000-0000-4000-8000-000000000009', 'trader', 'Access History', 'active'),
  ('92000000-0000-4000-8000-000000000010', 'trader', 'Response History', 'active'),
  ('92000000-0000-4000-8000-000000000011', 'trader', 'Quote History', 'active'),
  ('92000000-0000-4000-8000-000000000012', 'trader', 'Audit Actor History', 'active');

insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values
  ('93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'buyer_admin', 'active'),
  ('93000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', 'buyer_operator', 'active'),
  ('93000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000007', 'trader', 'active'),
  ('93000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000008', 'trader', 'inactive');

insert into app_private.bids (id, vessel_voyage, port_name, delivery_window, deadline_at, status, created_by, responsible_buyer_user_id)
values ('94000000-0000-4000-8000-000000000001', 'Delete dependency', 'Busan', 'Window', clock_timestamp() + interval '1 day', 'open', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001');
insert into app_private.bid_items (bid_id, fuel_grade, quantity_mt, display_order)
values ('94000000-0000-4000-8000-000000000001', 'vlsfo', 1, 1);
insert into app_private.bid_trader_organization_access (bid_id, trader_organization_id, granted_by_user_id, granted_by_membership_id)
values ('94000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000009', '91000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001');
insert into app_private.bid_trader_organization_responses (bid_id, trader_organization_id, response_status)
values ('94000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000010', 'awaiting');
insert into app_private.quotes (id, bid_id, trader_organization_id, created_by, barge_fee)
values ('95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000011', '91000000-0000-4000-8000-000000000003', 0);
insert into app_private.quote_audit_events (quote_id, bid_id, trader_organization_id, event_type, actor_user_id, actor_membership_id, actor_organization_id, actor_role, prior_revision, resulting_revision, before_snapshot, after_snapshot)
values ('95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000011', 'created', '91000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000012', 'trader', null, 1, null, '{}'::jsonb);

select ok(enum_range(null::app_private.trader_organization_admin_event_type)::text[] @> array['renamed', 'deleted'], 'admin audit enum has rename and delete labels'); -- 1
select ok(not has_function_privilege('anon', 'public.rename_trader_organization(uuid,uuid,text,text,text)'::regprocedure, 'execute') and not has_function_privilege('anon', 'public.delete_trader_organization(uuid,uuid,text,text)'::regprocedure, 'execute'), 'anon has no rename/delete EXECUTE'); -- 2
select ok(has_function_privilege('authenticated', 'public.rename_trader_organization(uuid,uuid,text,text,text)'::regprocedure, 'execute') and has_function_privilege('authenticated', 'public.delete_trader_organization(uuid,uuid,text,text)'::regprocedure, 'execute'), 'authenticated has narrow rename/delete EXECUTE'); -- 3
select ok(not has_function_privilege('authenticated', 'app_private.is_trader_organization_admin_snapshot(jsonb)'::regprocedure, 'execute'), 'authenticated cannot invoke the snapshot helper'); -- 4

set local role anon;
select throws_like($$select * from public.rename_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000003','Rename Alpha','active','Denied')$$, '%permission denied%', 'anon cannot rename'); -- 5
select throws_like($$select * from public.delete_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000003','Rename Alpha','active')$$, '%permission denied%', 'anon cannot delete'); -- 6
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select throws_ok($$select * from public.rename_trader_organization('93000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','Rename Alpha','active','Denied')$$, '42501', 'An active BUYER administrator membership is required', 'buyer_operator cannot rename'); -- 7
select throws_ok($$select * from public.delete_trader_organization('93000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','Rename Alpha','active')$$, '42501', 'An active BUYER administrator membership is required', 'buyer_operator cannot delete'); -- 8
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
select throws_ok($$select * from public.rename_trader_organization('93000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000003','Rename Alpha','active','Denied')$$, '42501', 'An active BUYER administrator membership is required', 'TRADER cannot rename'); -- 9
select throws_ok($$select * from public.delete_trader_organization('93000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000003','Rename Alpha','active')$$, '42501', 'An active BUYER administrator membership is required', 'TRADER cannot delete'); -- 10
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select throws_ok($$select * from public.rename_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000003','Rename Alpha','active','Denied')$$, '42501', 'An active BUYER administrator membership is required', 'forged admin membership is denied'); -- 11
reset role;

update app_private.user_accounts set status = 'inactive' where user_id = '91000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select throws_ok($$select * from public.rename_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000003','Rename Alpha','active','Denied')$$, '42501', 'An active BUYER administrator membership is required', 'inactive actor is denied'); -- 12
reset role;
update app_private.user_accounts set status = 'active' where user_id = '91000000-0000-4000-8000-000000000001';
update app_private.organization_memberships set status = 'suspended' where id = '93000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select throws_ok($$select * from public.delete_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000003','Rename Alpha','active')$$, '42501', 'An active BUYER administrator membership is required', 'suspended actor membership is denied'); -- 13
reset role;
update app_private.organization_memberships set status = 'active' where id = '93000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select throws_ok($$select * from public.rename_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','Not A Seller','active','Denied')$$, '22023', 'Target organization must be a TRADER organization', 'BUYER organization cannot be renamed'); -- 14
select throws_ok($$select * from public.delete_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','Not A Seller','active')$$, '22023', 'Target organization must be a TRADER organization', 'BUYER organization cannot be deleted'); -- 15
create temporary table renamed_result on commit drop as select * from public.rename_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000003','Rename Alpha','active','  Renamed Alpha  ');
reset role;
select ok((select organization_id = '92000000-0000-4000-8000-000000000003' and organization_label = 'Renamed Alpha' and organization_status = 'active' from renamed_result), 'rename trims and preserves identity/status'); -- 16
select ok((select before_snapshot = jsonb_build_object('organization_id','92000000-0000-4000-8000-000000000003','organization_label','Rename Alpha','organization_status','active') and after_snapshot = jsonb_build_object('organization_id','92000000-0000-4000-8000-000000000003','organization_label','Renamed Alpha','organization_status','active') and actor_user_id = '91000000-0000-4000-8000-000000000001' and actor_membership_id = '93000000-0000-4000-8000-000000000001' from app_private.trader_organization_admin_audit_events where trader_organization_id = '92000000-0000-4000-8000-000000000003' and event_type = 'renamed'), 'rename audit records exact snapshots and verified actor'); -- 17
select is((select count(*) from app_private.trader_organization_admin_audit_events where trader_organization_id = '92000000-0000-4000-8000-000000000003' and event_type = 'renamed'), 1::bigint, 'first actual rename appends one event'); -- 18

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select is((select organization_status from public.rename_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000005','Inactive Rename','inactive','Inactive Renamed')), 'inactive', 'inactive SELLER can be renamed'); -- 19
select is((select organization_status from public.rename_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000006','Suspended Rename','suspended','Suspended Renamed')), 'suspended', 'suspended SELLER can be renamed'); -- 20
select throws_ok($$select * from public.rename_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000003','Renamed Alpha','active','   ')$$, '22023', 'SELLER organization name is required', 'blank rename is rejected'); -- 21
select throws_ok($$select * from public.rename_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000003','Renamed Alpha','active',repeat('x',121))$$, '22023', 'SELLER organization name must be at most 120 characters', 'long rename is rejected'); -- 22
select throws_like($$select * from public.rename_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000003','Renamed Alpha','active',' duplicate seller ')$$, '%duplicate key%', 'normalized duplicate rename is rejected'); -- 23
reset role;
select is((select count(*) from app_private.trader_organization_admin_audit_events where trader_organization_id = '92000000-0000-4000-8000-000000000003' and event_type = 'renamed'), 1::bigint, 'normalized no-op has no audit event before repeat'); -- 24
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select is((select organization_label from public.rename_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000003','Renamed Alpha','active',' renamed alpha ')), 'Renamed Alpha', 'case-insensitive normalized no-op returns current row'); -- 25
reset role;
select is((select count(*) from app_private.trader_organization_admin_audit_events where trader_organization_id = '92000000-0000-4000-8000-000000000003' and event_type = 'renamed'), 1::bigint, 'normalized no-op adds no audit event'); -- 26
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select is((select organization_label from public.rename_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000003','Renamed Alpha','active','Renamed Beta')), 'Renamed Beta', 'second actual rename succeeds'); -- 27
reset role;
select is((select count(*) from app_private.trader_organization_admin_audit_events where trader_organization_id = '92000000-0000-4000-8000-000000000003' and event_type = 'renamed'), 2::bigint, 'multiple actual renames are append-only'); -- 28
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select throws_ok($$select * from public.rename_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000003','Renamed Alpha','active','Stale')$$, '40001', 'SELLER organization changed; reload and try again', 'stale expected label is rejected'); -- 29
select throws_ok($$select * from public.delete_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000003','Renamed Beta','inactive')$$, '40001', 'SELLER organization changed; reload and try again', 'stale expected status is rejected'); -- 30

create temporary table delete_result on commit drop as select * from public.create_trader_organization('93000000-0000-4000-8000-000000000001', 'Delete Base');
select is((select organization_label from public.rename_trader_organization('93000000-0000-4000-8000-000000000001',(select organization_id from delete_result),'Delete Base','active','Delete Final')), 'Delete Final', 'delete candidate can be renamed first'); -- 31
select is((select organization_status from public.deactivate_trader_organization('93000000-0000-4000-8000-000000000001',(select organization_id from delete_result))), 'inactive', 'existing deactivate remains available before deletion'); -- 32
create temporary table deleted_result on commit drop as select * from public.delete_trader_organization('93000000-0000-4000-8000-000000000001',(select organization_id from delete_result),'Delete Final','inactive');
reset role;
select is((select count(*) from app_private.organizations where id = (select organization_id from delete_result)), 0::bigint, 'unused SELLER row is physically deleted'); -- 33
select ok((select organization_id = (select organization_id from delete_result) and organization_label = 'Delete Final' and organization_status = 'inactive' from deleted_result), 'delete returns the narrow final result'); -- 34
select is((select count(*) from app_private.trader_organization_admin_audit_events where trader_organization_id = (select organization_id from delete_result) and event_type in ('created','renamed','deactivated','deleted')), 4::bigint, 'created/renamed/deactivated/deleted admin audit history survives'); -- 35
select ok((select before_snapshot = jsonb_build_object('organization_id',(select organization_id from delete_result),'organization_label','Delete Final','organization_status','inactive') and after_snapshot is null from app_private.trader_organization_admin_audit_events where trader_organization_id = (select organization_id from delete_result) and event_type = 'deleted'), 'deleted audit is a final before-only tombstone'); -- 36
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.list_trader_organizations_for_admin('93000000-0000-4000-8000-000000000001') where organization_id = (select organization_id from delete_result)), 0::bigint, 'deleted SELLER disappears from admin list'); -- 37
select is((select count(*) from public.list_active_trader_organizations('93000000-0000-4000-8000-000000000001') where organization_id = (select organization_id from delete_result)), 0::bigint, 'deleted SELLER disappears from active list'); -- 38
create temporary table recreated_result on commit drop as select * from public.create_trader_organization('93000000-0000-4000-8000-000000000001', ' delete final ');
reset role;
select ok((select organization_id <> (select organization_id from delete_result) and organization_label = 'delete final' from recreated_result), 'deleted normalized name can be created with a new UUID'); -- 39

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select throws_ok($$select * from public.delete_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000008','Membership History','active')$$, '55000', 'SELLER organization has memberships or retained bidding history; deactivate it instead', 'inactive membership blocks delete'); -- 40
select throws_ok($$select * from public.delete_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000009','Access History','active')$$, '55000', 'SELLER organization has memberships or retained bidding history; deactivate it instead', 'BID access blocks delete'); -- 41
select throws_ok($$select * from public.delete_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000010','Response History','active')$$, '55000', 'SELLER organization has memberships or retained bidding history; deactivate it instead', 'retained response blocks delete'); -- 42
select throws_ok($$select * from public.delete_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000011','Quote History','active')$$, '55000', 'SELLER organization has memberships or retained bidding history; deactivate it instead', 'quote/commercial history blocks delete'); -- 43
select throws_ok($$select * from public.delete_trader_organization('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000012','Audit Actor History','active')$$, '55000', 'SELLER organization has memberships or retained bidding history; deactivate it instead', 'retained business audit actor identity blocks delete'); -- 44
reset role;
select is((select count(*) from app_private.trader_organization_admin_audit_events where trader_organization_id in ('92000000-0000-4000-8000-000000000008','92000000-0000-4000-8000-000000000009','92000000-0000-4000-8000-000000000010','92000000-0000-4000-8000-000000000011','92000000-0000-4000-8000-000000000012') and event_type = 'deleted'), 0::bigint, 'rejected deletes add no tombstones'); -- 45
select is((select count(*) from auth.users where id::text like '91000000-%'), 4::bigint, 'rename and delete create or delete no Auth users'); -- 46
select is((select count(*) from app_private.organization_memberships where organization_id = '92000000-0000-4000-8000-000000000008'), 1::bigint, 'rejected delete leaves unrelated membership intact'); -- 47

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select throws_like($$update app_private.organizations set name = 'Browser write' where id = '92000000-0000-4000-8000-000000000003'$$, '%permission denied%', 'direct authenticated organization UPDATE remains denied'); -- 48
select throws_like($$delete from app_private.organizations where id = '92000000-0000-4000-8000-000000000003'$$, '%permission denied%', 'direct authenticated organization DELETE remains denied'); -- 49
reset role;
select throws_ok($$delete from app_private.trader_organization_admin_audit_events where trader_organization_id = '92000000-0000-4000-8000-000000000003'$$, '42501', 'TRADER organization administration audit is append-only', 'admin audit remains append-only'); -- 50

select * from finish();
rollback;
