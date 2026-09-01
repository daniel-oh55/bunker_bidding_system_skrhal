-- Retained commercial response state is deliberately separate from current
-- bid access. Access can be revoked; a response, quote, and audit history must remain.

create table app_private.bid_trader_organization_responses (
  bid_id uuid not null references app_private.bids (id) on delete restrict,
  trader_organization_id uuid not null references app_private.organizations (id) on delete restrict,
  response_status text not null check (response_status in ('awaiting', 'quoted', 'gave_up')),
  revision bigint not null default 1 check (revision >= 1),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (bid_id, trader_organization_id)
);

create table app_private.bid_trader_organization_response_audit_events (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references app_private.bids (id) on delete restrict,
  trader_organization_id uuid not null references app_private.organizations (id) on delete restrict,
  event_type text not null check (event_type in ('submitted', 'price_updated', 'gave_up', 'resumed')),
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  actor_membership_id uuid not null references app_private.organization_memberships (id) on delete restrict,
  actor_organization_id uuid not null references app_private.organizations (id) on delete restrict,
  actor_role app_private.membership_role not null check (actor_role = 'trader'::app_private.membership_role),
  occurred_at timestamptz not null default clock_timestamp(),
  prior_revision bigint not null check (prior_revision >= 1),
  resulting_revision bigint not null check (resulting_revision = prior_revision + 1),
  prior_status text not null check (prior_status in ('awaiting', 'quoted', 'gave_up')),
  resulting_status text not null check (resulting_status in ('awaiting', 'quoted', 'gave_up')),
  quote_id uuid null references app_private.quotes (id) on delete restrict,
  quote_revision bigint null check (quote_revision >= 1),
  before_snapshot jsonb not null check (octet_length(before_snapshot::text) <= 8192),
  after_snapshot jsonb not null check (octet_length(after_snapshot::text) <= 8192),
  check (
    (event_type = 'submitted' and prior_status = 'awaiting' and resulting_status = 'quoted')
    or (event_type = 'price_updated' and prior_status = 'quoted' and resulting_status = 'quoted')
    or (event_type = 'gave_up' and prior_status in ('awaiting', 'quoted') and resulting_status = 'gave_up')
    or (event_type = 'resumed' and prior_status = 'gave_up' and resulting_status = 'quoted')
  ),
  unique (bid_id, trader_organization_id, resulting_revision)
);

alter table app_private.bid_trader_organization_responses enable row level security;
alter table app_private.bid_trader_organization_response_audit_events enable row level security;
revoke all on table app_private.bid_trader_organization_responses, app_private.bid_trader_organization_response_audit_events from public, anon, authenticated;

create function app_private.set_bid_trader_response_updated_at()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create function app_private.reject_response_audit_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'Response audit history is append-only';
end;
$$;

create trigger set_bid_trader_response_updated_at
before update on app_private.bid_trader_organization_responses
for each row execute function app_private.set_bid_trader_response_updated_at();

create trigger reject_response_audit_update
before update on app_private.bid_trader_organization_response_audit_events
for each row execute function app_private.reject_response_audit_mutation();

create trigger reject_response_audit_delete
before delete on app_private.bid_trader_organization_response_audit_events
for each row execute function app_private.reject_response_audit_mutation();

-- Preserve the exact historic participant set without mutating existing records
-- or emitting one Realtime/audit event per retained participant.
insert into app_private.bid_trader_organization_responses (
  bid_id, trader_organization_id, response_status, revision
)
select participant.bid_id, participant.trader_organization_id,
  case when participant.has_quote then 'quoted' else 'awaiting' end,
  1
from (
  select access.bid_id, access.trader_organization_id, false as has_quote
  from app_private.bid_trader_organization_access as access
  union
  select quote.bid_id, quote.trader_organization_id, true as has_quote
  from app_private.quotes as quote
) as participant;

alter type app_private.quote_api_result add attribute response_status text;

create type app_private.trader_response_api_result as (
  bid_id uuid,
  trader_organization_id uuid,
  response_status text,
  revision bigint,
  quote_id uuid,
  quote_revision bigint
);

