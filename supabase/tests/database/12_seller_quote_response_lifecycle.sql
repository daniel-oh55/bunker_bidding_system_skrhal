begin;
select plan(49);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('71000000-0000-4000-8000-000000000001', 'response-buyer@lifecycle.test', '{}', '{}'),
  ('71000000-0000-4000-8000-000000000002', 'response-trader@lifecycle.test', '{}', '{}');
update app_private.user_accounts set status = 'active' where user_id::text like '71000000-%';

insert into app_private.organizations (id, kind, name, status) values
  ('72000000-0000-4000-8000-000000000001', 'buyer', 'Response Lifecycle Buyer', 'active'),
  ('72000000-0000-4000-8000-000000000002', 'trader', 'Response Lifecycle Trader', 'active');

insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values
  ('73000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'buyer_admin', 'active'),
  ('73000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002', 'trader', 'active');

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
create temporary table lifecycle_bid on commit drop as
select result.* from public.create_bid(
  '73000000-0000-4000-8000-000000000001', 'Response lifecycle vessel', 'Busan', 'Current delivery',
  clock_timestamp() + interval '2 days', null, array['vlsfo'], array[10]::numeric[]
) as result;
create temporary table submitted_audit_bid on commit drop as
select result.* from public.create_bid(
  '73000000-0000-4000-8000-000000000001', 'Submitted audit vessel', 'Busan', 'Current delivery',
  clock_timestamp() + interval '2 days', null, array['vlsfo'], array[1]::numeric[]
) as result;

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
select public.submit_quote_response(
  '73000000-0000-4000-8000-000000000002', (select id from submitted_audit_bid), 1, null,
  array['vlsfo'], array[99]::numeric[], 1
);
reset role;

select ok((select response_status = 'awaiting' and revision = 1 from app_private.bid_trader_organization_responses where bid_id = (select id from lifecycle_bid) and trader_organization_id = '72000000-0000-4000-8000-000000000002'), 'current scoped response starts awaiting at revision one'); -- 1
select is(
  (select count(*) from app_private.bid_trader_organization_response_audit_events where bid_id = (select id from lifecycle_bid)),
  0::bigint, 'awaiting response starts with no response audit'
); -- 2

create temporary table gave_up_awaiting on commit drop as
select result.* from public.give_up_quote_response(
  '73000000-0000-4000-8000-000000000002', (select id from lifecycle_bid), 1
) as result;
select ok((select response_status = 'gave_up' and revision = 2 and quote_id is null from gave_up_awaiting), 'awaiting response gives up at revision two without a quote'); -- 3
select is((select response_status from app_private.bid_trader_organization_responses where bid_id = (select id from lifecycle_bid)), 'gave_up', 'awaiting response is stored as gave_up'); -- 4
select is((select count(*) from app_private.quotes where bid_id = (select id from lifecycle_bid)), 0::bigint, 'awaiting give-up creates no quote'); -- 5
select is((select count(*) from app_private.bid_trader_organization_response_audit_events where bid_id = (select id from lifecycle_bid)), 1::bigint, 'awaiting give-up adds exactly one response audit'); -- 6
select ok((select event_type = 'gave_up' and prior_status = 'awaiting' and resulting_status = 'gave_up' and prior_revision = 1 and resulting_revision = 2 from app_private.bid_trader_organization_response_audit_events where bid_id = (select id from lifecycle_bid)), 'awaiting give-up audit records the exact transition'); -- 7
select ok((select actor_user_id = '71000000-0000-4000-8000-000000000002'::uuid and actor_membership_id = '73000000-0000-4000-8000-000000000002'::uuid and actor_organization_id = '72000000-0000-4000-8000-000000000002'::uuid and actor_role = 'trader'::app_private.membership_role from app_private.bid_trader_organization_response_audit_events where bid_id = (select id from lifecycle_bid)), 'awaiting give-up audit records the server-verified TRADER actor'); -- 8
select ok((select before_snapshot is not null and after_snapshot is not null and before_snapshot ->> 'response_status' = 'awaiting' and after_snapshot ->> 'response_status' = 'gave_up' from app_private.bid_trader_organization_response_audit_events where bid_id = (select id from lifecycle_bid)), 'awaiting give-up audit has before and after snapshots'); -- 9

select throws_ok(
  $$select public.give_up_quote_response('73000000-0000-4000-8000-000000000002', (select id from lifecycle_bid), 2)$$,
  '22023', 'Quote response already gave up', 'repeated give-up is rejected by the lifecycle contract'
); -- 10
select is((select revision from app_private.bid_trader_organization_responses where bid_id = (select id from lifecycle_bid)), 2::bigint, 'rejected repeated give-up preserves response revision'); -- 11
select is((select count(*) from app_private.bid_trader_organization_response_audit_events where bid_id = (select id from lifecycle_bid)), 1::bigint, 'rejected repeated give-up creates no response audit'); -- 12
select is((select count(*) from app_private.quotes where bid_id = (select id from lifecycle_bid)), 0::bigint, 'rejected repeated give-up creates no quote'); -- 13

create temporary table resumed_without_quote on commit drop as
select result.* from public.submit_quote_response(
  '73000000-0000-4000-8000-000000000002', (select id from lifecycle_bid), 2, null,
  array['vlsfo'], array[100]::numeric[], 5
) as result;
select ok((select response_status = 'quoted' and revision = 3 from app_private.bid_trader_organization_responses where bid_id = (select id from lifecycle_bid)), 'gave-up response resumes to quoted exactly once with no retained quote'); -- 14
select is((select revision from resumed_without_quote), 1::bigint, 'no-quote resume creates quote revision one'); -- 15
select is((select count(*) from app_private.bid_trader_organization_response_audit_events where bid_id = (select id from lifecycle_bid) and event_type = 'resumed' and resulting_revision = 3), 1::bigint, 'no-quote resume adds one resumed response audit'); -- 16
select ok((select event.actor_user_id = '71000000-0000-4000-8000-000000000002'::uuid and event.actor_membership_id = '73000000-0000-4000-8000-000000000002'::uuid and event.actor_organization_id = '72000000-0000-4000-8000-000000000002'::uuid and event.actor_role = 'trader'::app_private.membership_role and event.quote_id = (select id from resumed_without_quote) and event.quote_revision = 1 from app_private.bid_trader_organization_response_audit_events event where event.bid_id = (select id from lifecycle_bid) and event.resulting_revision = 3), 'no-quote resume audit records the actual actor and created quote'); -- 17
select is((select count(*) from app_private.quote_audit_events where quote_id = (select id from resumed_without_quote) and event_type = 'created'), 1::bigint, 'no-quote resume creates one quote audit'); -- 18

create temporary table gave_up_quoted on commit drop as
select result.* from public.give_up_quote_response(
  '73000000-0000-4000-8000-000000000002', (select id from lifecycle_bid), 3
) as result;
create temporary table retained_quote_before_resume on commit drop as
select quote.id, quote.revision, quote.barge_fee,
  (select jsonb_agg(jsonb_build_object('fuel_grade', item.fuel_grade, 'unit_price', item.unit_price, 'display_order', item.display_order) order by item.display_order) from app_private.quote_items item where item.quote_id = quote.id) as items
from app_private.quotes quote where quote.bid_id = (select id from lifecycle_bid);
select ok((select response_status = 'gave_up' and revision = 4 and quote_id = (select id from retained_quote_before_resume) and quote_revision = 1 from gave_up_quoted), 'quoted response gives up while retaining quote revision one'); -- 19
select ok((select quote.id = retained.id and quote.revision = retained.revision and quote.barge_fee = retained.barge_fee from app_private.quotes quote cross join retained_quote_before_resume retained where quote.id = retained.id), 'quoted give-up leaves retained quote commercial row unchanged'); -- 20
select is((select jsonb_agg(jsonb_build_object('fuel_grade', item.fuel_grade, 'unit_price', item.unit_price, 'display_order', item.display_order) order by item.display_order) from app_private.quote_items item where item.quote_id = (select id from retained_quote_before_resume)), (select items from retained_quote_before_resume), 'quoted give-up retains all quote items unchanged'); -- 21
select is((select count(*) from app_private.bid_trader_organization_response_audit_events where bid_id = (select id from lifecycle_bid) and event_type = 'gave_up' and resulting_revision = 4), 1::bigint, 'quoted give-up adds one retained-quote response audit'); -- 22

create temporary table resumed_identically on commit drop as
select result.* from public.submit_quote_response(
  '73000000-0000-4000-8000-000000000002', (select id from lifecycle_bid), 4, 1,
  array['vlsfo'], array[100]::numeric[], 5
) as result;
select ok((select response_status = 'quoted' and revision = 5 from app_private.bid_trader_organization_responses where bid_id = (select id from lifecycle_bid)), 'identical retained values resume the response once'); -- 23
select is((select revision from resumed_identically), 1::bigint, 'identical retained values do not increment quote revision'); -- 24
select ok((select quote.barge_fee = retained.barge_fee and (select jsonb_agg(jsonb_build_object('fuel_grade', item.fuel_grade, 'unit_price', item.unit_price, 'display_order', item.display_order) order by item.display_order) from app_private.quote_items item where item.quote_id = quote.id) = retained.items from app_private.quotes quote cross join retained_quote_before_resume retained where quote.id = retained.id), 'identical retained values leave commercial values unchanged'); -- 25
select is((select count(*) from app_private.quote_audit_events where quote_id = (select id from retained_quote_before_resume) and event_type = 'updated'), 0::bigint, 'identical retained-value resume synthesizes no quote update audit'); -- 26
select is((select count(*) from app_private.bid_trader_organization_response_audit_events where bid_id = (select id from lifecycle_bid) and event_type = 'resumed' and resulting_revision = 5), 1::bigint, 'identical retained-value resume adds one response audit'); -- 27

create temporary table price_updated on commit drop as
select result.* from public.submit_quote_response(
  '73000000-0000-4000-8000-000000000002', (select id from lifecycle_bid), 5, 1,
  array['vlsfo'], array[110]::numeric[], 6
) as result;
select ok((select revision = 6 and response_status = 'quoted' from app_private.bid_trader_organization_responses where bid_id = (select id from lifecycle_bid)), 'quoted price update increments response once'); -- 28
select is((select revision from price_updated), 2::bigint, 'quoted price update increments quote once'); -- 29
select is((select count(*) from app_private.bid_trader_organization_response_audit_events where bid_id = (select id from lifecycle_bid) and event_type = 'price_updated' and prior_revision = 5 and resulting_revision = 6), 1::bigint, 'quoted price update has one response audit'); -- 30
select is((select count(*) from app_private.quote_audit_events where quote_id = (select id from retained_quote_before_resume) and event_type = 'updated' and resulting_revision = 2), 1::bigint, 'quoted price update has one quote update audit'); -- 31

select public.give_up_quote_response('73000000-0000-4000-8000-000000000002', (select id from lifecycle_bid), 6);
select ok((select response_status = 'gave_up' and revision = 7 from app_private.bid_trader_organization_responses where bid_id = (select id from lifecycle_bid)), 'quoted response can give up again with quote retained'); -- 32
select is((select revision from app_private.quotes where id = (select id from retained_quote_before_resume)), 2::bigint, 'second give-up leaves retained quote revision unchanged'); -- 33

create temporary table resumed_changed on commit drop as
select result.* from public.submit_quote_response(
  '73000000-0000-4000-8000-000000000002', (select id from lifecycle_bid), 7, 2,
  array['vlsfo'], array[125]::numeric[], 7
) as result;
select ok((select response_status = 'quoted' and revision = 8 from app_private.bid_trader_organization_responses where bid_id = (select id from lifecycle_bid)), 'changed retained values resume the response once'); -- 34
select is((select revision from resumed_changed), 3::bigint, 'changed retained values increment quote once'); -- 35
select is((select total_amount from resumed_changed), 1257::numeric, 'changed resume returns the authoritative server-calculated total'); -- 36
select is((select count(*) from app_private.bid_trader_organization_response_audit_events where bid_id = (select id from lifecycle_bid) and event_type = 'resumed' and prior_revision = 7 and resulting_revision = 8), 1::bigint, 'changed retained-value resume adds one response audit'); -- 37
select is((select count(*) from app_private.quote_audit_events where quote_id = (select id from retained_quote_before_resume) and event_type = 'updated' and resulting_revision = 3), 1::bigint, 'changed retained-value resume adds exactly one quote update audit'); -- 38

select public.give_up_quote_response('73000000-0000-4000-8000-000000000002', (select id from lifecycle_bid), 8);
select ok((select response_status = 'gave_up' and revision = 9 from app_private.bid_trader_organization_responses where bid_id = (select id from lifecycle_bid)), 'active quote can be put into final gave_up state'); -- 39

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select public.close_bid('73000000-0000-4000-8000-000000000001', (select id from lifecycle_bid), 1);
select is((select response_status from public.list_quotes_for_buyers('73000000-0000-4000-8000-000000000001', (select id from lifecycle_bid)) where id = (select id from retained_quote_before_resume)), 'gave_up', 'BUYER result exposes the retained response as gave_up'); -- 40
select ok(not (select eligible_for_award from public.list_quotes_for_buyers('73000000-0000-4000-8000-000000000001', (select id from lifecycle_bid)) where id = (select id from retained_quote_before_resume)), 'gave-up retained quote is excluded from award eligibility'); -- 41
select throws_ok(
  $$select public.award_bid('73000000-0000-4000-8000-000000000001', (select id from lifecycle_bid), 2, (select id from retained_quote_before_resume), 3)$$,
  '55000', 'Quote response is not active', 'BUYER cannot award a retained gave-up quote'
); -- 42
select ok((select status = 'closed' and awarded_quote_id is null from app_private.bids where id = (select id from lifecycle_bid)), 'rejected gave-up award leaves BID closed and unawarded'); -- 43
select is((select count(*) from app_private.bid_audit_events where bid_id = (select id from lifecycle_bid) and event_type = 'awarded'), 0::bigint, 'rejected gave-up award creates no awarded BID audit'); -- 44

select is((select event_type from app_private.bid_trader_organization_response_audit_events where bid_id = (select id from submitted_audit_bid)), 'submitted', 'initial quote submission is recorded as submitted'); -- 45
select ok((select actor_user_id = '71000000-0000-4000-8000-000000000002'::uuid and actor_membership_id = '73000000-0000-4000-8000-000000000002'::uuid and actor_organization_id = '72000000-0000-4000-8000-000000000002'::uuid and actor_role = 'trader'::app_private.membership_role and prior_revision = 1 and resulting_revision = 2 and prior_status = 'awaiting' and resulting_status = 'quoted' and quote_id is not null and quote_revision = 1 and before_snapshot is not null and after_snapshot is not null from app_private.bid_trader_organization_response_audit_events where bid_id = (select id from submitted_audit_bid)), 'submitted audit carries actor, revision, status, quote, and snapshots'); -- 46
select is((select array_agg(event_type order by resulting_revision) from app_private.bid_trader_organization_response_audit_events where bid_id = (select id from lifecycle_bid)), array['gave_up','resumed','gave_up','resumed','price_updated','gave_up','resumed','gave_up']::text[], 'lifecycle response audits cover gave_up, resumed, and price_updated in order'); -- 47
select is((select count(*) from app_private.bid_trader_organization_response_audit_events where bid_id = (select id from lifecycle_bid) and (before_snapshot is null or after_snapshot is null)), 0::bigint, 'every lifecycle response audit keeps before and after snapshots'); -- 48
select is((select count(*) from app_private.bid_trader_organization_response_audit_events where bid_id = (select id from lifecycle_bid) and resulting_revision >= 3 and (quote_id is null or quote_revision is null)), 0::bigint, 'every lifecycle audit with a retained quote records quote identity and revision'); -- 49

reset role;
select * from finish();
rollback;
