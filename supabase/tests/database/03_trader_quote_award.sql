begin;
select plan(48);

insert into auth.users (id,email,raw_user_meta_data,raw_app_meta_data) values
  ('10000000-0000-0000-0000-000000000001','buyer-a@quote.test','{"role":"trader"}','{"role":"trader"}'),
  ('10000000-0000-0000-0000-000000000002','buyer-b@quote.test','{}','{}'),
  ('10000000-0000-0000-0000-000000000003','trader-a@quote.test','{"role":"buyer_admin"}','{"role":"buyer_admin"}'),
  ('10000000-0000-0000-0000-000000000004','trader-b@quote.test','{}','{}'),
  ('10000000-0000-0000-0000-000000000005','trader-other@quote.test','{}','{}');
update app_private.user_accounts set status='active' where user_id::text like '10000000-%';
insert into app_private.organizations (id,kind,name,status) values
  ('20000000-0000-0000-0000-000000000001','buyer','Quote Buyer A','active'),
  ('20000000-0000-0000-0000-000000000002','buyer','Quote Buyer B','active'),
  ('20000000-0000-0000-0000-000000000003','trader','Quote Trader A','active'),
  ('20000000-0000-0000-0000-000000000004','trader','Quote Trader Other','active'),
  ('20000000-0000-0000-0000-000000000005','trader','Quote Trader Inactive','inactive');
insert into app_private.organization_memberships (id,user_id,organization_id,role,status) values
  ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','buyer_admin','active'),
  ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','buyer_operator','active'),
  ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003','trader','active'),
  ('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000003','trader','active'),
  ('30000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000004','trader','active');

select has_table('app_private','bid_trader_organization_access','current TRADER access table exists'); -- 1
select has_table('app_private','quotes','organization quote table exists'); -- 2
select has_table('app_private','quote_items','quote item table exists'); -- 3
select has_table('app_private','quote_audit_events','quote audit table exists'); -- 4
select ok((select relrowsecurity from pg_class where oid='app_private.quotes'::regclass),'quotes has RLS'); -- 5
select ok((select relrowsecurity from pg_class where oid='app_private.quote_items'::regclass),'quote items has RLS'); -- 6
select ok(not has_table_privilege('authenticated','app_private.quotes','select'),'authenticated cannot directly read quotes'); -- 7
select ok(not has_table_privilege('authenticated','app_private.quote_items','delete'),'authenticated cannot hard-delete quote items'); -- 8
select ok(not has_function_privilege('anon','public.create_quote(uuid,uuid,text[],numeric[],numeric)'::regprocedure,'execute'),'anon cannot create quotes'); -- 9
select ok(has_function_privilege('authenticated','public.create_quote(uuid,uuid,text[],numeric[],numeric)'::regprocedure,'execute'),'authenticated can execute quote RPC'); -- 10
select ok(not has_function_privilege('authenticated','app_private.require_active_trader_actor(uuid)'::regprocedure,'execute'),'authenticated cannot execute TRADER helper'); -- 11
select ok((select prosecdef from pg_proc where oid='public.award_bid(uuid,uuid,bigint,uuid,bigint)'::regprocedure),'award RPC is security definer'); -- 12
select is((select proconfig::text like '%search_path=%' from pg_proc where oid='public.award_bid(uuid,uuid,bigint,uuid,bigint)'::regprocedure),true,'award RPC fixes search path'); -- 13
select ok(exists(select 1 from pg_constraint where conrelid='app_private.quotes'::regclass and contype='u' and conkey=array[2,3]::smallint[]),'one quote per bid and organization is constrained'); -- 14
select ok(exists(select 1 from pg_constraint where conrelid='app_private.bids'::regclass and conname='bids_awarded_quote_same_bid'),'award quote uses same-bid composite FK'); -- 15

