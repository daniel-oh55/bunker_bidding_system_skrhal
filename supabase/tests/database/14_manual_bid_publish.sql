begin;
select plan(42);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('61000000-0000-4000-8000-000000000001', 'publisher@manual-publish.test', '{}', '{}'),
  ('61000000-0000-4000-8000-000000000002', 'responsible@manual-publish.test', '{}', '{}'),
  ('61000000-0000-4000-8000-000000000003', 'alpha@manual-publish.test', '{}', '{}'),
  ('61000000-0000-4000-8000-000000000004', 'beta@manual-publish.test', '{}', '{}'),
  ('61000000-0000-4000-8000-000000000005', 'gamma@manual-publish.test', '{}', '{}'),
  ('61000000-0000-4000-8000-000000000006', 'suspended-account@manual-publish.test', '{}', '{}'),
  ('61000000-0000-4000-8000-000000000007', 'suspended-membership@manual-publish.test', '{}', '{}'),
  ('61000000-0000-4000-8000-000000000008', 'suspended-organization@manual-publish.test', '{}', '{}');

update app_private.user_accounts
set status = 'active'
where user_id in (
  '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000003',
  '61000000-0000-4000-8000-000000000004',
  '61000000-0000-4000-8000-000000000005',
  '61000000-0000-4000-8000-000000000007',
  '61000000-0000-4000-8000-000000000008'
);
update app_private.user_accounts
set status = 'suspended'
where user_id = '61000000-0000-4000-8000-000000000006';

insert into app_private.organizations (id, kind, name, status) values
  ('62000000-0000-4000-8000-000000000001', 'buyer', 'Manual Publish Buyer', 'active'),
  ('62000000-0000-4000-8000-000000000002', 'trader', 'Alpha SELLER', 'active'),
  ('62000000-0000-4000-8000-000000000003', 'trader', 'Beta SELLER', 'active'),
  ('62000000-0000-4000-8000-000000000004', 'trader', 'Gamma SELLER', 'active'),
  ('62000000-0000-4000-8000-000000000005', 'trader', 'Inactive SELLER', 'inactive'),
  ('62000000-0000-4000-8000-000000000006', 'buyer', 'Suspended Publish Buyer', 'suspended');

insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values
  ('63000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', 'buyer_admin', 'active'),
  ('63000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000001', 'buyer_operator', 'active'),
  ('63000000-0000-4000-8000-000000000003', '61000000-0000-4000-8000-000000000003', '62000000-0000-4000-8000-000000000002', 'trader', 'active'),
  ('63000000-0000-4000-8000-000000000004', '61000000-0000-4000-8000-000000000004', '62000000-0000-4000-8000-000000000003', 'trader', 'active'),
  ('63000000-0000-4000-8000-000000000005', '61000000-0000-4000-8000-000000000005', '62000000-0000-4000-8000-000000000004', 'trader', 'active'),
  ('63000000-0000-4000-8000-000000000006', '61000000-0000-4000-8000-000000000006', '62000000-0000-4000-8000-000000000001', 'buyer_operator', 'active'),
  ('63000000-0000-4000-8000-000000000007', '61000000-0000-4000-8000-000000000007', '62000000-0000-4000-8000-000000000001', 'buyer_operator', 'suspended'),
  ('63000000-0000-4000-8000-000000000008', '61000000-0000-4000-8000-000000000008', '62000000-0000-4000-8000-000000000006', 'buyer_operator', 'active');

