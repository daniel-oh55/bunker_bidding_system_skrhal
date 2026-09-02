begin;
select plan(37);

select ok(not (select attnotnull from pg_attribute where attrelid = 'app_private.mail_intake_items'::regclass and attname = 'converted_bid_id' and attnum > 0), 'mail intake conversion link is nullable before publish'); -- 1
select ok(exists(select 1 from pg_constraint where conrelid = 'app_private.mail_intake_items'::regclass and conname = 'mail_intake_items_converted_bid_id_key'), 'one intake item can link to only one BID'); -- 2
select ok((select prosecdef from pg_proc where oid = 'public.publish_mail_intake_bid(uuid,uuid,bigint,text,text,text,timestamptz,uuid,text[],numeric[],uuid[])'::regprocedure), 'publish RPC is SECURITY DEFINER'); -- 3
select is((select proconfig from pg_proc where oid = 'public.publish_mail_intake_bid(uuid,uuid,bigint,text,text,text,timestamptz,uuid,text[],numeric[],uuid[])'::regprocedure), array['search_path=""']::text[], 'publish RPC fixes an empty search path'); -- 4
select ok(has_function_privilege('authenticated', 'public.publish_mail_intake_bid(uuid,uuid,bigint,text,text,text,timestamptz,uuid,text[],numeric[],uuid[])', 'execute'), 'authenticated can invoke the reviewed publish boundary'); -- 5
select ok(not has_function_privilege('anon', 'public.publish_mail_intake_bid(uuid,uuid,bigint,text,text,text,timestamptz,uuid,text[],numeric[],uuid[])', 'execute'), 'anon cannot invoke publish'); -- 6
select ok(not has_function_privilege('authenticated', 'app_private.create_authoritative_bid(uuid,uuid,uuid,app_private.membership_role,text,text,text,timestamptz,uuid,text[],numeric[],uuid[])', 'execute'), 'authenticated cannot invoke the private creation helper'); -- 7

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('51000000-0000-4000-8000-000000000001', 'prepared-buyer@test.local', '{}', '{}'),
  ('51000000-0000-4000-8000-000000000002', 'prepared-trader@test.local', '{}', '{}'),
  ('51000000-0000-4000-8000-000000000003', 'inactive-publisher@test.local', '{}', '{}');
update app_private.user_accounts set status = 'active' where user_id in ('51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002');

insert into app_private.organizations (id, kind, name, status) values
  ('52000000-0000-4000-8000-000000000001', 'buyer', 'Prepared BID Buyer', 'active'),
  ('52000000-0000-4000-8000-000000000002', 'trader', 'Prepared BID Trader Actor', 'active'),
  ('52000000-0000-4000-8000-000000000003', 'buyer', 'Inactive Prepared BID Buyer', 'active'),
  ('52000000-0000-4000-8000-000000000004', 'trader', 'Selected SELLER', 'active'),
  ('52000000-0000-4000-8000-000000000005', 'trader', 'Unselected SELLER', 'active'),
  ('52000000-0000-4000-8000-000000000006', 'trader', 'Inactive SELLER', 'inactive');

insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values
  ('53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', 'buyer_operator', 'active'),
  ('53000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000002', 'trader', 'active'),
  ('53000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000003', '52000000-0000-4000-8000-000000000003', 'buyer_admin', 'active');

set local role service_role;
select set_config('prepared_mail.item_id', public.ingest_mail_intake_item(
  'test', 'prepared-mailbox', 'prepared-1', clock_timestamp(), 'Prepared source subject',
  'Parsed vessel', 'Parsed port', 'Parsed delivery',
  '[{"grade":"vlsfo","quantity":100},{"grade":"lsmgo","quantity":10}]'::jsonb,
  '["Verify delivery window"]'::jsonb
)::text, true);
select set_config('prepared_mail.dismissed_id', public.ingest_mail_intake_item('test', 'prepared-mailbox', 'dismissed-1', clock_timestamp(), 'Dismissed source')::text, true);
select set_config('prepared_mail.nonbuyer_id', public.ingest_mail_intake_item('test', 'prepared-mailbox', 'nonbuyer-1', clock_timestamp(), 'Nonbuyer source')::text, true);
select set_config('prepared_mail.inactive_id', public.ingest_mail_intake_item('test', 'prepared-mailbox', 'inactive-1', clock_timestamp(), 'Inactive source')::text, true);
select set_config('prepared_mail.missing_deadline_id', public.ingest_mail_intake_item('test', 'prepared-mailbox', 'missing-deadline-1', clock_timestamp(), 'Missing deadline source')::text, true);
select set_config('prepared_mail.invalid_fuel_id', public.ingest_mail_intake_item('test', 'prepared-mailbox', 'invalid-fuel-1', clock_timestamp(), 'Invalid fuel source')::text, true);
select set_config('prepared_mail.inactive_seller_id', public.ingest_mail_intake_item('test', 'prepared-mailbox', 'inactive-seller-1', clock_timestamp(), 'Inactive seller source')::text, true);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
select is((select vessel_voyage || '|' || port_name || '|' || delivery_window || '|' || fuel_items::text from public.list_mail_intake_items('53000000-0000-4000-8000-000000000001') where id = current_setting('prepared_mail.item_id')::uuid), 'Parsed vessel|Parsed port|Parsed delivery|[{"grade": "vlsfo", "quantity": 100}, {"grade": "lsmgo", "quantity": 10}]', 'pending intake exposes the bounded parsed candidates for prefill'); -- 8

