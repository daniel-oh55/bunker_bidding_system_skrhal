begin;
select plan(49);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('51000000-0000-4000-8000-000000000001', 'admin@bid-date.test', '{}', '{}'),
  ('51000000-0000-4000-8000-000000000002', 'operator@bid-date.test', '{}', '{}'),
  ('51000000-0000-4000-8000-000000000003', 'trader@bid-date.test', '{}', '{}');
update app_private.user_accounts set status = 'active' where user_id::text like '51000000-%';

insert into app_private.organizations (id, kind, name, status) values
  ('52000000-0000-4000-8000-000000000001', 'buyer', 'Operational Date Buyer', 'active'),
  ('52000000-0000-4000-8000-000000000002', 'trader', 'Operational Date Seller', 'active');

insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values
  ('53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', 'buyer_admin', 'active'),
  ('53000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000001', 'buyer_operator', 'active'),
  ('53000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000003', '52000000-0000-4000-8000-000000000002', 'trader', 'active');

select has_column('app_private', 'bids', 'bid_date', 'BID operational date column exists'); -- 1
select col_type_is('app_private', 'bids', 'bid_date', 'date', 'BID operational date uses date type'); -- 2
select col_not_null('app_private', 'bids', 'bid_date', 'BID operational date is NOT NULL'); -- 3
select matches(
  (select column_default from information_schema.columns where table_schema = 'app_private' and table_name = 'bids' and column_name = 'bid_date'),
  'app_private[.]current_bid_date[(][)]',
  'BID operational date has the private server-clock default'
); -- 4
select has_index('app_private', 'bids', 'bids_bid_date_created_at_idx', 'date-scoped BID listing index exists'); -- 5
select has_function('app_private', 'current_bid_date', array[]::text[], 'private current BID date helper exists'); -- 6

set local timezone = 'UTC';
select is(app_private.current_bid_date(), (clock_timestamp() at time zone 'Asia/Seoul')::date, 'current BID date uses Asia/Seoul under UTC session timezone'); -- 7
set local timezone = 'America/Los_Angeles';
select is(app_private.current_bid_date(), (clock_timestamp() at time zone 'Asia/Seoul')::date, 'current BID date is independent of another session timezone'); -- 8
set local timezone = 'UTC';
select ok(not has_function_privilege('anon', 'app_private.current_bid_date()'::regprocedure, 'execute'), 'anon cannot execute private current date helper'); -- 9
select ok(not has_function_privilege('authenticated', 'app_private.current_bid_date()'::regprocedure, 'execute'), 'authenticated cannot execute private current date helper'); -- 10

insert into app_private.bids (
  id, vessel_voyage, port_name, delivery_window, deadline_at, status, created_by,
  responsible_buyer_user_id, created_at, updated_at, bid_date
) values (
  '54000000-0000-4000-8000-000000000001', 'Historical BID', 'Busan', 'Historical delivery',
  clock_timestamp() + interval '2 days', 'open', '51000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001', clock_timestamp() - interval '2 days',
  clock_timestamp() - interval '2 days', app_private.current_bid_date() - 1
);
insert into app_private.bid_items (bid_id, fuel_grade, quantity_mt, display_order)
values ('54000000-0000-4000-8000-000000000001', 'vlsfo', 10, 1);
insert into app_private.bid_trader_organization_access (bid_id, trader_organization_id, granted_by_user_id, granted_by_membership_id)
values ('54000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001');
insert into app_private.bid_audit_events (
  bid_id, event_type, actor_user_id, actor_membership_id, actor_organization_id, actor_role,
  prior_revision, resulting_revision, prior_status, resulting_status,
  prior_responsible_buyer_user_id, resulting_responsible_buyer_user_id, before_snapshot, after_snapshot
) values (
  '54000000-0000-4000-8000-000000000001', 'created', '51000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', 'buyer_admin',
  null, 1, null, 'open', null, '51000000-0000-4000-8000-000000000001', null,
  app_private.bid_snapshot('54000000-0000-4000-8000-000000000001')
);

select throws_ok(
  $$update app_private.bids set bid_date = bid_date + 1 where id = '54000000-0000-4000-8000-000000000001'$$,
  '42501', 'Bid operational date is immutable', 'BID operational date rejects direct update'
); -- 11
select is((select revision from app_private.bids where id = '54000000-0000-4000-8000-000000000001'), 1::bigint, 'rejected date update leaves BID revision unchanged'); -- 12
select is((select count(*) from app_private.bid_audit_events where bid_id = '54000000-0000-4000-8000-000000000001'), 1::bigint, 'rejected date update creates no audit event'); -- 13

