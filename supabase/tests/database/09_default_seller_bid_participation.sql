begin;
select plan(54);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('91000000-0000-4000-8000-000000000001', 'admin@default-seller.test', '{}', '{}'),
  ('91000000-0000-4000-8000-000000000002', 'operator@default-seller.test', '{}', '{}'),
  ('91000000-0000-4000-8000-000000000003', 'alpha@default-seller.test', '{}', '{}'),
  ('91000000-0000-4000-8000-000000000004', 'beta@default-seller.test', '{}', '{}');
update app_private.user_accounts set status = 'active' where user_id::text like '91000000-%';

insert into app_private.organizations (id, kind, name, status) values
  ('92000000-0000-4000-8000-000000000001', 'buyer', 'Default Scope Buyer', 'active'),
  ('92000000-0000-4000-8000-000000000002', 'trader', 'Alpha Seller', 'active'),
  ('92000000-0000-4000-8000-000000000003', 'trader', 'beta Seller', 'active'),
  ('92000000-0000-4000-8000-000000000004', 'trader', 'Inactive Seller', 'inactive'),
  ('92000000-0000-4000-8000-000000000005', 'trader', 'Suspended Seller', 'suspended');

insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values
  ('93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'buyer_admin', 'active'),
  ('93000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', 'buyer_operator', 'active'),
  ('93000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000002', 'trader', 'active'),
  ('93000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000003', 'trader', 'active');

select has_function('public', 'list_bid_seller_comparison_for_buyers', array['uuid','uuid'], 'BUYER SELLER-comparison RPC exists'); -- 1
select ok((select prosecdef from pg_proc where oid = 'public.list_bid_seller_comparison_for_buyers(uuid,uuid)'::regprocedure), 'comparison RPC is SECURITY DEFINER'); -- 2
select ok((select coalesce(array_to_string(proconfig, ','), '') like '%search_path=%' from pg_proc where oid = 'public.list_bid_seller_comparison_for_buyers(uuid,uuid)'::regprocedure), 'comparison RPC pins an empty search path'); -- 3
select ok(not has_function_privilege('anon', 'public.list_bid_seller_comparison_for_buyers(uuid,uuid)'::regprocedure, 'execute'), 'anon lacks comparison EXECUTE'); -- 4
select ok(has_function_privilege('authenticated', 'public.list_bid_seller_comparison_for_buyers(uuid,uuid)'::regprocedure, 'execute'), 'authenticated receives narrow comparison EXECUTE'); -- 5
select ok(not has_table_privilege('authenticated', 'app_private.bid_trader_organization_access', 'select'), 'authenticated cannot read private BID scope directly'); -- 6
select ok(not has_table_privilege('authenticated', 'app_private.quotes', 'select'), 'authenticated cannot read private quotes directly'); -- 7
select ok(not has_table_privilege('authenticated', 'app_private.bid_trader_organization_access', 'insert'), 'authenticated cannot insert private BID scope directly'); -- 8

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
create temporary table admin_created_bid on commit drop as
select result.* from public.create_bid(
  '93000000-0000-4000-8000-000000000001', 'Admin Default Scope', 'Busan', 'Synthetic window',
  clock_timestamp() + interval '2 days', null, array['vlsfo'], array[10]::numeric[]
) as result;
reset role;

select is((select revision from admin_created_bid), 1::bigint, 'buyer_admin creates a revision-1 BID'); -- 9
select is(
  (select array_agg(trader_organization_id order by trader_organization_id) from app_private.bid_trader_organization_access where bid_id = (select id from admin_created_bid)),
  array['92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003']::uuid[],
  'new BID scopes every currently active SELLER exactly once'
); -- 10
select is((select count(*) from app_private.bid_trader_organization_access where bid_id = (select id from admin_created_bid) and trader_organization_id = '92000000-0000-4000-8000-000000000004'), 0::bigint, 'inactive SELLER is excluded'); -- 11
select is((select count(*) from app_private.bid_trader_organization_access where bid_id = (select id from admin_created_bid) and trader_organization_id = '92000000-0000-4000-8000-000000000005'), 0::bigint, 'suspended SELLER is excluded'); -- 12
select is((select count(*) from app_private.bid_trader_organization_access where bid_id = (select id from admin_created_bid) and granted_by_user_id = '91000000-0000-4000-8000-000000000001' and granted_by_membership_id = '93000000-0000-4000-8000-000000000001'), 2::bigint, 'default grants record the verified creating BUYER actor'); -- 13
select is((select count(*) from app_private.bid_audit_events where bid_id = (select id from admin_created_bid) and event_type = 'created'), 1::bigint, 'new BID has one created audit event'); -- 14
select is(
  (select after_snapshot -> 'allowed_trader_organization_ids' from app_private.bid_audit_events where bid_id = (select id from admin_created_bid) and event_type = 'created'),
  '["92000000-0000-4000-8000-000000000002", "92000000-0000-4000-8000-000000000003"]'::jsonb,
  'created audit snapshot contains the exact default scope IDs'
); -- 15
select is((select count(*) from app_private.bid_audit_events where bid_id = (select id from admin_created_bid) and event_type = 'trader_access_granted'), 0::bigint, 'automatic initial scope creates no separate grant audit'); -- 16

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
create temporary table operator_created_bid on commit drop as
select result.* from public.create_bid(
  '93000000-0000-4000-8000-000000000002', 'Operator Default Scope', 'Incheon', 'Synthetic window',
  clock_timestamp() + interval '2 days', null, array['vlsfo'], array[20]::numeric[]
) as result;
reset role;
select is((select revision from operator_created_bid), 1::bigint, 'buyer_operator retains normal revision-1 BID creation'); -- 17
select is((select count(*) from app_private.bid_trader_organization_access where bid_id = (select id from operator_created_bid)), 2::bigint, 'buyer_operator receives the same active-SELLER snapshot behavior'); -- 18
select is((select count(*) from app_private.bid_trader_organization_access where bid_id = (select id from operator_created_bid) and granted_by_user_id = '91000000-0000-4000-8000-000000000002' and granted_by_membership_id = '93000000-0000-4000-8000-000000000002'), 2::bigint, 'operator default grants record the verified operator actor'); -- 19

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.list_trader_bids('93000000-0000-4000-8000-000000000003') where id = (select id from admin_created_bid)), 1::bigint, 'active scoped TRADER can immediately list the new BID'); -- 20
create temporary table alpha_quote on commit drop as
select result.* from public.submit_quote_response('93000000-0000-4000-8000-000000000003', (select id from admin_created_bid), 1, null, array['vlsfo'], array[100]::numeric[], 5) as result;
reset role;
select ok((select id is not null and total_amount = 1005 from alpha_quote), 'existing quote create returns its authoritative total'); -- 21

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
create temporary table admin_comparison on commit drop as
select * from public.list_bid_seller_comparison_for_buyers('93000000-0000-4000-8000-000000000001', (select id from admin_created_bid));
create temporary table admin_actual_quotes on commit drop as
select * from public.list_quotes_for_buyers('93000000-0000-4000-8000-000000000001', (select id from admin_created_bid));
reset role;
select is((select count(*) from admin_comparison), 2::bigint, 'buyer_admin comparison returns access union retained responses and quotes'); -- 22
select ok((select quote is null and access_active and organization_active from admin_comparison where trader_organization_id = '92000000-0000-4000-8000-000000000003'), 'scoped SELLER without quote returns quote=null and active metadata'); -- 23
select ok((select quote = to_jsonb(app_private.quote_result((select id from alpha_quote))) from admin_comparison where trader_organization_id = '92000000-0000-4000-8000-000000000002'), 'quoted SELLER embeds the authoritative quote_result payload'); -- 24
select is((select array_agg(key order by key) from (select distinct jsonb_object_keys(to_jsonb(result)) as key from admin_comparison as result) keys), array['access_active','bid_id','organization_active','quote','response_status','trader_organization_id','trader_organization_label']::text[], 'comparison exposes only seven narrow outer fields'); -- 25
select is((select array_agg(trader_organization_label) from admin_comparison), array['Alpha Seller','beta Seller']::text[], 'comparison order is deterministic by normalized label then ID'); -- 26
select is((select count(*) from admin_actual_quotes), 1::bigint, 'existing BUYER quote list remains actual-quote-only'); -- 27
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.list_bid_seller_comparison_for_buyers('93000000-0000-4000-8000-000000000002', (select id from admin_created_bid))), 2::bigint, 'buyer_operator may use the BUYER comparison RPC'); -- 28
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
select throws_ok($$select * from public.list_bid_seller_comparison_for_buyers('93000000-0000-4000-8000-000000000003', (select id from admin_created_bid))$$, '42501', 'An active BUYER membership is required', 'TRADER cannot request competitor comparison data'); -- 29
reset role;
set local role anon;
select throws_like($$select * from public.list_bid_seller_comparison_for_buyers('93000000-0000-4000-8000-000000000001', (select id from admin_created_bid))$$, '%permission denied%', 'anon cannot execute comparison RPC'); -- 30
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select is((select (public.revoke_bid_trader_access('93000000-0000-4000-8000-000000000001', (select id from admin_created_bid), 1, '92000000-0000-4000-8000-000000000002')).revision), 2::bigint, 'manual scope revoke remains unchanged'); -- 31
select ok((select quote is not null and not access_active and organization_active from public.list_bid_seller_comparison_for_buyers('93000000-0000-4000-8000-000000000001', (select id from admin_created_bid)) where trader_organization_id = '92000000-0000-4000-8000-000000000002'), 'retained quote remains visible after revoke with access inactive'); -- 32
reset role;
select is((select count(*) from app_private.bid_trader_organization_access where bid_id = (select id from admin_created_bid) and trader_organization_id = '92000000-0000-4000-8000-000000000002'), 0::bigint, 'revoke removes current explicit scope without deleting quote'); -- 33