create temporary table published_bid on commit drop as
select result.* from public.publish_mail_intake_bid(
  '53000000-0000-4000-8000-000000000001', current_setting('prepared_mail.item_id')::uuid, 1,
  'Edited vessel', 'Edited port', 'Edited delivery', clock_timestamp() + interval '2 days', null,
  array['vlsfo', 'lsmgo'], array[125, 15]::numeric[], array['52000000-0000-4000-8000-000000000004'::uuid]
) as result;
select ok((select id is not null and raw_status = 'open' and deadline_at is not null and created_by = '51000000-0000-4000-8000-000000000001'::uuid from published_bid), 'explicit publish creates one raw-open authoritative BID with the authenticated BUYER actor'); -- 9
select is((select vessel_voyage || '|' || port_name || '|' || delivery_window from published_bid), 'Edited vessel|Edited port|Edited delivery', 'BUYER edits, not parser candidates, become authoritative BID fields'); -- 10
select is((select count(*) from app_private.bid_items where bid_id = (select id from published_bid)), 2::bigint, 'publish creates the submitted authoritative fuel items'); -- 11
select is((select count(*) from app_private.bid_trader_organization_access where bid_id = (select id from published_bid)), 1::bigint, 'publish grants selected SELLER scope only'); -- 12
select is((select trader_organization_id from app_private.bid_trader_organization_access where bid_id = (select id from published_bid)), '52000000-0000-4000-8000-000000000004'::uuid, 'unselected active SELLER receives no scope'); -- 13
select is((select count(*) from app_private.bid_trader_organization_responses where bid_id = (select id from published_bid)), 1::bigint, 'publish creates awaiting response slots only for selected scope'); -- 14
select is((select response_status from app_private.bid_trader_organization_responses where bid_id = (select id from published_bid)), 'awaiting', 'selected SELLER response starts awaiting'); -- 15
select is((select count(*) from app_private.bid_audit_events where bid_id = (select id from published_bid) and event_type = 'created'), 1::bigint, 'publish appends exactly one created BID audit'); -- 16
select ok((select actor_user_id = '51000000-0000-4000-8000-000000000001'::uuid and after_snapshot -> 'allowed_trader_organization_ids' = jsonb_build_array('52000000-0000-4000-8000-000000000004'::uuid::text) from app_private.bid_audit_events where bid_id = (select id from published_bid) and event_type = 'created'), 'created audit snapshots exactly the selected SELLER scope'); -- 17
select ok((select converted_bid_id = (select id from published_bid) and converted_at is not null and converted_by_user_id = '51000000-0000-4000-8000-000000000001'::uuid and converted_by_membership_id = '53000000-0000-4000-8000-000000000001'::uuid from app_private.mail_intake_items where id = current_setting('prepared_mail.item_id')::uuid), 'published intake is linked and marked with the verified conversion actor'); -- 18
select is((select count(*) from public.list_mail_intake_items('53000000-0000-4000-8000-000000000001') where id = current_setting('prepared_mail.item_id')::uuid), 0::bigint, 'converted intake disappears from the pending list'); -- 19
select is((select id from public.publish_mail_intake_bid('53000000-0000-4000-8000-000000000001', current_setting('prepared_mail.item_id')::uuid, 1, null, null, null, null, null, null, null, null)), (select id from published_bid), 'repeat publish recognizes and returns the existing conversion'); -- 20
select is((select count(*) from app_private.bids where id = (select id from published_bid)), 1::bigint, 'repeat publish cannot create a duplicate BID'); -- 21
select is((select count(*) from app_private.bid_audit_events where bid_id = (select id from published_bid) and event_type = 'created'), 1::bigint, 'repeat publish cannot append a second created audit'); -- 22