set local role anon;
select throws_like($$select * from public.list_trader_bids('30000000-0000-0000-0000-000000000003')$$,'%permission denied%','anon cannot list TRADER bids'); -- 16
select throws_like($$select * from public.list_quotes_for_buyers('30000000-0000-0000-0000-000000000001')$$,'%permission denied%','anon cannot list BUYER quotes'); -- 17
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.grant_bid_trader_access('30000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001',1,'20000000-0000-0000-0000-000000000003')$$,'42501','An active BUYER membership is required','TRADER cannot grant scope despite forged metadata'); -- 18
select throws_ok($$select public.create_quote('30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',array['vlsfo'],array[1]::numeric[],0)$$,'42501','An active TRADER membership is required','BUYER cannot create a TRADER quote'); -- 19
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
create temporary table quote_test_ids (bid_id uuid, quote_id uuid) on commit drop;
insert into quote_test_ids(bid_id) select (public.create_bid('30000000-0000-0000-0000-000000000001','Quote vessel','Busan','Window',clock_timestamp()+interval '1 day',null,array['vlsfo','lsmgo'],array[10,2]::numeric[])).id;
select is((select (public.grant_bid_trader_access('30000000-0000-0000-0000-000000000001,bid_id,1,'20000000-0000-0000-0000-000000000003')).revision from quote_test_ids),2::bigint,'BUYER grants active TRADER organization'); -- 20
select is((select count(*) from public.list_bid_trader_access('30000000-0000-0000-0000-000000000002',(select bid_id from quote_test_ids))),1::bigint,'every active BUYER sees current access scope'); -- 21
select throws_ok($$select public.grant_bid_trader_access('30000000-0000-0000-0000-000000000001',(select bid_id from quote_test_ids),2,'20000000-0000-0000-0000-000000000003')$$,'23505','TRADER organization already has bid access','duplicate scope grant is rejected'); -- 22
select throws_ok($$select public.grant_bid_trader_access('30000000-0000-0000-0000-000000000001',(select bid_id from quote_test_ids),2,'20000000-0000-0000-0000-000000000005')$$,'22023','Target organization must be an active TRADER organization','inactive target organization is rejected'); -- 23

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select is((select count(*) from public.list_trader_bids('30000000-0000-0000-0000-000000000003') where id=(select bid_id from quote_test_ids)),1::bigint,'scoped TRADER lists bid'); -- 24
insert into quote_test_ids(quote_id) select (public.create_quote('30000000-0000-0000-0000-000000000003,(select bid_id from quote_test_ids),array['vlsfo','lsmgo'],array[100,200]::numeric[],5)).id;
select is((select total_amount from public.list_my_quotes('30000000-0000-0000-0000-000000000003') where id=(select quote_id from quote_test_ids)),1405::numeric,'quote total is server calculated'); -- 25
select is((select count(*) from app_private.quote_audit_events where quote_id=(select quote_id from quote_test_ids)),1::bigint,'create produces one quote audit event'); -- 26
select throws_ok($$select public.create_quote('30000000-0000-0000-0000-000000000003,(select bid_id from quote_test_ids),array['vlsfo','lsmgo'],array[100,200]::numeric[],5)$$,'23505','Organization already has a quote for this bid','organization cannot create second quote'); -- 27
select throws_ok($$select public.update_quote('30000000-0000-0000-0000-000000000003,(select quote_id from quote_test_ids),1,array['vlsfo'],array[100]::numeric[],5)$$,'22023','Quote fuel grades must exactly match bid fuel grades','missing grade is rejected'); -- 28
select throws_ok($$select public.update_quote('30000000-0000-0000-0000-000000000003,(select quote_id from quote_test_ids),1,array['vlsfo','lsmgo'],array[0,200]::numeric[],5)$$,'22023','Unit price must be finite and greater than zero','zero price is rejected'); -- 29
select throws_ok($$select public.update_quote('30000000-0000-0000-0000-000000000003,(select quote_id from quote_test_ids),1,array['vlsfo','lsmgo'],array[100,200]::numeric[],5)$$,'22023','Quote update makes no changes','no-op quote update is rejected'); -- 30
select is((select (public.update_quote('30000000-0000-0000-0000-000000000004,(select quote_id from quote_test_ids),1,array['vlsfo','lsmgo'],array[101,201]::numeric[],6)).revision),2::bigint,'same-organization TRADER collaborates on quote'); -- 31
select is((select created_by from app_private.quotes where id=(select quote_id from quote_test_ids)),'10000000-0000-0000-0000-000000000003'::uuid,'quote creator stays immutable'); -- 32
select is((select count(*) from app_private.quote_audit_events where quote_id=(select quote_id from quote_test_ids)),2::bigint,'one audit event per successful quote mutation'); -- 33
select throws_ok($$update app_private.quotes set created_by='10000000-0000-0000-0000-000000000004' where id=(select quote_id from quote_test_ids)$$,'42501','Quote identity is immutable','elevated direct identity change is rejected'); -- 34

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
select is((select count(*) from public.list_my_quotes('30000000-0000-0000-0000-000000000005') where id=(select quote_id from quote_test_ids)),0::bigint,'different organization cannot read quote'); -- 35
select throws_ok($$select public.update_quote('30000000-0000-0000-0000-000000000005,(select quote_id from quote_test_ids),2,array['vlsfo','lsmgo'],array[102,202]::numeric[],6)$$,'42501','Current TRADER bid access is required','different organization cannot update quote'); -- 36

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select count(*) from public.list_quotes_for_buyers('30000000-0000-0000-0000-000000000001',(select bid_id from quote_test_ids))),1::bigint,'BUYER sees retained quote'); -- 37
select is((select (public.revoke_bid_trader_access('30000000-0000-0000-0000-000000000001,(select bid_id from quote_test_ids),2,'20000000-0000-0000-0000-000000000003')).revision),3::bigint,'BUYER revokes scope in one revision'); -- 38
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select is((select count(*) from public.list_my_quotes('30000000-0000-0000-0000-000000000003') where id=(select quote_id from quote_test_ids)),0::bigint,'revocation immediately removes quote visibility'); -- 39
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select count(*) from public.list_quotes_for_buyers('30000000-0000-0000-0000-000000000001',(select bid_id from quote_test_ids))),1::bigint,'revocation preserves BUYER visibility'); -- 40
select is((select (public.grant_bid_trader_access('30000000-0000-0000-0000-000000000001,(select bid_id from quote_test_ids),3,'20000000-0000-0000-0000-000000000003')).revision),4::bigint,'regrant restores scope while open'); -- 41
select is((select (public.close_bid('30000000-0000-0000-0000-000000000001,(select bid_id from quote_test_ids),4)).raw_status),'closed','close bid with quote'); -- 42
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.update_quote('30000000-0000-0000-0000-000000000003,(select quote_id from quote_test_ids),2,array['vlsfo','lsmgo'],array[102,202]::numeric[],6)$$,'55000','Quotes are editable only while effective-open','close blocks quote update'); -- 43
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select (public.award_bid('30000000-0000-0000-0000-000000000001,(select bid_id from quote_test_ids),5,(select quote_id from quote_test_ids),2)).raw_status),'awarded','effective-closed bid award succeeds'); -- 44
select is((select awarded_quote_id from app_private.bids where id=(select bid_id from quote_test_ids)),(select quote_id from quote_test_ids),'award stores selected quote'); -- 45
select is((select count(*) from app_private.bid_audit_events where bid_id=(select bid_id from quote_test_ids) and event_type='awarded'),1::bigint,'award creates one bid audit event'); -- 46
select throws_ok($$select public.cancel_bid('30000000-0000-0000-0000-000000000001,(select bid_id from quote_test_ids),6)$$,'55000','Only raw open or closed bids can be cancelled','awarded bid cannot cancel'); -- 47
select ok(to_regprocedure('public.unaward_bid(uuid,uuid,bigint)') is null,'no public unaward API exists'); -- 48

select * from finish();
rollback;