set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
create temporary table bid_date_admin_bid on commit drop as
select result.* from public.create_bid(
  '53000000-0000-4000-8000-000000000001', 'Admin Current BID', 'Busan', 'Current delivery',
  clock_timestamp() + interval '2 days', null, array['vlsfo'], array[20]::numeric[]
) as result;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000002', true);
create temporary table bid_date_operator_bid on commit drop as
select result.* from public.create_bid(
  '53000000-0000-4000-8000-000000000002', 'Operator Current BID', 'Incheon', 'Current delivery',
  clock_timestamp() + interval '2 days', '51000000-0000-4000-8000-000000000001', array['vlsfo'], array[30]::numeric[]
) as result;
reset role;

select is((select bid_date from bid_date_admin_bid), app_private.current_bid_date(), 'buyer_admin BID gets server current Seoul date'); -- 14
select is((select bid_date from bid_date_operator_bid), app_private.current_bid_date(), 'buyer_operator BID gets server current Seoul date'); -- 15
select is((select revision from bid_date_admin_bid), 1::bigint, 'new BID remains revision 1'); -- 16
select is((select count(*) from app_private.bid_trader_organization_access where bid_id = (select id from bid_date_admin_bid)), 1::bigint, 'PR #44 active SELLER auto-scope remains for admin creation'); -- 17
select is((select count(*) from app_private.bid_trader_organization_access where bid_id = (select id from bid_date_operator_bid)), 1::bigint, 'PR #44 active SELLER auto-scope remains for operator creation'); -- 18
select is(
  (select after_snapshot ->> 'bid_date' from app_private.bid_audit_events where bid_id = (select id from bid_date_admin_bid) and event_type = 'created'),
  app_private.current_bid_date()::text,
  'created audit snapshot contains BID operational date'
); -- 19
select is((select bid_date from app_private.bid_result((select id from bid_date_admin_bid))), app_private.current_bid_date(), 'authoritative BID result contains operational date'); -- 20
select ok(
  (app_private.bid_snapshot((select id from bid_date_admin_bid)) ?& array['bid_date','awarded_quote_id','awarded_trader_organization_id','awarded_trader_organization_label','awarded_total_amount','awarded_at','awarded_quote']),
  'current BID snapshot includes bid_date and preserves every award field'
); -- 21
select ok(
  not coalesce((
    select proargnames @> array['p_bid_date']
    from pg_proc
    where oid = 'public.create_bid(uuid,text,text,text,timestamptz,uuid,text[],numeric[])'::regprocedure
  ), false),
  'create_bid exposes no client BID date argument'
); -- 22

set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.list_bids('53000000-0000-4000-8000-000000000001', (clock_timestamp() at time zone 'Asia/Seoul')::date, 'all', null)), 2::bigint, 'BUYER all view is scoped to selected current date'); -- 23
select is((select count(*) from public.list_bids('53000000-0000-4000-8000-000000000001', (clock_timestamp() at time zone 'Asia/Seoul')::date - 1, 'all', null)), 1::bigint, 'BUYER may query a selected historical date'); -- 24
select is((select count(*) from public.list_bids('53000000-0000-4000-8000-000000000001', (clock_timestamp() at time zone 'Asia/Seoul')::date, 'created_by_me', null)), 1::bigint, 'selected date combines with created_by_me'); -- 25
select is((select count(*) from public.list_bids('53000000-0000-4000-8000-000000000001', (clock_timestamp() at time zone 'Asia/Seoul')::date, 'responsible_buyer', '51000000-0000-4000-8000-000000000001')), 2::bigint, 'selected date combines with responsible BUYER'); -- 26
select throws_ok(
  $$select * from public.list_bids('53000000-0000-4000-8000-000000000001', null, 'all', null)$$,
  '22023', 'A BID operational date is required', 'null selected BID date fails closed'
); -- 27
select throws_ok(
  $$select * from public.list_bids('53000000-0000-4000-8000-000000000001', (clock_timestamp() at time zone 'Asia/Seoul')::date, 'invalid', null)$$,
  '22023', 'Unknown bid view', 'invalid BUYER view remains rejected'
); -- 28
reset role;

select ok(to_regprocedure('public.list_bids(uuid,text,uuid)') is null, 'obsolete unfiltered BUYER list signature is removed'); -- 29

