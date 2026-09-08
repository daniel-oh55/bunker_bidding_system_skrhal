begin;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('71000000-0000-4000-8000-000000000001', 'archive-admin@test.local', '{}', '{}'),
  ('71000000-0000-4000-8000-000000000002', 'archive-operator@test.local', '{}', '{}'),
  ('71000000-0000-4000-8000-000000000003', 'archive-trader@test.local', '{}', '{}'),
  ('71000000-0000-4000-8000-000000000004', 'archive-suspended@test.local', '{}', '{}');

update app_private.user_accounts
set status = 'active'
where user_id::text like '71000000-%';

insert into app_private.organizations (id, kind, name, status) values
  ('72000000-0000-4000-8000-000000000001', 'buyer', 'Archive BUYER', 'active'),
  ('72000000-0000-4000-8000-000000000002', 'trader', 'Archive SELLER', 'active');

insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values
  ('73000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'buyer_admin', 'active'),
  ('73000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', 'buyer_operator', 'active'),
  ('73000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000002', 'trader', 'active'),
  ('73000000-0000-4000-8000-000000000004', '71000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000001', 'buyer_operator', 'suspended');

insert into app_private.bids (
  id, vessel_voyage, port_name, delivery_window, deadline_at, status, revision,
  created_by, responsible_buyer_user_id, bid_date, created_at, updated_at, closed_at, cancelled_at
) values
  ('74000000-0000-4000-8000-000000000001', 'Raw open', 'Busan', 'Window', clock_timestamp() + interval '1 day', 'open', 1, '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '2026-09-07', '2026-09-07T01:00:00Z', '2026-09-07T01:00:00Z', null, null),
  ('74000000-0000-4000-8000-000000000002', 'Expired raw open', 'Busan', 'Window', clock_timestamp() - interval '1 day', 'open', 1, '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '2026-09-07', '2026-09-07T02:00:00Z', '2026-09-07T02:00:00Z', null, null),
  ('74000000-0000-4000-8000-000000000003', 'Raw closed', 'Busan', 'Window', clock_timestamp() - interval '1 hour', 'closed', 2, '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '2026-09-07', '2026-09-07T03:00:00Z', '2026-09-07T03:00:00Z', clock_timestamp() - interval '1 hour', null),
  ('74000000-0000-4000-8000-000000000004', 'Cancelled retained', 'Busan', 'Window', clock_timestamp() + interval '1 day', 'cancelled', 2, '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '2026-09-07', '2026-09-07T04:00:00Z', '2026-09-07T04:00:00Z', null, '2026-09-07T04:30:00Z'),
  ('74000000-0000-4000-8000-000000000005', 'Awarded retained', 'Busan', 'Window', clock_timestamp() - interval '1 hour', 'closed', 3, '71000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', '2026-09-07', '2026-09-07T05:00:00Z', '2026-09-07T05:00:00Z', '2026-09-07T05:30:00Z', null),
  ('74000000-0000-4000-8000-000000000006', 'Other date cancelled', 'Busan', 'Window', null, 'cancelled', 2, '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '2026-09-06', '2026-09-06T01:00:00Z', '2026-09-06T01:00:00Z', null, '2026-09-06T02:00:00Z'),
  ('74000000-0000-4000-8000-000000000007', 'Archived filter BID', 'Busan', 'Window', null, 'cancelled', 2, '71000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001', '2026-09-07', '2026-09-07T07:00:00Z', '2026-09-07T07:00:00Z', null, '2026-09-07T07:30:00Z'),
  ('74000000-0000-4000-8000-000000000008', 'Visible cancelled', 'Busan', 'Window', null, 'cancelled', 2, '71000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', '2026-09-07', '2026-09-07T08:00:00Z', '2026-09-07T08:00:00Z', null, '2026-09-07T08:30:00Z'),
  ('74000000-0000-4000-8000-000000000010', 'Ordered archived', 'Busan', 'Window', null, 'cancelled', 2, '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '2026-09-05', '2026-09-05T01:00:00Z', '2026-09-05T01:00:00Z', null, '2026-09-05T01:30:00Z'),
  ('74000000-0000-4000-8000-000000000011', 'Ordered visible', 'Busan', 'Window', null, 'cancelled', 2, '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '2026-09-05', '2026-09-05T02:00:00Z', '2026-09-05T02:00:00Z', null, '2026-09-05T02:30:00Z');

insert into app_private.bid_items (bid_id, fuel_grade, quantity_mt, display_order)
values ('74000000-0000-4000-8000-000000000004', 'vlsfo', 12, 1);

insert into app_private.bid_trader_organization_access (
  bid_id, trader_organization_id, granted_by_user_id, granted_by_membership_id
) values (
  '74000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000002',
  '71000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001'
);

insert into app_private.bid_trader_organization_responses (
  bid_id, trader_organization_id, response_status, revision
) values (
  '74000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000002', 'quoted', 2
);

insert into app_private.quotes (id, bid_id, trader_organization_id, revision, created_by, barge_fee) values
  ('75000000-0000-4000-8000-000000000004', '74000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000002', 1, '71000000-0000-4000-8000-000000000003', 5),
  ('75000000-0000-4000-8000-000000000005', '74000000-0000-4000-8000-000000000005', '72000000-0000-4000-8000-000000000002', 1, '71000000-0000-4000-8000-000000000003', 7);

insert into app_private.quote_items (quote_id, fuel_grade, unit_price, display_order) values
  ('75000000-0000-4000-8000-000000000004', 'vlsfo', 101, 1),
  ('75000000-0000-4000-8000-000000000005', 'vlsfo', 102, 1);

update app_private.bids
set status = 'awarded', awarded_quote_id = '75000000-0000-4000-8000-000000000005', awarded_at = '2026-09-07T06:00:00Z'
where id = '74000000-0000-4000-8000-000000000005';

insert into app_private.bid_audit_events (
  bid_id, event_type, actor_user_id, actor_membership_id, actor_organization_id, actor_role,
  prior_revision, resulting_revision, prior_status, resulting_status,
  prior_responsible_buyer_user_id, resulting_responsible_buyer_user_id, before_snapshot, after_snapshot
) values
  ('74000000-0000-4000-8000-000000000004', 'created', '71000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'buyer_admin', null, 1, null, 'open', null, '71000000-0000-4000-8000-000000000001', null, '{"marker":"created"}'),
  ('74000000-0000-4000-8000-000000000004', 'cancelled', '71000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'buyer_admin', 1, 2, 'open', 'cancelled', '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '{"marker":"before-cancel"}', '{"marker":"after-cancel"}');

insert into app_private.mail_intake_items (
  id, source_provider, source_mailbox_key, source_message_id, received_at, subject,
  converted_bid_id, converted_at, converted_by_user_id, converted_by_membership_id
) values (
  '76000000-0000-4000-8000-000000000004', 'gmail', 'archive-test', 'archive-message-4',
  '2026-09-07T03:00:00Z', 'Archive link retention', '74000000-0000-4000-8000-000000000004',
  '2026-09-07T04:00:00Z', '71000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001'
);

insert into app_private.buyer_bid_order_states (user_id, bid_date, revision, updated_at)
values ('71000000-0000-4000-8000-000000000001', '2026-09-05', 1, '2026-09-05T03:00:00Z');
insert into app_private.buyer_bid_preferences (user_id, bid_date, bid_id, display_order) values
  ('71000000-0000-4000-8000-000000000001', '2026-09-05', '74000000-0000-4000-8000-000000000010', 1),
  ('71000000-0000-4000-8000-000000000001', '2026-09-05', '74000000-0000-4000-8000-000000000011', 2);

update app_private.bids
set archived_at = '2026-09-07T08:00:00Z'
where id = '74000000-0000-4000-8000-000000000007';

create temporary table archive_retention_before on commit drop as
select
  (select jsonb_agg(to_jsonb(item) order by item.display_order) from app_private.bid_items as item where item.bid_id = '74000000-0000-4000-8000-000000000004') as fuel_items,
  (select jsonb_agg(to_jsonb(access) order by access.trader_organization_id) from app_private.bid_trader_organization_access as access where access.bid_id = '74000000-0000-4000-8000-000000000004') as scope_rows,
  (select jsonb_agg(to_jsonb(response) order by response.trader_organization_id) from app_private.bid_trader_organization_responses as response where response.bid_id = '74000000-0000-4000-8000-000000000004') as response_rows,
  (select app_private.quote_snapshot('75000000-0000-4000-8000-000000000004')) as quote_data,
  (select jsonb_agg(to_jsonb(event) order by event.resulting_revision) from app_private.bid_audit_events as event where event.bid_id = '74000000-0000-4000-8000-000000000004') as prior_audits,
  (select jsonb_build_object('awarded_quote_id', bid.awarded_quote_id, 'awarded_at', bid.awarded_at) from app_private.bids as bid where bid.id = '74000000-0000-4000-8000-000000000005') as award_data,
  (select converted_bid_id from app_private.mail_intake_items where id = '76000000-0000-4000-8000-000000000004') as converted_bid_id;

create temporary table archive_order_before on commit drop as
select
  (select to_jsonb(state) from app_private.buyer_bid_order_states as state where state.user_id = '71000000-0000-4000-8000-000000000001' and state.bid_date = '2026-09-05') as state_row,
  (select jsonb_agg(to_jsonb(preference) order by preference.display_order) from app_private.buyer_bid_preferences as preference where preference.user_id = '71000000-0000-4000-8000-000000000001' and preference.bid_date = '2026-09-05') as preference_rows;

select has_column('app_private', 'bids', 'archived_at', 'BID archive timestamp exists');
select col_type_is('app_private', 'bids', 'archived_at', 'timestamp with time zone', 'BID archive timestamp uses timestamptz');
select ok((select is_nullable = 'YES' from information_schema.columns where table_schema = 'app_private' and table_name = 'bids' and column_name = 'archived_at'), 'BID archive timestamp is nullable');
select ok('archived' = any(enum_range(null::app_private.bid_audit_event_type)::text[]), 'archived audit enum value exists');
select has_function('public', 'archive_bid', array['uuid','uuid','bigint'], 'archive RPC has the exact signature');
select has_function('public', 'list_archived_bids', array['uuid','date','text','uuid'], 'archived list RPC has the exact signature');
select has_function('public', 'list_bids', array['uuid','date','text','uuid'], 'normal list signature remains unchanged');
select ok((select prosecdef from pg_proc where oid = 'public.archive_bid(uuid,uuid,bigint)'::regprocedure), 'archive RPC is SECURITY DEFINER');
select ok((select prosecdef from pg_proc where oid = 'public.list_archived_bids(uuid,date,text,uuid)'::regprocedure), 'archived list RPC is SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'public.archive_bid(uuid,uuid,bigint)'::regprocedure), array['search_path=""']::text[], 'archive RPC has fixed empty search_path');
select is((select proconfig from pg_proc where oid = 'public.list_archived_bids(uuid,date,text,uuid)'::regprocedure), array['search_path=""']::text[], 'archived list RPC has fixed empty search_path');
select ok(has_function_privilege('authenticated', 'public.archive_bid(uuid,uuid,bigint)'::regprocedure, 'execute'), 'authenticated may archive');
select ok(not has_function_privilege('anon', 'public.archive_bid(uuid,uuid,bigint)'::regprocedure, 'execute'), 'anon may not archive');
select ok(not exists (select 1 from pg_proc as procedure cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as privilege where procedure.oid = 'public.archive_bid(uuid,uuid,bigint)'::regprocedure and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'), 'PUBLIC may not archive');
select ok(has_function_privilege('authenticated', 'public.list_archived_bids(uuid,date,text,uuid)'::regprocedure, 'execute'), 'authenticated may list archived BIDs');
select ok(not has_function_privilege('anon', 'public.list_archived_bids(uuid,date,text,uuid)'::regprocedure, 'execute'), 'anon may not list archived BIDs');
select ok(not exists (select 1 from pg_proc as procedure cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as privilege where procedure.oid = 'public.list_archived_bids(uuid,date,text,uuid)'::regprocedure and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'), 'PUBLIC may not list archived BIDs');
select ok(exists (select 1 from pg_constraint where conrelid = 'app_private.bids'::regclass and conname = 'bids_archive_terminal_only' and contype = 'c'), 'terminal-only archive constraint exists');
select ok(exists (select 1 from pg_trigger where tgrelid = 'app_private.bids'::regclass and tgname = 'reject_bid_archive_change' and not tgisinternal), 'one-way archive trigger exists');
select ok(not exists (select 1 from pg_attribute where attrelid = 'app_private.bid_api_result'::regclass and attname = 'archived_at' and attnum > 0 and not attisdropped), 'normal BID result shape remains unchanged');

select throws_like($$update app_private.bids set archived_at = clock_timestamp() where id = '74000000-0000-4000-8000-000000000001'$$, '%bids_archive_terminal_only%', 'elevated SQL cannot archive raw open BID');
select throws_like($$update app_private.bids set archived_at = clock_timestamp() where id = '74000000-0000-4000-8000-000000000003'$$, '%bids_archive_terminal_only%', 'elevated SQL cannot archive raw closed BID');
select is(app_private.bid_snapshot('74000000-0000-4000-8000-000000000004') -> 'archived_at', 'null'::jsonb, 'future BID snapshots include null archived_at');

set local role anon;
select throws_like($$select public.archive_bid('73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000004', 2)$$, '%permission denied%', 'anonymous archive execution is denied');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.archive_bid('73000000-0000-4000-8000-000000000003', '74000000-0000-4000-8000-000000000004', 2)$$, '42501', 'An active BUYER membership is required', 'TRADER archive is denied');
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
select throws_ok($$select public.archive_bid('73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000004', 2)$$, '42501', 'An active BUYER membership is required', 'cross-user forged BUYER membership is denied');
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000004', true);
select throws_ok($$select public.archive_bid('73000000-0000-4000-8000-000000000004', '74000000-0000-4000-8000-000000000004', 2)$$, '42501', 'An active BUYER membership is required', 'suspended BUYER membership is denied');
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select throws_ok($$select public.archive_bid('73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000099', 1)$$, 'P0002', 'Bid not found', 'missing BID uses the existing not-found convention');
select throws_ok($$select public.archive_bid('73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000008', null)$$, '40001', 'Bid revision conflict', 'archive requires an expected revision');
select throws_ok($$select public.archive_bid('73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 1)$$, '55000', 'Only raw cancelled or awarded bids can be archived', 'raw open BID is rejected');
select throws_ok($$select public.archive_bid('73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000002', 1)$$, '55000', 'Only raw cancelled or awarded bids can be archived', 'effective-expired raw-open BID is rejected');
select throws_ok($$select public.archive_bid('73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000003', 2)$$, '55000', 'Only raw cancelled or awarded bids can be archived', 'raw closed BID is rejected');

create temporary table archive_admin_result on commit drop as
select result.* from public.archive_bid(
  '73000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000004',
  2
) as result;

select is((select raw_status from archive_admin_result), 'cancelled', 'buyer_admin may archive a cancelled BID');
reset role;
select ok((select archived_at is not null from app_private.bids where id = '74000000-0000-4000-8000-000000000004'), 'successful archive stores archived_at');
select is((select status::text from app_private.bids where id = '74000000-0000-4000-8000-000000000004'), 'cancelled', 'archive preserves cancelled raw status');
select is((select revision from app_private.bids where id = '74000000-0000-4000-8000-000000000004'), 3::bigint, 'archive increments BID revision exactly once');
select is((select count(*) from app_private.bid_audit_events where bid_id = '74000000-0000-4000-8000-000000000004' and event_type = 'archived'), 1::bigint, 'archive appends exactly one archived audit');
select is((select actor_user_id from app_private.bid_audit_events where bid_id = '74000000-0000-4000-8000-000000000004' and event_type = 'archived'), '71000000-0000-4000-8000-000000000001'::uuid, 'archive audit records the authenticated actor user');
select ok((select actor_membership_id = '73000000-0000-4000-8000-000000000001' and actor_organization_id = '72000000-0000-4000-8000-000000000001' and actor_role = 'buyer_admin' from app_private.bid_audit_events where bid_id = '74000000-0000-4000-8000-000000000004' and event_type = 'archived'), 'archive audit records verified membership, organization, and role');
select is((select before_snapshot -> 'archived_at' from app_private.bid_audit_events where bid_id = '74000000-0000-4000-8000-000000000004' and event_type = 'archived'), 'null'::jsonb, 'archive before snapshot has null archived_at');
select ok((select after_snapshot ->> 'archived_at' is not null from app_private.bid_audit_events where bid_id = '74000000-0000-4000-8000-000000000004' and event_type = 'archived'), 'archive after snapshot has non-null archived_at');
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select throws_ok($$select public.archive_bid('73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000004', 3)$$, '55000', 'Bid is already archived', 'already archived BID is rejected');

select throws_ok($$select public.archive_bid('73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000005', 2)$$, '40001', 'Bid revision conflict', 'stale archive revision is rejected');
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
create temporary table archive_operator_result on commit drop as
select result.* from public.archive_bid(
  '73000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000005',
  3
) as result;
select is((select raw_status from archive_operator_result), 'awarded', 'buyer_operator may archive an awarded BID');
reset role;
select is((select status::text from app_private.bids where id = '74000000-0000-4000-8000-000000000005'), 'awarded', 'archive preserves awarded raw status');
select is((select revision from app_private.bids where id = '74000000-0000-4000-8000-000000000005'), 4::bigint, 'awarded archive increments revision exactly once');
select ok((select actor_user_id = '71000000-0000-4000-8000-000000000002' and actor_membership_id = '73000000-0000-4000-8000-000000000002' and actor_role = 'buyer_operator' from app_private.bid_audit_events where bid_id = '74000000-0000-4000-8000-000000000005' and event_type = 'archived'), 'awarded archive audit records the verified operator');

select is((select jsonb_agg(to_jsonb(item) order by item.display_order) from app_private.bid_items as item where item.bid_id = '74000000-0000-4000-8000-000000000004'), (select fuel_items from archive_retention_before), 'archive preserves fuel items');
select is((select jsonb_agg(to_jsonb(access) order by access.trader_organization_id) from app_private.bid_trader_organization_access as access where access.bid_id = '74000000-0000-4000-8000-000000000004'), (select scope_rows from archive_retention_before), 'archive preserves selected SELLER scope');
select is((select jsonb_agg(to_jsonb(response) order by response.trader_organization_id) from app_private.bid_trader_organization_responses as response where response.bid_id = '74000000-0000-4000-8000-000000000004'), (select response_rows from archive_retention_before), 'archive preserves retained response rows');
select is(app_private.quote_snapshot('75000000-0000-4000-8000-000000000004'), (select quote_data from archive_retention_before), 'archive preserves quote and quote-item data');
select is((select jsonb_build_object('awarded_quote_id', bid.awarded_quote_id, 'awarded_at', bid.awarded_at) from app_private.bids as bid where bid.id = '74000000-0000-4000-8000-000000000005'), (select award_data from archive_retention_before), 'archive preserves award data');
select is((select jsonb_agg(to_jsonb(event) order by event.resulting_revision) from app_private.bid_audit_events as event where event.bid_id = '74000000-0000-4000-8000-000000000004' and event.event_type <> 'archived'), (select prior_audits from archive_retention_before), 'archive preserves every prior BID audit row');
select is((select count(*) from app_private.bids where id in ('74000000-0000-4000-8000-000000000004','74000000-0000-4000-8000-000000000005')), 2::bigint, 'archive never deletes the BID');
select is((select converted_bid_id from app_private.mail_intake_items where id = '76000000-0000-4000-8000-000000000004'), (select converted_bid_id from archive_retention_before), 'archive preserves Mail Intake converted BID link');

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.list_bids('73000000-0000-4000-8000-000000000001', '2026-09-07', 'all', null) where id in ('74000000-0000-4000-8000-000000000004','74000000-0000-4000-8000-000000000005','74000000-0000-4000-8000-000000000007')), 0::bigint, 'normal list hides archived BIDs');
select is((select count(*) from public.list_bids('73000000-0000-4000-8000-000000000001', '2026-09-07', 'all', null) where id = '74000000-0000-4000-8000-000000000008'), 1::bigint, 'normal list retains unarchived BID visibility');
select is((select array_agg(id order by id) from public.list_archived_bids('73000000-0000-4000-8000-000000000001', '2026-09-07', 'all', null)), array['74000000-0000-4000-8000-000000000004','74000000-0000-4000-8000-000000000005','74000000-0000-4000-8000-000000000007']::uuid[], 'archived all view returns only same-date archived BIDs');
select is((select array_agg(id order by id) from public.list_archived_bids('73000000-0000-4000-8000-000000000001', '2026-09-07', 'created_by_me', null)), array['74000000-0000-4000-8000-000000000004']::uuid[], 'archived created-by-me view uses authenticated user');
select is((select array_agg(id order by id) from public.list_archived_bids('73000000-0000-4000-8000-000000000001', '2026-09-07', 'responsible_buyer', '71000000-0000-4000-8000-000000000001')), array['74000000-0000-4000-8000-000000000004','74000000-0000-4000-8000-000000000007']::uuid[], 'archived responsible-BUYER view preserves target filtering');
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.list_archived_bids('73000000-0000-4000-8000-000000000002', '2026-09-07', 'all', null)), 3::bigint, 'all approved active BUYERs may read archived history');
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.list_archived_bids('73000000-0000-4000-8000-000000000001', '2026-09-06', 'all', null)), 0::bigint, 'archived list preserves operational-date isolation');
select throws_ok($$select * from public.list_archived_bids('73000000-0000-4000-8000-000000000001', null, 'all', null)$$, '22023', 'A BID operational date is required', 'archived list requires an operational date');
select throws_ok($$select * from public.list_archived_bids('73000000-0000-4000-8000-000000000001', '2026-09-07', 'unknown', null)$$, '22023', 'Unknown bid view', 'archived list validates the view');
select throws_ok($$select * from public.list_archived_bids('73000000-0000-4000-8000-000000000001', '2026-09-07', 'responsible_buyer', null)$$, '22023', 'responsible_buyer view requires a target user', 'archived responsible view requires a target');

select public.archive_bid('73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000010', 2);
reset role;
select is((select to_jsonb(state) from app_private.buyer_bid_order_states as state where state.user_id = '71000000-0000-4000-8000-000000000001' and state.bid_date = '2026-09-05'), (select state_row from archive_order_before), 'archive does not modify personal order state');
select is((select jsonb_agg(to_jsonb(preference) order by preference.display_order) from app_private.buyer_bid_preferences as preference where preference.user_id = '71000000-0000-4000-8000-000000000001' and preference.bid_date = '2026-09-05'), (select preference_rows from archive_order_before), 'archive does not modify personal order preferences');
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select ok((select '74000000-0000-4000-8000-000000000010'::uuid = any(ordered_bid_ids) from public.get_my_bid_order('73000000-0000-4000-8000-000000000001', '2026-09-05')), 'personal full-date order retains archived BID ID');
select is((select revision from public.save_my_bid_order('73000000-0000-4000-8000-000000000001', '2026-09-05', 1, array['74000000-0000-4000-8000-000000000011','74000000-0000-4000-8000-000000000010']::uuid[])), 2, 'complete full-date save still includes archived BID IDs');
select throws_ok($$select * from public.save_my_bid_order('73000000-0000-4000-8000-000000000001', '2026-09-05', 2, array['74000000-0000-4000-8000-000000000011']::uuid[])$$, '40001', 'BID order conflicts with the latest BID list', 'save still rejects a sequence that omits an archived BID');
reset role;

select throws_ok($$update app_private.bids set archived_at = null where id = '74000000-0000-4000-8000-000000000004'$$, '42501', 'Bid archive state is immutable', 'archived_at cannot be cleared');
select throws_ok($$update app_private.bids set archived_at = archived_at + interval '1 second' where id = '74000000-0000-4000-8000-000000000004'$$, '42501', 'Bid archive state is immutable', 'archived_at cannot be changed');

select * from finish();
rollback;
