begin;
select plan(16);

create temporary table response_upgrade_fixture_present on commit drop as
select exists (
  select 1 from app_private.bids where id = '64000000-0000-4000-8000-000000000001'
) as present;

create function pg_temp.response_upgrade_assert(p_actual anyelement, p_expected anyelement, p_description text)
returns text language plpgsql as $$
begin
  if not (select present from response_upgrade_fixture_present) then
    return pass(p_description || ' (fixture not loaded in clean replay)');
  end if;
  return is(p_actual, p_expected, p_description);
end;
$$;

select pg_temp.response_upgrade_assert((select count(*) from app_private.bid_trader_organization_responses), 3::bigint, 'backfill creates exactly three retained response rows'); -- 1
select pg_temp.response_upgrade_assert((select count(*) from app_private.bid_trader_organization_responses where bid_id = '64000000-0000-4000-8000-000000000001' and trader_organization_id = '62000000-0000-4000-8000-000000000002'), 1::bigint, 'overlapping access and quote pair has one response'); -- 2
select pg_temp.response_upgrade_assert((select response_status from app_private.bid_trader_organization_responses where bid_id = '64000000-0000-4000-8000-000000000001' and trader_organization_id = '62000000-0000-4000-8000-000000000002'), 'quoted', 'overlapping access and quote pair is quoted'); -- 3
select pg_temp.response_upgrade_assert((select revision from app_private.bid_trader_organization_responses where bid_id = '64000000-0000-4000-8000-000000000001' and trader_organization_id = '62000000-0000-4000-8000-000000000002'), 1::bigint, 'overlapping access and quote pair starts at response revision one'); -- 4
select pg_temp.response_upgrade_assert((select count(*) from app_private.bid_trader_organization_responses where bid_id = '64000000-0000-4000-8000-000000000002' and trader_organization_id = '62000000-0000-4000-8000-000000000002'), 1::bigint, 'access-only pair has one response'); -- 5
select pg_temp.response_upgrade_assert((select response_status from app_private.bid_trader_organization_responses where bid_id = '64000000-0000-4000-8000-000000000002' and trader_organization_id = '62000000-0000-4000-8000-000000000002'), 'awaiting', 'access-only pair is awaiting'); -- 6
select pg_temp.response_upgrade_assert((select count(*) from app_private.bid_trader_organization_responses where bid_id = '64000000-0000-4000-8000-000000000003' and trader_organization_id = '62000000-0000-4000-8000-000000000002'), 1::bigint, 'quote-only pair has one response'); -- 7
select pg_temp.response_upgrade_assert((select response_status from app_private.bid_trader_organization_responses where bid_id = '64000000-0000-4000-8000-000000000003' and trader_organization_id = '62000000-0000-4000-8000-000000000002'), 'quoted', 'quote-only pair is quoted'); -- 8
select pg_temp.response_upgrade_assert((select count(*) from app_private.bid_trader_organization_responses where revision <> 1), 0::bigint, 'every backfilled response starts at revision one'); -- 9

select pg_temp.response_upgrade_assert((select count(*) from (values
  ('64000000-0000-4000-8000-000000000001'::uuid, 4::bigint, '2026-08-30 01:02:03+00'::timestamptz, '2026-08-30 04:05:06+00'::timestamptz, '2026-08-30'::date),
  ('64000000-0000-4000-8000-000000000002'::uuid, 2::bigint, '2026-08-30 02:03:04+00'::timestamptz, '2026-08-30 05:06:07+00'::timestamptz, '2026-08-30'::date),
  ('64000000-0000-4000-8000-000000000003'::uuid, 3::bigint, '2026-08-30 03:04:05+00'::timestamptz, '2026-08-30 06:07:08+00'::timestamptz, '2026-08-30'::date)
) as expected(id, revision, created_at, updated_at, bid_date) join app_private.bids as bid using (id) where (bid.revision, bid.created_at, bid.updated_at, bid.bid_date) is distinct from (expected.revision, expected.created_at, expected.updated_at, expected.bid_date)), 0::bigint, 'existing BID revisions and timestamps remain unchanged'); -- 10
select pg_temp.response_upgrade_assert((select count(*) from (values
  ('64000000-0000-4000-8000-000000000001'::uuid, '62000000-0000-4000-8000-000000000002'::uuid, '2026-08-30 07:00:00+00'::timestamptz),
  ('64000000-0000-4000-8000-000000000002'::uuid, '62000000-0000-4000-8000-000000000002'::uuid, '2026-08-30 08:00:00+00'::timestamptz)
) as expected(bid_id, trader_organization_id, granted_at) join app_private.bid_trader_organization_access as access using (bid_id, trader_organization_id) where access.granted_at is distinct from expected.granted_at), 0::bigint, 'existing access rows remain unchanged'); -- 11
select pg_temp.response_upgrade_assert((select count(*) from (values
  ('65000000-0000-4000-8000-000000000001'::uuid, 7::bigint, '2026-08-30 09:00:00+00'::timestamptz, '2026-08-30 10:00:00+00'::timestamptz, 11::numeric),
  ('65000000-0000-4000-8000-000000000002'::uuid, 3::bigint, '2026-08-30 11:00:00+00'::timestamptz, '2026-08-30 12:00:00+00'::timestamptz, 22::numeric)
) as expected(id, revision, created_at, updated_at, barge_fee) join app_private.quotes as quote using (id) where (quote.revision, quote.created_at, quote.updated_at, quote.barge_fee) is distinct from (expected.revision, expected.created_at, expected.updated_at, expected.barge_fee)), 0::bigint, 'existing quote business rows remain unchanged'); -- 12
select pg_temp.response_upgrade_assert((select count(*) from app_private.quote_items where (quote_id = '65000000-0000-4000-8000-000000000001' and unit_price = 101 and display_order = 1) or (quote_id = '65000000-0000-4000-8000-000000000002' and unit_price = 202 and display_order = 1)), 2::bigint, 'existing quote items remain unchanged'); -- 13
select pg_temp.response_upgrade_assert((select count(*) from app_private.bid_audit_events where bid_id::text like '64000000-%' and event_type = 'created' and resulting_revision = 1), 3::bigint, 'existing BID audits remain unchanged'); -- 14
select pg_temp.response_upgrade_assert((select count(*) from app_private.quote_audit_events where quote_id::text like '65000000-%' and event_type = 'created' and resulting_revision = 1), 2::bigint, 'existing quote audits remain unchanged'); -- 15
select pg_temp.response_upgrade_assert((select count(*) from app_private.bid_trader_organization_response_audit_events), 0::bigint, 'backfill does not synthesize response audits'); -- 16

select * from finish();
rollback;
