begin;
select plan(85);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-000000000011', 'buyer-a@bid.test', '{"role":"trader"}', '{"role":"trader"}'),
  ('00000000-0000-0000-0000-000000000012', 'buyer-b@bid.test', '{}', '{}'),
  ('00000000-0000-0000-0000-000000000013', 'buyer-c@bid.test', '{}', '{}'),
  ('00000000-0000-0000-0000-000000000014', 'trader@bid.test', '{"role":"buyer_admin"}', '{"role":"buyer_admin"}'),
  ('00000000-0000-0000-0000-000000000015', 'inactive@bid.test', '{"role":"buyer_admin"}', '{"role":"buyer_admin"}');
update app_private.user_accounts set status = 'active', display_name = 'Buyer ' || substr(user_id::text, 37, 1)
where user_id in ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000014');
insert into app_private.organizations (id, kind, name, status) values
  ('00000000-0000-0000-0000-000000000111', 'buyer', 'Bid Buyer One', 'active'),
  ('00000000-0000-0000-0000-000000000112', 'buyer', 'Bid Buyer Two', 'active'),
  ('00000000-0000-0000-0000-000000000113', 'buyer', 'Bid Buyer Three', 'active'),
  ('00000000-0000-0000-0000-000000000114', 'trader', 'Bid Trader', 'active'),
  ('00000000-0000-0000-0000-000000000115', 'buyer', 'Bid Inactive Org', 'inactive');
insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values
  ('00000000-0000-0000-0000-000000000211', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000111', 'buyer_admin', 'active'),
  ('00000000-0000-0000-0000-000000000212', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000112', 'buyer_operator', 'active'),
  ('00000000-0000-0000-0000-000000000213', '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000113', 'buyer_admin', 'active'),
  ('00000000-0000-0000-0000-000000000214', '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000114', 'trader', 'active'),
  ('00000000-0000-0000-0000-000000000215', '00000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000115', 'buyer_admin', 'active');

set local role anon;
select throws_like($$select * from public.list_bids('00000000-0000-0000-0000-000000000211')$$, '%permission denied%', 'anon cannot execute bid APIs');
select throws_like($$select * from app_private.bids$$, '%permission denied%', 'anon cannot select private bids');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000014', true);
select throws_ok($$select * from public.list_bids('00000000-0000-0000-0000-000000000214')$$, '42501', 'An active BUYER membership is required', 'TRADER cannot list bids');
select throws_ok($$select public.create_bid('00000000-0000-0000-0000-000000000214', 'V', 'P', 'W', null, null, array['vlsfo'], array[1]::numeric[])$$, '42501', 'An active BUYER membership is required', 'TRADER cannot create bids despite forged metadata');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000015', true);
select throws_ok($$select * from public.list_bids('00000000-0000-0000-0000-000000000215')$$, '42501', 'An active BUYER membership is required', 'inactive BUYER account or organization is denied');
reset role;
update app_private.organizations set status = 'suspended' where id = '00000000-0000-0000-0000-000000000111';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select throws_ok($$select * from public.list_bids('00000000-0000-0000-0000-000000000211')$$, '42501', 'An active BUYER membership is required', 'suspended BUYER organization is denied');
reset role;
update app_private.organizations set status = 'active' where id = '00000000-0000-0000-0000-000000000111';
update auth.users set raw_user_meta_data = '{"role":"buyer_admin"}'::jsonb, raw_app_meta_data = '{"role":"buyer_admin"}'::jsonb where id = '00000000-0000-0000-0000-000000000011';
update app_private.organization_memberships set status = 'suspended' where id = '00000000-0000-0000-0000-000000000211';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select throws_ok($$select * from public.list_bids('00000000-0000-0000-0000-000000000211')$$, '42501', 'An active BUYER membership is required', 'forged BUYER claims cannot bypass a suspended BUYER membership');
reset role;
update app_private.organization_memberships set status = 'active' where id = '00000000-0000-0000-0000-000000000211';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select throws_like($$select * from app_private.bids$$, '%permission denied%', 'authenticated caller cannot select private bids');
select throws_like($$insert into app_private.bids (vessel_voyage, port_name, delivery_window, created_by, responsible_buyer_user_id) values ('V', 'P', 'W', auth.uid(), auth.uid())$$, '%permission denied%', 'authenticated caller cannot insert private bids');
select throws_like($$update app_private.bids set vessel_voyage = 'x'$$, '%permission denied%', 'authenticated caller cannot update private bids');
select throws_like($$delete from app_private.bids$$, '%permission denied%', 'authenticated caller cannot delete private bids');
select throws_like($$insert into app_private.bid_audit_events (bid_id, event_type, actor_user_id, actor_membership_id, actor_organization_id, actor_role, resulting_revision, resulting_status, resulting_responsible_buyer_user_id, after_snapshot) values (gen_random_uuid(), 'created', auth.uid(), '00000000-0000-0000-0000-000000000211', '00000000-0000-0000-0000-000000000111', 'buyer_admin', 1, 'open', auth.uid(), '{}'::jsonb)$$, '%permission denied%', 'authenticated caller cannot insert audit rows');
select throws_like($$update app_private.bid_audit_events set after_snapshot = '{}'::jsonb$$, '%permission denied%', 'authenticated caller cannot update audit rows');
select throws_like($$delete from app_private.bid_audit_events$$, '%permission denied%', 'authenticated caller cannot delete audit rows');

create temporary table bid_test_ids (name text primary key, id uuid not null) on commit drop;
insert into bid_test_ids (name, id)
select 'main', (public.create_bid('00000000-0000-0000-0000-000000000211', ' Vessel A ', ' Busan ', ' 1-3 Aug ', clock_timestamp() + interval '1 day', null, array['vlsfo', 'lsmgo'], array[100, 25]::numeric[])).id;
select is((select raw_status from public.list_bids('00000000-0000-0000-0000-000000000211') where id = (select id from bid_test_ids where name = 'main')), 'open', 'create returns an expanded result with raw status');
select is((select pg_typeof(id)::text from public.list_bids('00000000-0000-0000-0000-000000000211') where id = (select id from bid_test_ids where name = 'main')), 'uuid', 'list_bids returns expanded typed id fields');
select is((select pg_typeof(fuel_items)::text from public.list_bids('00000000-0000-0000-0000-000000000211') where id = (select id from bid_test_ids where name = 'main')), 'jsonb', 'list_bids returns expanded typed fuel item fields');
select is((select count(*) from public.list_active_buyers('00000000-0000-0000-0000-000000000211')), 3::bigint, 'active BUYER selection returns all and only active BUYER users');
reset role;
select is((select created_by from app_private.bids where id = (select id from bid_test_ids where name = 'main')), '00000000-0000-0000-0000-000000000011'::uuid, 'creator is the actual authenticated user');
select is((select responsible_buyer_user_id from app_private.bids where id = (select id from bid_test_ids where name = 'main')), '00000000-0000-0000-0000-000000000011'::uuid, 'responsibility defaults to actual authenticated user');
select is((select count(*) from app_private.bid_items where bid_id = (select id from bid_test_ids where name = 'main')), 2::bigint, 'create stores every fuel item');
select is((select count(*) from app_private.bid_audit_events where bid_id = (select id from bid_test_ids where name = 'main')), 1::bigint, 'create emits exactly one audit event');
select ok(exists (select 1 from pg_constraint where conrelid = 'app_private.bid_audit_events'::regclass and contype = 'u' and conkey = array[2, 10]::smallint[]), 'audit event uniqueness covers bid and resulting revision');
select throws_like($$insert into app_private.bid_audit_events (bid_id, event_type, actor_user_id, actor_membership_id, actor_organization_id, actor_role, resulting_revision, resulting_status, resulting_responsible_buyer_user_id, after_snapshot) values ((select id from bid_test_ids where name = 'main'), 'created', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000211', '00000000-0000-0000-0000-000000000111', 'buyer_admin', 1, 'open', '00000000-0000-0000-0000-000000000011', '{}'::jsonb)$$, 'duplicate key value violates unique constraint%', 'elevated duplicate audit revision is rejected');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', true);
select throws_ok($$select * from public.list_bids('00000000-0000-0000-0000-000000000211')$$, '42501', 'An active BUYER membership is required', 'a BUYER cannot use another user''s active BUYER membership ID');
select is((select count(*) from public.list_bids('00000000-0000-0000-0000-000000000212', 'all')), 1::bigint, 'BUYER B in another organization sees all bids');
select is((select count(*) from public.list_bids('00000000-0000-0000-0000-000000000212', 'created_by_me')), 0::bigint, 'created_by_me uses immutable creator');
select is((select count(*) from public.list_bids('00000000-0000-0000-0000-000000000212', 'responsible_buyer', '00000000-0000-0000-0000-000000000011')), 1::bigint, 'responsible_buyer view filters responsibility');
select throws_ok($$select * from public.list_bids('00000000-0000-0000-0000-000000000212', 'invalid')$$, '22023', 'Unknown bid view', 'unknown bid view is rejected');
select throws_ok($$select * from public.list_bids('00000000-0000-0000-0000-000000000212', 'responsible_buyer')$$, '22023', 'responsible_buyer view requires a target user', 'responsible view requires a target');
select is((select (public.update_bid('00000000-0000-0000-0000-000000000212', (select id from bid_test_ids where name = 'main'), 1, 'Vessel B', 'Incheon', '4-5 Aug', clock_timestamp() + interval '2 days', array['hsfo'], array[200]::numeric[])).revision), 2::bigint, 'update returns an expanded revision');
reset role;
select is((select actor_user_id from app_private.bid_audit_events where bid_id = (select id from bid_test_ids where name = 'main') and resulting_revision = 2), '00000000-0000-0000-0000-000000000012'::uuid, 'cross-BUYER audit records actual actor');
select is((select after_snapshot ->> 'vessel_voyage' from app_private.bid_audit_events where bid_id = (select id from bid_test_ids where name = 'main') and resulting_revision = 2), 'Vessel B', 'audit after snapshot is generated from stored values');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000013', true);
select is((select (public.reassign_bid('00000000-0000-0000-0000-000000000213', (select id from bid_test_ids where name = 'main'), 2, '00000000-0000-0000-0000-000000000012')).responsible_buyer_user_id), '00000000-0000-0000-0000-000000000012'::uuid, 'reassignment returns an expanded responsible BUYER');
select throws_ok($$select public.reassign_bid('00000000-0000-0000-0000-000000000213', (select id from bid_test_ids where name = 'main'), 3, '00000000-0000-0000-0000-000000000012')$$, '22023', 'Bid is already assigned to that BUYER', 'no-op reassignment is rejected');
reset role;
select is((select actor_user_id from app_private.bid_audit_events where bid_id = (select id from bid_test_ids where name = 'main') and event_type = 'responsible_buyer_changed' and resulting_revision = 3), '00000000-0000-0000-0000-000000000013'::uuid, 'reassignment audit records the actual BUYER actor');
select is((select prior_responsible_buyer_user_id from app_private.bid_audit_events where bid_id = (select id from bid_test_ids where name = 'main') and event_type = 'responsible_buyer_changed' and resulting_revision = 3), '00000000-0000-0000-0000-000000000011'::uuid, 'reassignment audit records the prior responsible BUYER');
select is((select resulting_responsible_buyer_user_id from app_private.bid_audit_events where bid_id = (select id from bid_test_ids where name = 'main') and event_type = 'responsible_buyer_changed' and resulting_revision = 3), '00000000-0000-0000-0000-000000000012'::uuid, 'reassignment audit records the resulting responsible BUYER');
select is((select revision from app_private.bids where id = (select id from bid_test_ids where name = 'main')), 3::bigint, 'no-op reassignment leaves revision unchanged');
select is((select responsible_buyer_user_id from app_private.bids where id = (select id from bid_test_ids where name = 'main')), '00000000-0000-0000-0000-000000000012'::uuid, 'no-op reassignment leaves responsibility unchanged');
select is((select count(*) from app_private.bid_audit_events where bid_id = (select id from bid_test_ids where name = 'main')), 3::bigint, 'no-op reassignment creates no audit event');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000013', true);
select throws_ok($$select public.reassign_bid('00000000-0000-0000-0000-000000000213', (select id from bid_test_ids where name = 'main'), 3, '00000000-0000-0000-0000-000000000014')$$, '22023', 'Responsible BUYER must have an active BUYER membership', 'TRADER cannot be responsible');
select throws_ok($$select public.reassign_bid('00000000-0000-0000-0000-000000000213', (select id from bid_test_ids where name = 'main'), 3, '00000000-0000-0000-0000-000000000015')$$, '22023', 'Responsible BUYER must have an active BUYER membership', 'inactive BUYER cannot be responsible');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select throws_ok($$select public.close_bid('00000000-0000-0000-0000-000000000211', '00000000-0000-0000-0000-000000000299', 1)$$, 'P0002', 'Bid not found', 'active BUYER close rejects a nonexistent bid');
select is((select (public.close_bid('00000000-0000-0000-0000-000000000211', (select id from bid_test_ids where name = 'main'), 3)).raw_status), 'closed', 'close returns an expanded raw status');
select throws_ok($$select public.reopen_bid('00000000-0000-0000-0000-000000000211', (select id from bid_test_ids where name = 'main'), 4, clock_timestamp() - interval '1 second')$$, '22023', 'Deadline must be strictly in the future', 'reopen with a past deadline is rejected');
select is((select result.revision from public.reopen_bid('00000000-0000-0000-0000-000000000211', (select id from bid_test_ids where name = 'main'), 4, clock_timestamp() + interval '1 day') as result), 5::bigint, 'reopen returns an expanded revision');
select is((select (public.cancel_bid('00000000-0000-0000-0000-000000000211', (select id from bid_test_ids where name = 'main'), 5)).raw_status), 'cancelled', 'cancel returns an expanded raw status');
select throws_ok($$select public.update_bid('00000000-0000-0000-0000-000000000211', (select id from bid_test_ids where name = 'main'), 6, 'V', 'P', 'W', null, array['vlsfo'], array[1]::numeric[])$$, '55000', 'Bid details are editable only while effective-open', 'cancelled bid cannot update');
select throws_ok($$select public.reassign_bid('00000000-0000-0000-0000-000000000211', (select id from bid_test_ids where name = 'main'), 6, '00000000-0000-0000-0000-000000000011')$$, '55000', 'Cancelled or awarded bids cannot be reassigned', 'cancelled bid cannot reassign');
select throws_ok($$select public.close_bid('00000000-0000-0000-0000-000000000211', (select id from bid_test_ids where name = 'main'), 6)$$, '55000', 'Only raw open bids can be closed', 'cancelled bid cannot close');
select throws_ok($$select public.reopen_bid('00000000-0000-0000-0000-000000000211', (select id from bid_test_ids where name = 'main'), 6, null)$$, '55000', 'Only closed or expired raw open bids can be reopened', 'cancelled bid cannot reopen');
select throws_ok($$select public.cancel_bid('00000000-0000-0000-0000-000000000211', (select id from bid_test_ids where name = 'main'), 6)$$, '55000', 'Only raw open or closed bids can be cancelled', 'cancellation is irreversible');

insert into bid_test_ids (name, id)
select 'expired', (public.create_bid('00000000-0000-0000-0000-000000000211', 'Expired', 'Busan', 'Now', clock_timestamp() + interval '1 hour', null, array['vlsfo'], array[1]::numeric[])).id;
reset role;
update app_private.bids set deadline_at = clock_timestamp() - interval '1 second' where id = (select id from bid_test_ids where name = 'expired');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', true);
select is((select effective_status from public.list_bids('00000000-0000-0000-0000-000000000212') where id = (select id from bid_test_ids where name = 'expired')), 'closed', 'expired raw open bid is effective closed');
select throws_ok($$select public.update_bid('00000000-0000-0000-0000-000000000212', (select id from bid_test_ids where name = 'expired'), 1, 'V', 'P', 'W', clock_timestamp() + interval '1 hour', array['vlsfo'], array[1]::numeric[])$$, '55000', 'Bid details are editable only while effective-open', 'expired open bid cannot extend deadline with normal update');
select is((select (public.reopen_bid('00000000-0000-0000-0000-000000000212', (select id from bid_test_ids where name = 'expired'), 1, clock_timestamp() + interval '1 day')).revision), 2::bigint, 'expired raw open bid can reopen');
select throws_ok($$select public.create_bid('00000000-0000-0000-0000-000000000212', ' ', 'P', 'W', null, null, array['vlsfo'], array[1]::numeric[])$$, '22023', 'vessel_voyage is required', 'blank required field is rejected');
select throws_ok($$select public.create_bid('00000000-0000-0000-0000-000000000212', 'V', 'P', 'W', null, null, array['bad'], array[1]::numeric[])$$, '22023', 'Unsupported fuel grade', 'invalid fuel grade is rejected');
select throws_ok($$select public.create_bid('00000000-0000-0000-0000-000000000212', 'V', 'P', 'W', null, null, array['vlsfo','vlsfo'], array[1,2]::numeric[])$$, '22023', 'Fuel grades must be unique', 'duplicate fuel grade is rejected');
select throws_ok($$select public.create_bid('00000000-0000-0000-0000-000000000212', 'V', 'P', 'W', null, null, array['vlsfo'], array[0]::numeric[])$$, '22023', 'Fuel quantity must be finite and greater than zero', 'zero quantity is rejected');
select throws_ok($$select public.create_bid('00000000-0000-0000-0000-000000000212', 'V', 'P', 'W', null, null, array['vlsfo'], array[-1]::numeric[])$$, '22023', 'Fuel quantity must be finite and greater than zero', 'negative quantity is rejected');
select throws_ok($$select public.create_bid('00000000-0000-0000-0000-000000000212', 'V', 'P', 'W', null, null, array['vlsfo'], array[null::numeric])$$, '22023', 'Fuel quantity must be finite and greater than zero', 'null quantity is rejected');
select throws_ok($$select public.create_bid('00000000-0000-0000-0000-000000000212', 'V', 'P', 'W', null, null, array['vlsfo'], array[]::numeric[])$$, '22023', 'Fuel grades and quantities must be non-empty equal-length arrays', 'mismatched fuel arrays are rejected');
select throws_ok($$select public.create_bid('00000000-0000-0000-0000-000000000212', 'V', 'P', 'W', null, null, array[]::text[], array[]::numeric[])$$, '22023', 'Fuel grades and quantities must be non-empty equal-length arrays', 'empty item set is rejected');
select throws_ok($$select public.create_bid('00000000-0000-0000-0000-000000000212', 'V', 'P', 'W', clock_timestamp() - interval '1 second', null, array['vlsfo'], array[1]::numeric[])$$, '22023', 'Deadline must be strictly in the future', 'past create deadline is rejected');
insert into bid_test_ids (name, id)
select 'deadline-validation', (public.create_bid('00000000-0000-0000-0000-000000000212', 'Deadline', 'Busan', 'Tomorrow', clock_timestamp() + interval '1 day', null, array['vlsfo'], array[1]::numeric[])).id;
select throws_ok($$select public.update_bid('00000000-0000-0000-0000-000000000212', (select id from bid_test_ids where name = 'deadline-validation'), 1, 'Deadline', 'Busan', 'Tomorrow', clock_timestamp() - interval '1 second', array['vlsfo'], array[1]::numeric[])$$, '22023', 'Deadline must be strictly in the future', 'normal update with a past deadline is rejected');
select throws_ok($$select public.update_bid('00000000-0000-0000-0000-000000000212', (select id from bid_test_ids where name = 'expired'), 1, 'V', 'P', 'W', null, array['vlsfo'], array[1]::numeric[])$$, '40001', 'Bid revision conflict', 'stale expected revision is rejected');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
insert into bid_test_ids (name, id)
select 'closed-cancel', (public.create_bid('00000000-0000-0000-0000-000000000211', 'Closed cancel', 'Busan', 'Tomorrow', null, null, array['vlsfo'], array[1]::numeric[])).id;
select is((select (public.close_bid('00000000-0000-0000-0000-000000000211', (select id from bid_test_ids where name = 'closed-cancel'), 1)).raw_status), 'closed', 'a raw open bid can close before cancellation');
select is((select (public.cancel_bid('00000000-0000-0000-0000-000000000211', (select id from bid_test_ids where name = 'closed-cancel'), 2)).raw_status), 'cancelled', 'a raw closed bid can cancel');
insert into bid_test_ids (name, id)
select 'expired-close', (public.create_bid('00000000-0000-0000-0000-000000000211', 'Expired close', 'Busan', 'Now', clock_timestamp() + interval '1 hour', null, array['vlsfo'], array[1]::numeric[])).id;
reset role;
update app_private.bids set deadline_at = clock_timestamp() - interval '1 second' where id = (select id from bid_test_ids where name = 'expired-close');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select is((select (public.close_bid('00000000-0000-0000-0000-000000000211', (select id from bid_test_ids where name = 'expired-close'), 1)).raw_status), 'closed', 'an expired raw open bid can close');

reset role;
select throws_ok($$update app_private.bids set created_by = '00000000-0000-0000-0000-000000000012' where id = (select id from bid_test_ids where name = 'main')$$, '42501', 'Bid creator is immutable', 'creator trigger rejects even elevated direct change');
select is((select count(*) from app_private.bid_audit_events where bid_id = (select id from bid_test_ids where name = 'main')), 6::bigint, 'failed mutations create no audit event');
select is((select array_agg(resulting_revision order by resulting_revision) from app_private.bid_audit_events where bid_id = (select id from bid_test_ids where name = 'main')), array[1,2,3,4,5,6]::bigint[], 'audit revisions form an unbroken sequence');
select is((select actor_membership_id from app_private.bid_audit_events where bid_id = (select id from bid_test_ids where name = 'main') and resulting_revision = 2), '00000000-0000-0000-0000-000000000212'::uuid, 'audit snapshots actor membership');
select is((select actor_organization_id from app_private.bid_audit_events where bid_id = (select id from bid_test_ids where name = 'main') and resulting_revision = 2), '00000000-0000-0000-0000-000000000112'::uuid, 'audit snapshots actor organization');
select is((select actor_role::text from app_private.bid_audit_events where bid_id = (select id from bid_test_ids where name = 'main') and resulting_revision = 2), 'buyer_operator', 'audit snapshots actor role');
select is((select provolatile::text from pg_proc where oid = 'app_private.effective_bid_status(app_private.bid_status,timestamptz)'::regprocedure), 'v', 'effective bid status is VOLATILE');
select is((select provolatile::text from pg_proc where oid = 'app_private.bid_snapshot(uuid)'::regprocedure), 'v', 'bid snapshot is VOLATILE');
select is((select provolatile::text from pg_proc where oid = 'app_private.bid_result(uuid)'::regprocedure), 'v', 'bid result is VOLATILE');
select ok(not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('delete_bid', 'remove_bid')), 'no hard-delete public API exists');
select ok((select prosecdef from pg_proc where oid = 'public.create_bid(uuid,text,text,text,timestamptz,uuid,text[],numeric[])'::regprocedure), 'public create function is security definer');
select is((select proconfig::text like '%search_path=%' from pg_proc where oid = 'public.create_bid(uuid,text,text,text,timestamptz,uuid,text[],numeric[])'::regprocedure), true, 'public create function has a fixed search path');
select is((select pg_get_userbyid(proowner) from pg_proc where oid = 'public.create_bid(uuid,text,text,text,timestamptz,uuid,text[],numeric[])'::regprocedure), current_user, 'public create function owner is the migration owner');
select is((select has_function_privilege('anon', 'public.create_bid(uuid,text,text,text,timestamptz,uuid,text[],numeric[])'::regprocedure, 'execute')), false, 'anon has no create execute privilege');
select is((select has_function_privilege('authenticated', 'public.create_bid(uuid,text,text,text,timestamptz,uuid,text[],numeric[])'::regprocedure, 'execute')), true, 'authenticated has intended create execute privilege');

select * from finish();
rollback;