update app_private.organizations set status = 'inactive' where id = '92000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
select throws_ok($$select * from public.list_trader_bids('93000000-0000-4000-8000-000000000003')$$, '42501', 'An active TRADER membership is required', 'inactive organization immediately loses TRADER authority despite historical participation'); -- 34
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select ok((select not organization_active and not access_active from public.list_bid_seller_comparison_for_buyers('93000000-0000-4000-8000-000000000001', (select id from admin_created_bid)) where trader_organization_id = '92000000-0000-4000-8000-000000000002'), 'retained revoked row reports organization inactive'); -- 35
select ok((select (quote ->> 'organization_active')::boolean = false and (quote ->> 'access_active')::boolean = false from public.list_bid_seller_comparison_for_buyers('93000000-0000-4000-8000-000000000001', (select id from admin_created_bid)) where trader_organization_id = '92000000-0000-4000-8000-000000000002'), 'nested authoritative quote metadata matches inactive revoked outer row'); -- 36

create temporary table late_seller on commit drop as
select * from public.create_trader_organization('93000000-0000-4000-8000-000000000001', 'Later Seller');
reset role;
select is((select count(*) from app_private.bid_trader_organization_access where bid_id = (select id from admin_created_bid) and trader_organization_id = (select organization_id from late_seller)), 0::bigint, 'SELLER created later is not silently added to an older BID'); -- 37
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.list_bid_seller_comparison_for_buyers('93000000-0000-4000-8000-000000000001', (select id from admin_created_bid)) where trader_organization_id = (select organization_id from late_seller)), 0::bigint, 'later SELLER with neither access nor quote is absent from comparison'); -- 38
select is((select (public.grant_bid_trader_access('93000000-0000-4000-8000-000000000001', (select id from admin_created_bid), 2, (select organization_id from late_seller))).revision), 3::bigint, 'manual later Grant scope remains available'); -- 39
select ok((select quote is null and access_active from public.list_bid_seller_comparison_for_buyers('93000000-0000-4000-8000-000000000001', (select id from admin_created_bid)) where trader_organization_id = (select organization_id from late_seller)), 'manually scoped unquoted later SELLER appears as an active participant'); -- 40
select is((select (public.revoke_bid_trader_access('93000000-0000-4000-8000-000000000001', (select id from admin_created_bid), 3, (select organization_id from late_seller))).revision), 4::bigint, 'manual later Revoke scope remains available'); -- 41
select ok((select not access_active and response_status = 'awaiting' and quote is null from public.list_bid_seller_comparison_for_buyers('93000000-0000-4000-8000-000000000001', (select id from admin_created_bid)) where trader_organization_id = (select organization_id from late_seller)), 'revoked unquoted SELLER retains awaiting response history without current scope'); -- 42
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000004', true);
create temporary table beta_quote on commit drop as
select result.* from public.submit_quote_response('93000000-0000-4000-8000-000000000004', (select id from operator_created_bid), 1, null, array['vlsfo'], array[90]::numeric[], 2) as result;
select ok((select total_amount = 1802 from beta_quote), 'existing second-SELLER quote behavior remains unchanged'); -- 43
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select is((select (public.close_bid('93000000-0000-4000-8000-000000000002', (select id from operator_created_bid), 1)).raw_status), 'closed', 'existing BID close behavior remains unchanged'); -- 44
select is((select (public.award_bid('93000000-0000-4000-8000-000000000002', (select id from operator_created_bid), 2, (select id from beta_quote), 1)).raw_status), 'awarded', 'existing authoritative award behavior remains unchanged'); -- 45
select ok((select (quote ->> 'is_awarded')::boolean from public.list_bid_seller_comparison_for_buyers('93000000-0000-4000-8000-000000000002', (select id from operator_created_bid)) where trader_organization_id = '92000000-0000-4000-8000-000000000003'), 'comparison returns the authoritative awarded quote result'); -- 46
reset role;