create function app_private.response_snapshot(p_bid_id uuid, p_trader_organization_id uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select jsonb_build_object(
    'bid_id', response.bid_id,
    'trader_organization_id', response.trader_organization_id,
    'response_status', response.response_status,
    'revision', response.revision,
    'quote', case when quote.id is null then null else app_private.quote_snapshot(quote.id) end
  )
  from app_private.bid_trader_organization_responses as response
  left join app_private.quotes as quote
    on quote.bid_id = response.bid_id
   and quote.trader_organization_id = response.trader_organization_id
  where response.bid_id = p_bid_id
    and response.trader_organization_id = p_trader_organization_id;
$$;

create function app_private.append_response_audit(
  p_bid_id uuid,
  p_trader_organization_id uuid,
  p_event_type text,
  p_actor_user_id uuid,
  p_actor_membership_id uuid,
  p_actor_organization_id uuid,
  p_actor_role app_private.membership_role,
  p_prior_revision bigint,
  p_prior_status text,
  p_before_snapshot jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_response app_private.bid_trader_organization_responses%rowtype;
  v_quote app_private.quotes%rowtype;
begin
  select * into v_response
  from app_private.bid_trader_organization_responses
  where bid_id = p_bid_id and trader_organization_id = p_trader_organization_id;
  select * into v_quote
  from app_private.quotes
  where bid_id = p_bid_id and trader_organization_id = p_trader_organization_id;
  insert into app_private.bid_trader_organization_response_audit_events (
    bid_id, trader_organization_id, event_type,
    actor_user_id, actor_membership_id, actor_organization_id, actor_role,
    prior_revision, resulting_revision, prior_status, resulting_status,
    quote_id, quote_revision, before_snapshot, after_snapshot
  ) values (
    p_bid_id, p_trader_organization_id, p_event_type,
    p_actor_user_id, p_actor_membership_id, p_actor_organization_id, p_actor_role,
    p_prior_revision, v_response.revision, p_prior_status, v_response.response_status,
    v_quote.id, v_quote.revision, p_before_snapshot,
    app_private.response_snapshot(p_bid_id, p_trader_organization_id)
  );
end;
$$;

create or replace function app_private.quote_result(p_quote_id uuid)
returns app_private.quote_api_result language sql volatile security definer set search_path = '' as $$
  select row(
    quote.id, quote.bid_id, quote.trader_organization_id, organization.name, quote.revision, quote.created_by,
    coalesce((select jsonb_agg(jsonb_build_object('fuel_grade', item.fuel_grade, 'unit_price', item.unit_price) order by item.display_order) from app_private.quote_items item where item.quote_id = quote.id), '[]'::jsonb),
    quote.barge_fee,
    quote.barge_fee + coalesce((select sum(item.unit_price * bid_item.quantity_mt) from app_private.quote_items item join app_private.bid_items bid_item on bid_item.bid_id = quote.bid_id and bid_item.fuel_grade = item.fuel_grade where item.quote_id = quote.id), 0),
    quote.created_at, quote.updated_at,
    exists (select 1 from app_private.bid_trader_organization_access access where access.bid_id = quote.bid_id and access.trader_organization_id = quote.trader_organization_id),
    organization.status = 'active'::app_private.organization_status,
    response.response_status = 'quoted'
      and exists (select 1 from app_private.bid_trader_organization_access access where access.bid_id = quote.bid_id and access.trader_organization_id = quote.trader_organization_id)
      and organization.status = 'active'::app_private.organization_status
      and app_private.effective_bid_status(bid.status, bid.deadline_at) = 'closed',
    bid.awarded_quote_id = quote.id,
    response.response_status
  )::app_private.quote_api_result
  from app_private.quotes quote
  join app_private.bid_trader_organization_responses response on response.bid_id = quote.bid_id and response.trader_organization_id = quote.trader_organization_id
  join app_private.organizations organization on organization.id = quote.trader_organization_id
  join app_private.bids bid on bid.id = quote.bid_id
  where quote.id = p_quote_id;
$$;

create or replace function public.create_bid(
  p_actor_membership_id uuid, p_vessel_voyage text, p_port_name text, p_delivery_window text,
  p_deadline_at timestamptz, p_responsible_buyer_user_id uuid default null,
  p_fuel_grades text[] default null, p_quantities numeric[] default null
)
returns app_private.bid_api_result language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_bid_id uuid; v_result app_private.bid_api_result;
begin
  select * into v_actor from app_private.require_active_buyer_actor(p_actor_membership_id);
  perform app_private.validate_bid_deadline(p_deadline_at);
  perform app_private.validate_bid_items(p_fuel_grades, p_quantities);
  if p_responsible_buyer_user_id is null then p_responsible_buyer_user_id := v_actor.user_id; end if;
  perform app_private.require_active_buyer_target(p_responsible_buyer_user_id);
  insert into app_private.bids (vessel_voyage, port_name, delivery_window, deadline_at, status, created_by, responsible_buyer_user_id)
  values (app_private.validate_bid_text(p_vessel_voyage, 'vessel_voyage'), app_private.validate_bid_text(p_port_name, 'port_name'), app_private.validate_bid_text(p_delivery_window, 'delivery_window'), p_deadline_at, 'open', v_actor.user_id, p_responsible_buyer_user_id)
  returning id into v_bid_id;
  insert into app_private.bid_items (bid_id, fuel_grade, quantity_mt, display_order)
  select v_bid_id, grades.grade, p_quantities[grades.ordinality], grades.ordinality::smallint
  from unnest(p_fuel_grades) with ordinality as grades(grade, ordinality);
  insert into app_private.bid_trader_organization_access (bid_id, trader_organization_id, granted_by_user_id, granted_by_membership_id)
  select v_bid_id, organization.id, v_actor.user_id, v_actor.membership_id
  from app_private.organizations as organization
  where organization.kind = 'trader'::app_private.organization_kind
    and organization.status = 'active'::app_private.organization_status;
  insert into app_private.bid_trader_organization_responses (bid_id, trader_organization_id, response_status, revision)
  select access.bid_id, access.trader_organization_id, 'awaiting', 1
  from app_private.bid_trader_organization_access as access
  where access.bid_id = v_bid_id;
  perform app_private.append_bid_audit(v_bid_id, 'created', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, null, null, null, null);
  select result.* into v_result from app_private.bid_result(v_bid_id) as result;
  return v_result;
end;
$$;

create or replace function public.grant_bid_trader_access(p_actor_membership_id uuid, p_bid_id uuid, p_expected_revision bigint, p_trader_organization_id uuid)
returns app_private.bid_api_result language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_bid app_private.bids%rowtype; v_before jsonb; v_result app_private.bid_api_result;
begin
  select * into v_actor from app_private.require_active_buyer_actor(p_actor_membership_id);
  select * into v_bid from app_private.bids where id = p_bid_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Bid not found'; end if;
  if p_expected_revision is null or v_bid.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'Bid revision conflict'; end if;
  if app_private.effective_bid_status(v_bid.status, v_bid.deadline_at) <> 'open' then raise exception using errcode = '55000', message = 'TRADER scope can be granted only while effective-open'; end if;
  perform app_private.require_active_trader_organization(p_trader_organization_id);
  if exists (select 1 from app_private.bid_trader_organization_access access where access.bid_id = p_bid_id and access.trader_organization_id = p_trader_organization_id) then raise exception using errcode = '23505', message = 'TRADER organization already has bid access'; end if;
  v_before := app_private.bid_snapshot(p_bid_id);
  insert into app_private.bid_trader_organization_access (bid_id, trader_organization_id, granted_by_user_id, granted_by_membership_id) values (p_bid_id, p_trader_organization_id, v_actor.user_id, v_actor.membership_id);
  insert into app_private.bid_trader_organization_responses (bid_id, trader_organization_id, response_status, revision)
  values (p_bid_id, p_trader_organization_id, 'awaiting', 1)
  on conflict (bid_id, trader_organization_id) do nothing;
  update app_private.bids set revision = revision + 1 where id = p_bid_id;
  perform app_private.append_bid_audit(p_bid_id, 'trader_access_granted', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, v_bid.revision, v_bid.status, v_bid.responsible_buyer_user_id, v_before);
  select * into v_result from app_private.bid_result(p_bid_id);
  return v_result;
end;
$$;

drop function public.list_trader_bids(uuid);
create function public.list_trader_bids(p_actor_membership_id uuid)
returns table (
  id uuid, vessel_voyage text, port_name text, delivery_window text, deadline_at timestamptz,
  raw_status text, effective_status text, revision bigint, fuel_items jsonb,
  created_at timestamptz, updated_at timestamptz, closed_at timestamptz, cancelled_at timestamptz,
  response_status text, response_revision bigint
)
language plpgsql security definer set search_path = '' as $$
declare v_actor record;
begin
  select * into v_actor from app_private.require_active_trader_actor(p_actor_membership_id);
  return query
  select bid.id, bid.vessel_voyage, bid.port_name, bid.delivery_window, bid.deadline_at,
    bid.status::text, app_private.effective_bid_status(bid.status, bid.deadline_at), bid.revision,
    coalesce((select jsonb_agg(jsonb_build_object('fuel_grade', item.fuel_grade, 'quantity_mt', item.quantity_mt) order by item.display_order) from app_private.bid_items item where item.bid_id = bid.id), '[]'::jsonb),
    bid.created_at, bid.updated_at, bid.closed_at, bid.cancelled_at,
    response.response_status, response.revision
  from app_private.bids as bid
  join app_private.bid_trader_organization_access as access on access.bid_id = bid.id and access.trader_organization_id = v_actor.organization_id
  join app_private.bid_trader_organization_responses as response on response.bid_id = bid.id and response.trader_organization_id = v_actor.organization_id
  where bid.bid_date = app_private.current_bid_date()
  order by bid.created_at desc, bid.id;
end;
$$;

drop function public.list_bid_seller_comparison_for_buyers(uuid, uuid);
create function public.list_bid_seller_comparison_for_buyers(p_actor_membership_id uuid, p_bid_id uuid)
returns table (
  bid_id uuid, trader_organization_id uuid, trader_organization_label text,
  access_active boolean, organization_active boolean, response_status text, quote jsonb
)
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active_buyer_actor(p_actor_membership_id);
  return query
  with participant_organizations as (
    select access.trader_organization_id from app_private.bid_trader_organization_access as access where access.bid_id = p_bid_id
    union
    select response.trader_organization_id from app_private.bid_trader_organization_responses as response where response.bid_id = p_bid_id
    union
    select quote.trader_organization_id from app_private.quotes as quote where quote.bid_id = p_bid_id
  )
  select p_bid_id, organization.id, organization.name,
    exists (select 1 from app_private.bid_trader_organization_access access where access.bid_id = p_bid_id and access.trader_organization_id = organization.id),
    organization.status = 'active'::app_private.organization_status,
    response.response_status,
    case when quote.id is null then null else to_jsonb(app_private.quote_result(quote.id)) end
  from participant_organizations participant
  join app_private.organizations organization on organization.id = participant.trader_organization_id
  left join app_private.bid_trader_organization_responses response on response.bid_id = p_bid_id and response.trader_organization_id = organization.id
  left join app_private.quotes quote on quote.bid_id = p_bid_id and quote.trader_organization_id = organization.id
  order by lower(btrim(organization.name)), organization.id;
end;
$$;

create function public.submit_quote_response(
  p_actor_membership_id uuid, p_bid_id uuid, p_expected_response_revision bigint,
  p_expected_quote_revision bigint, p_fuel_grades text[], p_unit_prices numeric[], p_barge_fee numeric
)
returns app_private.quote_api_result language plpgsql security definer set search_path = '' as $$
declare
  v_bid app_private.bids%rowtype; v_actor record;
  v_response app_private.bid_trader_organization_responses%rowtype;
  v_quote app_private.quotes%rowtype; v_quote_id uuid; v_before jsonb; v_quote_before jsonb;
  v_normalized_items jsonb; v_changed boolean; v_quote_exists boolean;
begin
  select * into v_bid from app_private.bids where id = p_bid_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Bid not found'; end if;
  select * into v_actor from app_private.require_active_trader_actor(p_actor_membership_id);
  if not exists (select 1 from app_private.bid_trader_organization_access access where access.bid_id = p_bid_id and access.trader_organization_id = v_actor.organization_id) then raise exception using errcode = '42501', message = 'Current TRADER bid access is required'; end if;
  if v_bid.bid_date <> app_private.current_bid_date() then raise exception using errcode = '55000', message = 'Quote responses are editable only for today''s Seoul operational date'; end if;
  if app_private.effective_bid_status(v_bid.status, v_bid.deadline_at) <> 'open' then raise exception using errcode = '55000', message = 'Quote responses are editable only while effective-open'; end if;
  select * into v_response from app_private.bid_trader_organization_responses where bid_id = p_bid_id and trader_organization_id = v_actor.organization_id for update;
  if not found then raise exception using errcode = '42501', message = 'A retained response slot is required'; end if;
  if p_expected_response_revision is null or v_response.revision <> p_expected_response_revision then raise exception using errcode = '40001', message = 'Response revision conflict'; end if;
  select * into v_quote from app_private.quotes where bid_id = p_bid_id and trader_organization_id = v_actor.organization_id for update;
  v_quote_exists := found;
  perform app_private.validate_quote_values(p_bid_id, p_fuel_grades, p_unit_prices, p_barge_fee);
  select jsonb_agg(jsonb_build_object('fuel_grade', bid_item.fuel_grade, 'unit_price', submitted.unit_price, 'display_order', bid_item.display_order) order by bid_item.display_order)
  into v_normalized_items
  from app_private.bid_items bid_item join unnest(p_fuel_grades, p_unit_prices) submitted(fuel_grade, unit_price) on submitted.fuel_grade = bid_item.fuel_grade
  where bid_item.bid_id = p_bid_id;
  v_before := app_private.response_snapshot(p_bid_id, v_actor.organization_id);
  if v_response.response_status = 'awaiting' then
    if v_quote_exists then raise exception using errcode = '22023', message = 'Awaiting response cannot retain a quote'; end if;
    if p_expected_quote_revision is not null then raise exception using errcode = '40001', message = 'Quote revision conflict'; end if;
    insert into app_private.quotes (bid_id, trader_organization_id, created_by, barge_fee) values (p_bid_id, v_actor.organization_id, v_actor.user_id, p_barge_fee) returning id into v_quote_id;
    insert into app_private.quote_items (quote_id, fuel_grade, unit_price, display_order)
    select v_quote_id, item.fuel_grade, item.unit_price, item.display_order from jsonb_to_recordset(v_normalized_items) as item(fuel_grade text, unit_price numeric, display_order smallint) order by item.display_order;
    perform app_private.append_quote_audit(v_quote_id, 'created', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, null, null);
    update app_private.bid_trader_organization_responses set response_status = 'quoted', revision = revision + 1 where bid_id = p_bid_id and trader_organization_id = v_actor.organization_id;
    perform app_private.append_response_audit(p_bid_id, v_actor.organization_id, 'submitted', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, v_response.revision, v_response.response_status, v_before);
  elsif v_response.response_status = 'quoted' then
    if not v_quote_exists then raise exception using errcode = '22023', message = 'Quoted response must retain a quote'; end if;
    if p_expected_quote_revision is null or v_quote.revision <> p_expected_quote_revision then raise exception using errcode = '40001', message = 'Quote revision conflict'; end if;
    v_changed := v_quote.barge_fee <> p_barge_fee or (select jsonb_agg(jsonb_build_object('fuel_grade', item.fuel_grade, 'unit_price', item.unit_price, 'display_order', item.display_order) order by item.display_order) from app_private.quote_items item where item.quote_id = v_quote.id) <> v_normalized_items;
    if not v_changed then raise exception using errcode = '22023', message = 'Quote response makes no changes'; end if;
    v_quote_before := app_private.quote_snapshot(v_quote.id);
    update app_private.quotes set barge_fee = p_barge_fee, revision = revision + 1 where id = v_quote.id;
    delete from app_private.quote_items where quote_id = v_quote.id;
    insert into app_private.quote_items (quote_id, fuel_grade, unit_price, display_order) select v_quote.id, item.fuel_grade, item.unit_price, item.display_order from jsonb_to_recordset(v_normalized_items) as item(fuel_grade text, unit_price numeric, display_order smallint) order by item.display_order;
    perform app_private.append_quote_audit(v_quote.id, 'updated', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, v_quote.revision, v_quote_before);
    update app_private.bid_trader_organization_responses set revision = revision + 1 where bid_id = p_bid_id and trader_organization_id = v_actor.organization_id;
    perform app_private.append_response_audit(p_bid_id, v_actor.organization_id, 'price_updated', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, v_response.revision, v_response.response_status, v_before);
    v_quote_id := v_quote.id;
  elsif v_response.response_status = 'gave_up' then
    if v_quote_exists then
      if p_expected_quote_revision is null or v_quote.revision <> p_expected_quote_revision then raise exception using errcode = '40001', message = 'Quote revision conflict'; end if;
      v_changed := v_quote.barge_fee <> p_barge_fee or (select jsonb_agg(jsonb_build_object('fuel_grade', item.fuel_grade, 'unit_price', item.unit_price, 'display_order', item.display_order) order by item.display_order) from app_private.quote_items item where item.quote_id = v_quote.id) <> v_normalized_items;
      if v_changed then
        v_quote_id := v_quote.id;
        v_quote_before := app_private.quote_snapshot(v_quote.id);
        update app_private.quotes set barge_fee = p_barge_fee, revision = revision + 1 where id = v_quote.id;
        delete from app_private.quote_items where quote_id = v_quote.id;
        insert into app_private.quote_items (quote_id, fuel_grade, unit_price, display_order) select v_quote.id, item.fuel_grade, item.unit_price, item.display_order from jsonb_to_recordset(v_normalized_items) as item(fuel_grade text, unit_price numeric, display_order smallint) order by item.display_order;
        perform app_private.append_quote_audit(v_quote.id, 'updated', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, v_quote.revision, v_quote_before);
      else
        v_quote_id := v_quote.id;
      end if;
    else
      if p_expected_quote_revision is not null then raise exception using errcode = '40001', message = 'Quote revision conflict'; end if;
      insert into app_private.quotes (bid_id, trader_organization_id, created_by, barge_fee) values (p_bid_id, v_actor.organization_id, v_actor.user_id, p_barge_fee) returning id into v_quote_id;
      insert into app_private.quote_items (quote_id, fuel_grade, unit_price, display_order) select v_quote_id, item.fuel_grade, item.unit_price, item.display_order from jsonb_to_recordset(v_normalized_items) as item(fuel_grade text, unit_price numeric, display_order smallint) order by item.display_order;
      perform app_private.append_quote_audit(v_quote_id, 'created', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, null, null);
    end if;
    update app_private.bid_trader_organization_responses set response_status = 'quoted', revision = revision + 1 where bid_id = p_bid_id and trader_organization_id = v_actor.organization_id;
    perform app_private.append_response_audit(p_bid_id, v_actor.organization_id, 'resumed', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, v_response.revision, v_response.response_status, v_before);
    perform app_private.send_workspace_changed('workspace:buyer');
    perform app_private.send_workspace_changed('workspace:trader:' || v_actor.organization_id::text);
  else
    raise exception using errcode = '22023', message = 'Unknown response status';
  end if;
  return app_private.quote_result(v_quote_id);
end;
$$;

create function public.give_up_quote_response(p_actor_membership_id uuid, p_bid_id uuid, p_expected_response_revision bigint)
returns app_private.trader_response_api_result language plpgsql security definer set search_path = '' as $$
declare v_bid app_private.bids%rowtype; v_actor record; v_response app_private.bid_trader_organization_responses%rowtype; v_quote app_private.quotes%rowtype; v_before jsonb; v_result app_private.trader_response_api_result;
begin
  select * into v_bid from app_private.bids where id = p_bid_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Bid not found'; end if;
  select * into v_actor from app_private.require_active_trader_actor(p_actor_membership_id);
  if not exists (select 1 from app_private.bid_trader_organization_access access where access.bid_id = p_bid_id and access.trader_organization_id = v_actor.organization_id) then raise exception using errcode = '42501', message = 'Current TRADER bid access is required'; end if;
  if v_bid.bid_date <> app_private.current_bid_date() then raise exception using errcode = '55000', message = 'Quote responses are editable only for today''s Seoul operational date'; end if;
  if app_private.effective_bid_status(v_bid.status, v_bid.deadline_at) <> 'open' then raise exception using errcode = '55000', message = 'Quote responses are editable only while effective-open'; end if;
  select * into v_response from app_private.bid_trader_organization_responses where bid_id = p_bid_id and trader_organization_id = v_actor.organization_id for update;
  if not found then raise exception using errcode = '42501', message = 'A retained response slot is required'; end if;
  if p_expected_response_revision is null or v_response.revision <> p_expected_response_revision then raise exception using errcode = '40001', message = 'Response revision conflict'; end if;
  if v_response.response_status = 'gave_up' then raise exception using errcode = '22023', message = 'Quote response already gave up'; end if;
  select * into v_quote from app_private.quotes where bid_id = p_bid_id and trader_organization_id = v_actor.organization_id for update;
  v_before := app_private.response_snapshot(p_bid_id, v_actor.organization_id);
  update app_private.bid_trader_organization_responses set response_status = 'gave_up', revision = revision + 1 where bid_id = p_bid_id and trader_organization_id = v_actor.organization_id;
  perform app_private.append_response_audit(p_bid_id, v_actor.organization_id, 'gave_up', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, v_response.revision, v_response.response_status, v_before);
  perform app_private.send_workspace_changed('workspace:buyer');
  perform app_private.send_workspace_changed('workspace:trader:' || v_actor.organization_id::text);
  select response.bid_id, response.trader_organization_id, response.response_status, response.revision, quote.id, quote.revision
  into v_result
  from app_private.bid_trader_organization_responses response
  left join app_private.quotes quote on quote.bid_id = response.bid_id and quote.trader_organization_id = response.trader_organization_id
  where response.bid_id = p_bid_id and response.trader_organization_id = v_actor.organization_id;
  return v_result;
end;
$$;

create or replace function public.award_bid(p_actor_membership_id uuid, p_bid_id uuid, p_expected_revision bigint, p_quote_id uuid, p_expected_quote_revision bigint)
returns app_private.bid_api_result language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_bid app_private.bids%rowtype; v_response app_private.bid_trader_organization_responses%rowtype; v_quote app_private.quotes%rowtype; v_before jsonb; v_result app_private.bid_api_result;
begin
  select * into v_actor from app_private.require_active_buyer_actor(p_actor_membership_id);
  select * into v_bid from app_private.bids where id = p_bid_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Bid not found'; end if;
  if p_expected_revision is null or v_bid.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'Bid revision conflict'; end if;
  if v_bid.status in ('cancelled', 'awarded') then raise exception using errcode = '55000', message = 'Cancelled or awarded bids cannot be awarded'; end if;
  if app_private.effective_bid_status(v_bid.status, v_bid.deadline_at) <> 'closed' then raise exception using errcode = '55000', message = 'Bid must be effective-closed before award'; end if;
  select * into v_quote from app_private.quotes where id = p_quote_id;
  if not found or v_quote.bid_id <> p_bid_id then raise exception using errcode = '22023', message = 'Quote does not belong to bid'; end if;
  select * into v_response from app_private.bid_trader_organization_responses where bid_id = p_bid_id and trader_organization_id = v_quote.trader_organization_id for update;
  if not found or v_response.response_status <> 'quoted' then raise exception using errcode = '55000', message = 'Quote response is not active'; end if;
  select * into v_quote from app_private.quotes where id = p_quote_id for update;
  if p_expected_quote_revision is null or v_quote.revision <> p_expected_quote_revision then raise exception using errcode = '40001', message = 'Quote revision conflict'; end if;
  if not exists (select 1 from app_private.bid_trader_organization_access access where access.bid_id = p_bid_id and access.trader_organization_id = v_quote.trader_organization_id) then raise exception using errcode = '55000', message = 'Quote TRADER access is no longer active'; end if;
  perform app_private.require_active_trader_organization(v_quote.trader_organization_id);
  v_before := app_private.bid_snapshot(p_bid_id);
  update app_private.bids set status = 'awarded', awarded_quote_id = p_quote_id, awarded_at = clock_timestamp(), closed_at = coalesce(v_bid.closed_at, clock_timestamp()), revision = revision + 1 where id = p_bid_id;
  perform app_private.append_bid_audit(p_bid_id, 'awarded', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, v_bid.revision, v_bid.status, v_bid.responsible_buyer_user_id, v_before);
  select * into v_result from app_private.bid_result(p_bid_id);
  return v_result;
end;
$$;

revoke all on function public.create_quote(uuid, uuid, text[], numeric[], numeric), public.update_quote(uuid, uuid, bigint, text[], numeric[], numeric) from public, anon, authenticated;
revoke all on function public.list_trader_bids(uuid), public.list_bid_seller_comparison_for_buyers(uuid, uuid), public.submit_quote_response(uuid, uuid, bigint, bigint, text[], numeric[], numeric), public.give_up_quote_response(uuid, uuid, bigint) from public, anon;
grant execute on function public.list_trader_bids(uuid), public.list_bid_seller_comparison_for_buyers(uuid, uuid), public.submit_quote_response(uuid, uuid, bigint, bigint, text[], numeric[], numeric), public.give_up_quote_response(uuid, uuid, bigint) to authenticated;
revoke all on function app_private.set_bid_trader_response_updated_at(), app_private.reject_response_audit_mutation(), app_private.response_snapshot(uuid, uuid), app_private.append_response_audit(uuid, uuid, text, uuid, uuid, uuid, app_private.membership_role, bigint, text, jsonb) from public, anon, authenticated;
