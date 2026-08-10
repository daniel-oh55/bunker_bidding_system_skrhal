begin;
select plan(39);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'authenticated receive authorized workspace broadcasts'
  ),
  'the workspace Broadcast receive policy exists'
);
select is(
  (select roles from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'authenticated receive authorized workspace broadcasts'),
  array['authenticated']::name[],
  'the workspace Broadcast receive policy is authenticated-only'
);
select is(
  (select cmd from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'authenticated receive authorized workspace broadcasts'),
  'SELECT',
  'the workspace Broadcast policy is SELECT-only'
);
select ok(
  (select qual from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'authenticated receive authorized workspace broadcasts') like '%extension = ''broadcast''%',
  'the receive policy is Broadcast-only'
);
select is(
  (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages' and cmd = 'INSERT' and policyname like '%workspace%'),
  0::bigint,
  'no application Broadcast INSERT policy exists'
);
select is(
  (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages' and 'anon'::name = any(roles) and policyname like '%workspace%'),
  0::bigint,
  'no anonymous application Broadcast policy exists'
);
select is(
  (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages' and cmd <> 'SELECT' and policyname like '%workspace%'),
  0::bigint,
  'no non-SELECT workspace Realtime policy exists'
);
select is(
  (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname like '%workspace%' and with_check is not null),
  0::bigint,
  'workspace notification policy grants no client send check'
);

select is(
  (select count(*) from pg_proc as procedure join pg_namespace as namespace on namespace.oid = procedure.pronamespace where namespace.nspname = 'app_private' and procedure.proname in ('send_workspace_changed', 'send_access_changed', 'broadcast_bid_workspace_changed', 'broadcast_quote_workspace_changed', 'broadcast_bid_trader_access_workspace_changed', 'broadcast_user_account_access_changed', 'broadcast_membership_access_changed', 'broadcast_organization_access_changed') and procedure.prosecdef),
  8::bigint,
  'all notification functions are SECURITY DEFINER'
);
select is(
  (select count(*) from pg_proc as procedure join pg_namespace as namespace on namespace.oid = procedure.pronamespace where namespace.nspname = 'app_private' and procedure.proname in ('send_workspace_changed', 'send_access_changed', 'broadcast_bid_workspace_changed', 'broadcast_quote_workspace_changed', 'broadcast_bid_trader_access_workspace_changed', 'broadcast_user_account_access_changed', 'broadcast_membership_access_changed', 'broadcast_organization_access_changed') and coalesce(array_to_string(procedure.proconfig, ','), '') like '%search_path=%'),
  8::bigint,
  'all notification functions pin an empty search_path'
);
select is(
  (select count(*) from pg_proc as procedure join pg_namespace as namespace on namespace.oid = procedure.pronamespace where namespace.nspname = 'app_private' and procedure.proname in ('send_workspace_changed', 'send_access_changed', 'broadcast_bid_workspace_changed', 'broadcast_quote_workspace_changed', 'broadcast_bid_trader_access_workspace_changed', 'broadcast_user_account_access_changed', 'broadcast_membership_access_changed', 'broadcast_organization_access_changed') and (has_function_privilege('anon', procedure.oid, 'EXECUTE') or has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))),
  0::bigint,
  'notification function execution is not exposed to anon or authenticated'
);
select is(
  (select count(*) from pg_trigger where not tgisinternal and tgname in ('broadcast_bid_workspace_changed', 'broadcast_quote_workspace_changed', 'broadcast_bid_trader_access_workspace_changed', 'broadcast_user_account_access_changed', 'broadcast_membership_access_changed', 'broadcast_organization_access_changed')),
  6::bigint,
  'the exact six notification triggers exist'
);
select is(
  (select count(*) from information_schema.role_table_grants where table_schema = 'app_private' and table_name in ('bids', 'bid_items', 'quotes', 'quote_items', 'bid_trader_organization_access', 'user_accounts', 'organizations', 'organization_memberships') and grantee in ('anon', 'authenticated') and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  0::bigint,
  'direct app_private business and membership table privileges remain denied'
);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000401', 'realtime-buyer@example.test'),
  ('00000000-0000-0000-0000-000000000402', 'realtime-trader-a@example.test'),
  ('00000000-0000-0000-0000-000000000403', 'realtime-trader-b@example.test'),
  ('00000000-0000-0000-0000-000000000404', 'realtime-no-context@example.test'),
  ('00000000-0000-0000-0000-000000000405', 'realtime-suspended@example.test');

insert into app_private.organizations (id, kind, name, status)
values
  ('00000000-0000-0000-0000-000000000411', 'buyer', 'Realtime Buyer', 'active'),
  ('00000000-0000-0000-0000-000000000412', 'trader', 'Realtime Trader A', 'active'),
  ('00000000-0000-0000-0000-000000000413', 'trader', 'Realtime Trader B', 'active');

update app_private.user_accounts set status = 'active' where user_id <> '00000000-0000-0000-0000-000000000405';
update app_private.user_accounts set status = 'suspended' where user_id = '00000000-0000-0000-0000-000000000405';

insert into app_private.organization_memberships (id, user_id, organization_id, role, status)
values
  ('00000000-0000-0000-0000-000000000421', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000411', 'buyer_admin', 'active'),
  ('00000000-0000-0000-0000-000000000422', '00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000412', 'trader', 'active'),
  ('00000000-0000-0000-0000-000000000423', '00000000-0000-0000-0000-000000000403', '00000000-0000-0000-0000-000000000413', 'trader', 'active'),
  ('00000000-0000-0000-0000-000000000424', '00000000-0000-0000-0000-000000000405', '00000000-0000-0000-0000-000000000412', 'trader', 'active');

delete from realtime.messages;
select realtime.send('{"kind":"workspace_changed"}'::jsonb, 'workspace_changed', 'workspace:buyer', true);
select realtime.send('{"kind":"workspace_changed"}'::jsonb, 'workspace_changed', 'workspace:trader:00000000-0000-0000-0000-000000000412', true);
select realtime.send('{"kind":"workspace_changed"}'::jsonb, 'workspace_changed', 'workspace:trader:00000000-0000-0000-0000-000000000413', true);
select realtime.send('{"kind":"access_changed"}'::jsonb, 'access_changed', 'workspace:access:00000000-0000-0000-0000-000000000401', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
select set_config('realtime.topic', 'workspace:buyer', true);
select is((select count(*) from realtime.messages), 4::bigint, 'active BUYER passes the BUYER workspace topic authorization check');
select set_config('realtime.topic', 'workspace:trader:00000000-0000-0000-0000-000000000412', true);
select is((select count(*) from realtime.messages), 0::bigint, 'BUYER cannot receive a TRADER workspace topic');
select set_config('realtime.topic', 'workspace:access:00000000-0000-0000-0000-000000000401', true);
select is((select count(*) from realtime.messages), 4::bigint, 'authenticated caller passes only its own access-topic authorization check');
select set_config('realtime.topic', 'workspace:access:00000000-0000-0000-0000-000000000402', true);
select is((select count(*) from realtime.messages), 0::bigint, 'authenticated caller cannot receive another users access topic');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000402', true);
select set_config('realtime.topic', 'workspace:trader:00000000-0000-0000-0000-000000000412', true);
select is((select count(*) from realtime.messages), 4::bigint, 'TRADER A passes its organization-topic authorization check');
select set_config('realtime.topic', 'workspace:trader:00000000-0000-0000-0000-000000000413', true);
select is((select count(*) from realtime.messages), 0::bigint, 'TRADER A cannot receive another organization topic');
select set_config('realtime.topic', 'workspace:buyer', true);
select is((select count(*) from realtime.messages), 0::bigint, 'TRADER cannot receive the BUYER workspace topic');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000404', true);
select set_config('realtime.topic', 'workspace:buyer', true);
select is((select count(*) from realtime.messages), 0::bigint, 'no-context caller cannot receive business topics');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000405', true);
select set_config('realtime.topic', 'workspace:trader:00000000-0000-0000-0000-000000000412', true);
select is((select count(*) from realtime.messages), 0::bigint, 'suspended caller cannot receive business topics');
reset role;

delete from realtime.messages;
insert into app_private.bids (id, vessel_voyage, port_name, delivery_window, status, created_by, responsible_buyer_user_id)
values ('00000000-0000-0000-0000-000000000431', 'Realtime Vessel', 'Busan', 'Window', 'open', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000401');
insert into app_private.bid_trader_organization_access (bid_id, trader_organization_id, granted_by_user_id, granted_by_membership_id)
values ('00000000-0000-0000-0000-000000000431', '00000000-0000-0000-0000-000000000412', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000421');
delete from realtime.messages;
update app_private.bids set port_name = 'Incheon' where id = '00000000-0000-0000-0000-000000000431';
select is((select count(*) from realtime.messages where event = 'workspace_changed' and topic in ('workspace:buyer', 'workspace:trader:00000000-0000-0000-0000-000000000412')), 2::bigint, 'bid mutation fans out to BUYER and each current scoped TRADER organization');
select is((select count(*) from realtime.messages where topic = 'workspace:trader:00000000-0000-0000-0000-000000000413'), 0::bigint, 'unrelated TRADER receives no bid invalidation');

delete from realtime.messages;
insert into app_private.quotes (id, bid_id, trader_organization_id, created_by, barge_fee)
values ('00000000-0000-0000-0000-000000000432', '00000000-0000-0000-0000-000000000431', '00000000-0000-0000-0000-000000000412', '00000000-0000-0000-0000-000000000402', 1);
select is((select count(*) from realtime.messages where event = 'workspace_changed' and topic in ('workspace:buyer', 'workspace:trader:00000000-0000-0000-0000-000000000412')), 2::bigint, 'quote mutation fans out to BUYER and its owning TRADER organization only');
select is((select count(*) from realtime.messages where topic = 'workspace:trader:00000000-0000-0000-0000-000000000413'), 0::bigint, 'unrelated TRADER receives no quote invalidation');

delete from realtime.messages;
delete from app_private.bid_trader_organization_access where bid_id = '00000000-0000-0000-0000-000000000431' and trader_organization_id = '00000000-0000-0000-0000-000000000412';
select is((select count(*) from realtime.messages where event = 'workspace_changed' and topic in ('workspace:buyer', 'workspace:trader:00000000-0000-0000-0000-000000000412')), 2::bigint, 'scope revoke notifies the removed TRADER organization and BUYER workspace');

delete from realtime.messages;
select realtime.send('{"kind":"workspace_changed"}'::jsonb, 'workspace_changed', 'workspace:trader:00000000-0000-0000-0000-000000000412', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000402', true);
select set_config('realtime.topic', 'workspace:trader:00000000-0000-0000-0000-000000000412', true);
select is((select count(*) from realtime.messages), 1::bigint, 'a revoked but active TRADER can still receive its organization-wide topic');
select is((select count(*) from public.list_trader_bids('00000000-0000-0000-0000-000000000422') where id = '00000000-0000-0000-0000-000000000431'), 0::bigint, 'authoritative TRADER bid RPC hides the revoked bid');
select throws_ok(
  $$select public.create_quote('00000000-0000-0000-0000-000000000422', '00000000-0000-0000-0000-000000000431', array['VLSFO'], array[1::numeric], 1::numeric)$$,
  '42501',
  'Current TRADER bid access is required',
  'authoritative TRADER mutation remains denied after scope revocation'
);
reset role;

delete from realtime.messages;
update app_private.bids set port_name = 'Ulsan' where id = '00000000-0000-0000-0000-000000000431';
select is((select count(*) from realtime.messages where event = 'workspace_changed' and topic = 'workspace:trader:00000000-0000-0000-0000-000000000412'), 0::bigint, 'later isolated Bid X changes do not notify the revoked TRADER organization');

insert into app_private.bids (id, vessel_voyage, port_name, delivery_window, status, created_by, responsible_buyer_user_id)
values ('00000000-0000-0000-0000-000000000433', 'Realtime Vessel Y', 'Busan', 'Window', 'open', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000401');
insert into app_private.bid_trader_organization_access (bid_id, trader_organization_id, granted_by_user_id, granted_by_membership_id)
values ('00000000-0000-0000-0000-000000000433', '00000000-0000-0000-0000-000000000412', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000421');
delete from realtime.messages;
update app_private.bids set port_name = 'Ulsan' where id = '00000000-0000-0000-0000-000000000433';
select is((select count(*) from realtime.messages where event = 'workspace_changed' and topic = 'workspace:trader:00000000-0000-0000-0000-000000000412'), 1::bigint, 'another still-scoped Bid Y continues notifying the TRADER organization');

delete from realtime.messages;
update app_private.user_accounts set status = 'inactive' where user_id = '00000000-0000-0000-0000-000000000401';
select is((select count(*) from realtime.messages where event = 'access_changed' and topic = 'workspace:access:00000000-0000-0000-0000-000000000401'), 1::bigint, 'account status change emits the affected access invalidation');

delete from realtime.messages;
update app_private.organizations set name = 'Realtime Trader A Updated' where id = '00000000-0000-0000-0000-000000000412';
select is((select count(*) from realtime.messages where event = 'access_changed' and topic in ('workspace:access:00000000-0000-0000-0000-000000000402', 'workspace:access:00000000-0000-0000-0000-000000000405')), 2::bigint, 'organization update fans out access invalidations to affected members');
select is((select count(*) from realtime.messages where event = 'workspace_changed' and topic = 'workspace:buyer'), 1::bigint, 'organization update invalidates the BUYER workspace');

select is((select count(*) from realtime.messages where event not in ('workspace_changed', 'access_changed')), 0::bigint, 'emitted event names are exact');
select is((select count(*) from realtime.messages where (payload - 'id') not in ('{"kind":"workspace_changed"}'::jsonb, '{"kind":"access_changed"}'::jsonb)), 0::bigint, 'every client payload is exactly an approved kind marker apart from Realtime storage identity');
select is((select count(*) from realtime.messages where payload ?| array['bid_id', 'quote_id', 'price', 'quantity', 'vessel_voyage', 'port_name', 'organization_name', 'email']), 0::bigint, 'no protected bid, quote, or identity fields are copied into payloads');
select is((select count(*) from realtime.messages where private is not true), 0::bigint, 'every application notification is private');

select * from finish();
rollback;