select public.dismiss_mail_intake_item('53000000-0000-4000-8000-000000000001', current_setting('prepared_mail.dismissed_id')::uuid, 1);
select throws_ok($$select public.publish_mail_intake_bid('53000000-0000-4000-8000-000000000001', current_setting('prepared_mail.dismissed_id')::uuid, 2, 'V', 'P', 'W', clock_timestamp() + interval '1 day', null, array['vlsfo'], array[1]::numeric[], array[]::uuid[])$$, '55000', 'Only pending mail intake can be published', 'dismissed intake cannot publish'); -- 23
select is((select count(*) from app_private.mail_intake_items where id = current_setting('prepared_mail.dismissed_id')::uuid and converted_bid_id is not null), 0::bigint, 'dismissed intake remains unconverted'); -- 24

select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000002', true);
select throws_ok($$select public.publish_mail_intake_bid('53000000-0000-4000-8000-000000000002', current_setting('prepared_mail.nonbuyer_id')::uuid, 1, 'V', 'P', 'W', clock_timestamp() + interval '1 day', null, array['vlsfo'], array[1]::numeric[], array[]::uuid[])$$, '42501', 'Active BUYER membership is required', 'TRADER cannot publish mail intake'); -- 25

select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.publish_mail_intake_bid('53000000-0000-4000-8000-000000000003', current_setting('prepared_mail.inactive_id')::uuid, 1, 'V', 'P', 'W', clock_timestamp() + interval '1 day', null, array['vlsfo'], array[1]::numeric[], array[]::uuid[])$$, '42501', 'Active BUYER membership is required', 'inactive account cannot publish mail intake'); -- 26

select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
select throws_ok($$select public.publish_mail_intake_bid('53000000-0000-4000-8000-000000000001', current_setting('prepared_mail.missing_deadline_id')::uuid, 1, 'V', 'P', 'W', null, null, array['vlsfo'], array[1]::numeric[], array[]::uuid[])$$, '22023', 'Publish deadline is required', 'publish without deadline is denied'); -- 27
select throws_ok($$select public.publish_mail_intake_bid('53000000-0000-4000-8000-000000000001', current_setting('prepared_mail.invalid_fuel_id')::uuid, 1, 'V', 'P', 'W', clock_timestamp() + interval '1 day', null, array[]::text[], array[]::numeric[], array[]::uuid[])$$, '22023', 'Fuel grades and quantities must be non-empty equal-length arrays', 'publish without valid fuel items is denied'); -- 28
select throws_ok($$select public.publish_mail_intake_bid('53000000-0000-4000-8000-000000000001', current_setting('prepared_mail.inactive_seller_id')::uuid, 1, 'V', 'P', 'W', clock_timestamp() + interval '1 day', null, array['vlsfo'], array[1]::numeric[], array['52000000-0000-4000-8000-000000000006'::uuid])$$, '22023', 'Selected SELLER organizations must be active', 'inactive SELLER cannot receive published scope'); -- 29
select is((select count(*) from app_private.mail_intake_items where id in (current_setting('prepared_mail.missing_deadline_id')::uuid, current_setting('prepared_mail.invalid_fuel_id')::uuid, current_setting('prepared_mail.inactive_seller_id')::uuid) and converted_bid_id is not null), 0::bigint, 'failed publishes leave intake pending and unconverted'); -- 30

update app_private.bids set deadline_at = clock_timestamp() - interval '1 minute' where id = (select id from published_bid);
select throws_ok($$select public.grant_bid_trader_access('53000000-0000-4000-8000-000000000001', (select id from published_bid), 1, '52000000-0000-4000-8000-000000000005')$$, '55000', 'TRADER scope can be granted only while effective-open', 'post-deadline SELLER grant is denied server-side'); -- 31
select throws_ok($$select public.revoke_bid_trader_access('53000000-0000-4000-8000-000000000001', (select id from published_bid), 1, '52000000-0000-4000-8000-000000000004')$$, '55000', 'TRADER scope can be revoked only while effective-open', 'post-deadline SELLER revoke is denied server-side'); -- 32
select is((select count(*) from app_private.bid_trader_organization_access where bid_id = (select id from published_bid)), 1::bigint, 'post-close scope attempts retain the selected SELLER boundary'); -- 33

select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.list_trader_bids('53000000-0000-4000-8000-000000000002') where id = (select id from published_bid)), 0::bigint, 'unselected TRADER remains unable to view the published BID'); -- 34
select throws_ok($$select * from public.list_mail_intake_items('53000000-0000-4000-8000-000000000002')$$, '42501', 'Active BUYER membership is required', 'TRADER cannot list prepared intake'); -- 35
reset role;

select is((select count(*) from app_private.bid_audit_events where bid_id = (select id from published_bid)), 1::bigint, 'deadline scope denials leave the BID audit history unchanged'); -- 36
select ok(not exists(select 1 from app_private.mail_intake_items where converted_bid_id = (select id from published_bid) and status <> 'pending'::app_private.mail_intake_status), 'conversion link and dismissal state cannot coexist'); -- 37

select * from finish();
rollback;