update app_private.organizations set status = 'inactive'
where id in ('92000000-0000-4000-8000-000000000003', (select organization_id from late_seller));
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
create temporary table zero_seller_bid on commit drop as
select result.* from public.create_bid(
  '93000000-0000-4000-8000-000000000002', 'Zero Active Seller', 'Ulsan', 'Synthetic window',
  clock_timestamp() + interval '2 days', null, array['vlsfo'], array[1]::numeric[]
) as result;
reset role;
select ok((select id is not null from zero_seller_bid), 'zero-active-SELLER case still creates a BID'); -- 47
select is((select count(*) from app_private.bid_trader_organization_access where bid_id = (select id from zero_seller_bid)), 0::bigint, 'zero-active-SELLER BID creates zero access rows'); -- 48
select is((select revision from zero_seller_bid), 1::bigint, 'zero-active-SELLER BID remains revision 1'); -- 49
select is((select after_snapshot -> 'allowed_trader_organization_ids' from app_private.bid_audit_events where bid_id = (select id from zero_seller_bid) and event_type = 'created'), '[]'::jsonb, 'zero-active-SELLER created audit records an empty explicit scope snapshot'); -- 50

insert into app_private.bids (id, vessel_voyage, port_name, delivery_window, deadline_at, status, created_by, responsible_buyer_user_id)
values ('94000000-0000-4000-8000-000000000001', 'Historical Direct Fixture', 'Busan', 'Before automatic scope semantics', clock_timestamp() + interval '1 day', 'open', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001');
insert into app_private.bid_items (bid_id, fuel_grade, quantity_mt, display_order) values ('94000000-0000-4000-8000-000000000001', 'vlsfo', 1, 1);
select is((select count(*) from app_private.bid_trader_organization_access where bid_id = '94000000-0000-4000-8000-000000000001'), 0::bigint, 'non-create_bid historical fixture receives no implicit or trigger-based backfill'); -- 51
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.list_bid_seller_comparison_for_buyers('93000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001')), 0::bigint, 'old BID without explicit scope or quote remains empty in presentation'); -- 52
select ok((select not organization_active and access_active and quote is null from public.list_bid_seller_comparison_for_buyers('93000000-0000-4000-8000-000000000001', (select id from admin_created_bid)) where trader_organization_id = '92000000-0000-4000-8000-000000000003'), 'inactive unquoted organization remains BUYER-visible while retained scope exists'); -- 53
reset role;
select ok(not exists (select 1 from pg_trigger where tgrelid = 'app_private.bids'::regclass and not tgisinternal and pg_get_triggerdef(oid) ilike '%bid_trader_organization_access%'), 'automatic participation is confined to create_bid, not a global BID trigger'); -- 54

select * from finish();
rollback;