insert into app_private.quotes (id, bid_id, trader_organization_id, created_by, barge_fee)
values ('55000000-0000-4000-8000-000000000001', '54000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000003', 5);
insert into app_private.quote_items (quote_id, fuel_grade, unit_price, display_order)
values ('55000000-0000-4000-8000-000000000001', 'vlsfo', 100, 1);
insert into app_private.quote_audit_events (
  quote_id, bid_id, trader_organization_id, event_type, actor_user_id, actor_membership_id,
  actor_organization_id, actor_role, prior_revision, resulting_revision, before_snapshot, after_snapshot
) values (
  '55000000-0000-4000-8000-000000000001', '54000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000002', 'created', '51000000-0000-4000-8000-000000000003',
  '53000000-0000-4000-8000-000000000003', '52000000-0000-4000-8000-000000000002', 'trader',
  null, 1, null, app_private.quote_snapshot('55000000-0000-4000-8000-000000000001')
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.list_trader_bids('53000000-0000-4000-8000-000000000003')), 2::bigint, 'TRADER lists only current-date scoped BIDs'); -- 30
select is((select count(*) from public.list_trader_bids('53000000-0000-4000-8000-000000000003') where id = '54000000-0000-4000-8000-000000000001'), 0::bigint, 'historical scoped BID is not returned to TRADER'); -- 31
select is((select count(*) from public.list_my_quotes('53000000-0000-4000-8000-000000000003')), 0::bigint, 'historical own quote is excluded before a current quote exists'); -- 32
select throws_ok(
  $$select * from public.create_quote('53000000-0000-4000-8000-000000000003', '54000000-0000-4000-8000-000000000001', array['vlsfo'], array[101]::numeric[], 5)$$,
  '55000', 'Quotes are editable only for today''s Seoul operational date', 'past BID create_quote is rejected despite retained scope and future deadline'
); -- 33
select throws_ok(
  $$select * from public.update_quote('53000000-0000-4000-8000-000000000003', '55000000-0000-4000-8000-000000000001', 1, array['vlsfo'], array[102]::numeric[], 6)$$,
  '55000', 'Quotes are editable only for today''s Seoul operational date', 'past BID update_quote is rejected'
); -- 34
create temporary table bid_date_current_quote on commit drop as
select result.* from public.create_quote(
  '53000000-0000-4000-8000-000000000003', (select id from bid_date_admin_bid),
  array['vlsfo'], array[100]::numeric[], 5
) as result;
select is((select revision from bid_date_current_quote), 1::bigint, 'current-date quote creation still works'); -- 35
create temporary table bid_date_updated_quote on commit drop as
select result.* from public.update_quote(
  '53000000-0000-4000-8000-000000000003', (select id from bid_date_current_quote), 1,
  array['vlsfo'], array[101]::numeric[], 6
) as result;
select is((select revision from bid_date_updated_quote), 2::bigint, 'current-date quote update still works'); -- 36
select is((select count(*) from public.list_my_quotes('53000000-0000-4000-8000-000000000003')), 1::bigint, 'TRADER own quote list returns only current BID date'); -- 37
reset role;

select is((select count(*) from app_private.bid_trader_organization_access where bid_id = '54000000-0000-4000-8000-000000000001'), 1::bigint, 'historical explicit scope remains stored'); -- 38
select is((select count(*) from app_private.quotes where id = '55000000-0000-4000-8000-000000000001'), 1::bigint, 'historical quote remains stored'); -- 39
select is((select count(*) from app_private.bid_audit_events where bid_id = '54000000-0000-4000-8000-000000000001'), 1::bigint, 'historical BID audit remains stored'); -- 40
select is((select count(*) from app_private.quote_audit_events where quote_id = '55000000-0000-4000-8000-000000000001'), 1::bigint, 'historical quote audit remains stored and unchanged'); -- 41
select is((select bid_date from app_private.bids where id = '54000000-0000-4000-8000-000000000001'), app_private.current_bid_date() - 1, 'historical BID date remains unchanged'); -- 42

select ok(not has_function_privilege('anon', 'public.list_bids(uuid,date,text,uuid)'::regprocedure, 'execute'), 'anon lacks date-scoped BUYER list EXECUTE'); -- 43
select ok(not exists (
  select 1
  from pg_proc as function
  cross join lateral aclexplode(coalesce(function.proacl, acldefault('f', function.proowner))) as privilege
  where function.oid = 'public.list_bids(uuid,date,text,uuid)'::regprocedure
    and privilege.grantee = 0
    and privilege.privilege_type = 'EXECUTE'
), 'PUBLIC lacks date-scoped BUYER list EXECUTE'); -- 44
select ok(has_function_privilege('authenticated', 'public.list_bids(uuid,date,text,uuid)'::regprocedure, 'execute'), 'authenticated has narrow date-scoped BUYER list EXECUTE'); -- 45
select ok(has_function_privilege('authenticated', 'public.list_trader_bids(uuid)'::regprocedure, 'execute'), 'authenticated retains narrow TRADER list EXECUTE'); -- 46
select ok(has_function_privilege('authenticated', 'public.list_my_quotes(uuid)'::regprocedure, 'execute'), 'authenticated retains narrow own-quote list EXECUTE'); -- 47
select ok(not has_function_privilege('anon', 'public.create_quote(uuid,uuid,text[],numeric[],numeric)'::regprocedure, 'execute'), 'anon cannot create quotes'); -- 48
select ok(has_function_privilege('authenticated', 'public.update_quote(uuid,uuid,bigint,text[],numeric[],numeric)'::regprocedure, 'execute'), 'authenticated retains narrow quote-update EXECUTE'); -- 49

select * from finish();
rollback;