select ok(to_regprocedure('public.create_bid(uuid,text,text,text,timestamptz,uuid,text[],numeric[])') is null, 'legacy eight-argument create_bid signature is absent'); -- 1
select is((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_bid'), 1::bigint, 'exactly one public create_bid overload exists'); -- 2
select ok(has_function_privilege('authenticated', 'public.create_bid(uuid,text,text,text,timestamptz,uuid,text[],numeric[],uuid[])'::regprocedure, 'execute'), 'authenticated can execute only the current Publish signature'); -- 3
select ok(not has_function_privilege('anon', 'public.create_bid(uuid,text,text,text,timestamptz,uuid,text[],numeric[],uuid[])'::regprocedure, 'execute'), 'anon cannot execute manual Publish'); -- 4
select ok(not has_function_privilege('authenticated', 'app_private.create_authoritative_bid(uuid,uuid,uuid,app_private.membership_role,text,text,text,timestamptz,uuid,text[],numeric[],uuid[])'::regprocedure, 'execute'), 'authenticated cannot execute the private creation helper'); -- 5
select ok((select prosecdef from pg_proc where oid = 'public.create_bid(uuid,text,text,text,timestamptz,uuid,text[],numeric[],uuid[])'::regprocedure), 'current manual Publish RPC is SECURITY DEFINER'); -- 6
select ok((select coalesce(array_to_string(proconfig, ','), '') like '%search_path=%' from pg_proc where oid = 'public.create_bid(uuid,text,text,text,timestamptz,uuid,text[],numeric[],uuid[])'::regprocedure), 'current manual Publish RPC pins its search path'); -- 7

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
create temporary table one_seller_bid on commit drop as
select result.* from public.create_bid(
  '63000000-0000-4000-8000-000000000001', 'One SELLER vessel', 'Busan', 'Current delivery',
  clock_timestamp() + interval '2 days', '61000000-0000-4000-8000-000000000002',
  array['vlsfo'], array[10]::numeric[], array['62000000-0000-4000-8000-000000000002']::uuid[]
) as result;
reset role;

select ok((select id is not null and raw_status = 'open' and deadline_at is not null and bid_date = app_private.current_bid_date() and created_by = '61000000-0000-4000-8000-000000000001' and responsible_buyer_user_id = '61000000-0000-4000-8000-000000000002' and awarded_quote_id is null from one_seller_bid), 'one selected SELLER publishes an unawarded current-date BID with authenticated creator and chosen responsible BUYER'); -- 8
select is((select array_agg(trader_organization_id order by trader_organization_id) from app_private.bid_trader_organization_access where bid_id = (select id from one_seller_bid)), array['62000000-0000-4000-8000-000000000002']::uuid[], 'one-SELLER Publish creates selected-only access'); -- 9
select is((select array_agg(trader_organization_id order by trader_organization_id) from app_private.bid_trader_organization_responses where bid_id = (select id from one_seller_bid) and response_status = 'awaiting'), array['62000000-0000-4000-8000-000000000002']::uuid[], 'one-SELLER Publish creates one selected awaiting response'); -- 10
select ok(not exists ((select trader_organization_id from app_private.bid_trader_organization_access where bid_id = (select id from one_seller_bid)) except (select trader_organization_id from app_private.bid_trader_organization_responses where bid_id = (select id from one_seller_bid))) and not exists ((select trader_organization_id from app_private.bid_trader_organization_responses where bid_id = (select id from one_seller_bid)) except (select trader_organization_id from app_private.bid_trader_organization_access where bid_id = (select id from one_seller_bid))), 'access and awaiting response organization sets match exactly'); -- 11
select is((select count(*) from app_private.bid_audit_events where bid_id = (select id from one_seller_bid) and event_type = 'created'), 1::bigint, 'one-SELLER Publish writes exactly one created audit'); -- 12
select ok((select actor_user_id = '61000000-0000-4000-8000-000000000001' and actor_membership_id = '63000000-0000-4000-8000-000000000001' and after_snapshot -> 'allowed_trader_organization_ids' = '["62000000-0000-4000-8000-000000000002"]'::jsonb from app_private.bid_audit_events where bid_id = (select id from one_seller_bid) and event_type = 'created'), 'created audit records the authenticated actor and exact selected scope'); -- 13

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.list_trader_bids('63000000-0000-4000-8000-000000000003') where id = (select id from one_seller_bid) and response_status = 'awaiting'), 1::bigint, 'selected TRADER can list the BID with awaiting response'); -- 14
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000004', true);
select is((select count(*) from public.list_trader_bids('63000000-0000-4000-8000-000000000004') where id = (select id from one_seller_bid)), 0::bigint, 'unselected active TRADER cannot list the BID'); -- 15
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
create temporary table two_seller_bid on commit drop as
select result.* from public.create_bid(
  '63000000-0000-4000-8000-000000000001', 'Two SELLER vessel', 'Ulsan', 'Current delivery',
  clock_timestamp() + interval '2 days', null, array['vlsfo','lsmgo'], array[20,5]::numeric[],
  array['62000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000003']::uuid[]
) as result;
reset role;
select is((select array_agg(trader_organization_id order by trader_organization_id) from app_private.bid_trader_organization_access where bid_id = (select id from two_seller_bid)), array['62000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000003']::uuid[], 'multiple selected active SELLERs receive exact access'); -- 16
select is((select count(*) from app_private.bid_trader_organization_responses where bid_id = (select id from two_seller_bid) and response_status = 'awaiting'), 2::bigint, 'multiple selected SELLERs receive matching awaiting rows'); -- 17
select is((select count(*) from app_private.bid_audit_events where bid_id = (select id from two_seller_bid) and event_type = 'created'), 1::bigint, 'multiple-SELLER Publish still writes one created audit'); -- 18
select is((select responsible_buyer_user_id from app_private.bids where id = (select id from two_seller_bid)), '61000000-0000-4000-8000-000000000001'::uuid, 'null responsible BUYER still defaults to the authenticated creator'); -- 19

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select throws_ok($$select public.create_bid('63000000-0000-4000-8000-000000000001','V','P','W',null,null,array['vlsfo'],array[1]::numeric[],array['62000000-0000-4000-8000-000000000002']::uuid[])$$, '22023', 'Publish deadline is required', 'null deadline is denied'); -- 20
select throws_ok($$select public.create_bid('63000000-0000-4000-8000-000000000001','V','P','W',clock_timestamp()-interval '1 second',null,array['vlsfo'],array[1]::numeric[],array['62000000-0000-4000-8000-000000000002']::uuid[])$$, '22023', 'Deadline must be strictly in the future', 'non-future deadline is denied'); -- 21
select throws_ok($$select public.create_bid('63000000-0000-4000-8000-000000000001','V','P','W',clock_timestamp()+interval '1 day',null,array['vlsfo'],array[1]::numeric[],null)$$, '22023', 'Selected SELLER organizations are required', 'null SELLER array is denied'); -- 22
select throws_ok($$select public.create_bid('63000000-0000-4000-8000-000000000001','V','P','W',clock_timestamp()+interval '1 day',null,array['vlsfo'],array[1]::numeric[],array[]::uuid[])$$, '22023', 'At least one selected active SELLER is required', 'zero SELLER array is denied'); -- 23
select throws_ok($$select public.create_bid('63000000-0000-4000-8000-000000000001','V','P','W',clock_timestamp()+interval '1 day',null,array['vlsfo'],array[1]::numeric[],array['62000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000002']::uuid[])$$, '22023', 'Selected SELLER organizations are duplicated', 'duplicate SELLER IDs are denied'); -- 24
select throws_ok($$select public.create_bid('63000000-0000-4000-8000-000000000001','V','P','W',clock_timestamp()+interval '1 day',null,array['vlsfo'],array[1]::numeric[],array['62000000-0000-4000-8000-000000000002'::uuid,null])$$, '22023', 'Selected SELLER organizations are invalid', 'null SELLER array member is denied'); -- 25
select throws_ok($$select public.create_bid('63000000-0000-4000-8000-000000000001','V','P','W',clock_timestamp()+interval '1 day',null,array['vlsfo'],array[1]::numeric[],array['62000000-0000-4000-8000-000000000005']::uuid[])$$, '22023', 'Selected SELLER organizations must be active', 'inactive SELLER is denied'); -- 26
select throws_ok($$select public.create_bid('63000000-0000-4000-8000-000000000001','V','P','W',clock_timestamp()+interval '1 day',null,array['vlsfo'],array[1]::numeric[],array['62000000-0000-4000-8000-000000000001']::uuid[])$$, '22023', 'Selected SELLER organizations must be active', 'non-TRADER organization is denied'); -- 27
select throws_ok($$select public.create_bid('63000000-0000-4000-8000-000000000001','V','P','W',clock_timestamp()+interval '1 day',null,array['bad'],array[1]::numeric[],array['62000000-0000-4000-8000-000000000002']::uuid[])$$, '22023', 'Unsupported fuel grade', 'invalid fuel data remains denied'); -- 28
select throws_like($$select public.create_bid('63000000-0000-4000-8000-000000000001'::uuid,'V'::text,'P'::text,'W'::text,clock_timestamp()+interval '1 day',null::uuid,array['vlsfo']::text[],array[1]::numeric[])$$, '%function public.create_bid%does not exist%', 'authenticated cannot invoke the removed legacy signature'); -- 29
select throws_like($$select app_private.create_authoritative_bid('61000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','buyer_admin','V','P','W',clock_timestamp()+interval '1 day',null,array['vlsfo'],array[1]::numeric[],array['62000000-0000-4000-8000-000000000002']::uuid[])$$, '%permission denied%', 'authenticated direct private helper execution is denied'); -- 30

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.create_bid('63000000-0000-4000-8000-000000000003','V','P','W',clock_timestamp()+interval '1 day',null,array['vlsfo'],array[1]::numeric[],array['62000000-0000-4000-8000-000000000002']::uuid[])$$, '42501', 'An active BUYER membership is required', 'TRADER cannot publish'); -- 31
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000006', true);
select throws_ok($$select public.create_bid('63000000-0000-4000-8000-000000000006','V','P','W',clock_timestamp()+interval '1 day',null,array['vlsfo'],array[1]::numeric[],array['62000000-0000-4000-8000-000000000002']::uuid[])$$, '42501', 'An active BUYER membership is required', 'suspended account cannot publish'); -- 32
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000007', true);
select throws_ok($$select public.create_bid('63000000-0000-4000-8000-000000000007','V','P','W',clock_timestamp()+interval '1 day',null,array['vlsfo'],array[1]::numeric[],array['62000000-0000-4000-8000-000000000002']::uuid[])$$, '42501', 'An active BUYER membership is required', 'suspended membership cannot publish'); -- 33
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000008', true);
select throws_ok($$select public.create_bid('63000000-0000-4000-8000-000000000008','V','P','W',clock_timestamp()+interval '1 day',null,array['vlsfo'],array[1]::numeric[],array['62000000-0000-4000-8000-000000000002']::uuid[])$$, '42501', 'An active BUYER membership is required', 'suspended BUYER organization cannot publish'); -- 34
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select throws_ok($$select public.create_bid('63000000-0000-4000-8000-000000000002','V','P','W',clock_timestamp()+interval '1 day',null,array['vlsfo'],array[1]::numeric[],array['62000000-0000-4000-8000-000000000002']::uuid[])$$, '42501', 'An active BUYER membership is required', 'cross-user membership spoof is denied'); -- 35
reset role;

select throws_ok($$select app_private.create_authoritative_bid('61000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','buyer_admin','V','P','W',clock_timestamp()+interval '1 day',null,array['vlsfo'],array[1]::numeric[],array[]::uuid[])$$, '22023', 'At least one selected active SELLER is required', 'private helper rejects an empty non-null selected SELLER array'); -- 36
select throws_ok($$select app_private.create_authoritative_bid('61000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','buyer_admin','V','P','W',clock_timestamp()+interval '1 day',null,array['vlsfo'],array[1]::numeric[],null)$$, '22023', 'Selected SELLER organizations are required', 'private helper has no remaining null-to-all compatibility path'); -- 37
select is((select count(*) from app_private.bids where id in ((select id from one_seller_bid),(select id from two_seller_bid))), 2::bigint, 'successful manual publishes retain exactly two authoritative BIDs'); -- 38
select is((select count(*) from app_private.bid_audit_events where bid_id in ((select id from one_seller_bid),(select id from two_seller_bid)) and event_type = 'created'), 2::bigint, 'failed Publish attempts append no created audits'); -- 39
select is((select count(*) from app_private.bid_trader_organization_access where bid_id = (select id from one_seller_bid) and trader_organization_id in ('62000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000004')), 0::bigint, 'unselected active SELLERs receive no explicit access rows'); -- 40
select is((select count(*) from app_private.bid_trader_organization_responses where bid_id = (select id from one_seller_bid) and trader_organization_id in ('62000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000004')), 0::bigint, 'unselected active SELLERs receive no response rows'); -- 41
select ok((select created_by = '61000000-0000-4000-8000-000000000001' and revision = 1 from app_private.bids where id = (select id from one_seller_bid)), 'manual Publish preserves immutable creator ownership and initial revision'); -- 42

select * from finish();
rollback;
