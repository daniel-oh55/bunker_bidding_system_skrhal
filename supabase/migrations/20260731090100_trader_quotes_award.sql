-- Organization-scoped trader quotes and final awards.  Enum labels were added in
-- the preceding migration so this migration never uses a label in the same
-- transaction in which it was introduced.

create table app_private.bid_trader_organization_access (
  bid_id uuid not null references app_private.bids (id) on delete restrict,
  trader_organization_id uuid not null references app_private.organizations (id) on delete restrict,
  granted_at timestamptz not null default clock_timestamp(),
  granted_by_user_id uuid not null references auth.users (id) on delete restrict,
  granted_by_membership_id uuid not null references app_private.organization_memberships (id) on delete restrict,
  primary key (bid_id, trader_organization_id)
);

create table app_private.quotes (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references app_private.bids (id) on delete restrict,
  trader_organization_id uuid not null references app_private.organizations (id) on delete restrict,
  revision bigint not null default 1 check (revision >= 1),
  created_by uuid not null references auth.users (id) on delete restrict,
  barge_fee numeric not null check (barge_fee::text not in ('NaN', 'Infinity', '-Infinity') and barge_fee >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (bid_id, trader_organization_id),
  unique (id, bid_id)
);

create table app_private.quote_items (
  quote_id uuid not null references app_private.quotes (id) on delete restrict,
  fuel_grade text not null check (fuel_grade in ('vlsfo', 'hsfo', 'ulsfo', 'lsfo', 'lsmgo')),
  unit_price numeric not null check (unit_price::text not in ('NaN', 'Infinity', '-Infinity') and unit_price > 0),
  display_order smallint not null check (display_order between 1 and 5),
  primary key (quote_id, fuel_grade),
  unique (quote_id, display_order)
);

create table app_private.quote_audit_events (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references app_private.quotes (id) on delete restrict,
  bid_id uuid not null references app_private.bids (id) on delete restrict,
  trader_organization_id uuid not null references app_private.organizations (id) on delete restrict,
  event_type text not null check (event_type in ('created', 'updated')),
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  actor_membership_id uuid not null references app_private.organization_memberships (id) on delete restrict,
  actor_organization_id uuid not null references app_private.organizations (id) on delete restrict,
  actor_role app_private.membership_role not null,
  occurred_at timestamptz not null default clock_timestamp(),
  prior_revision bigint null,
  resulting_revision bigint not null check (resulting_revision >= 1),
  before_snapshot jsonb null,
  after_snapshot jsonb not null,
  constraint quote_audit_revision_consistency check (
    (event_type = 'created' and prior_revision is null and before_snapshot is null and resulting_revision = 1)
    or (event_type = 'updated' and prior_revision is not null and before_snapshot is not null and resulting_revision = prior_revision + 1)
  ),
  unique (quote_id, resulting_revision)
);

alter table app_private.bids add column awarded_quote_id uuid null;
alter table app_private.bids add column awarded_at timestamptz null;
alter table app_private.bids drop constraint bids_status_timestamp_consistency;
alter table app_private.bids add constraint bids_awarded_quote_same_bid
  foreign key (awarded_quote_id, id) references app_private.quotes (id, bid_id) on delete restrict;
alter table app_private.bids add constraint bids_status_timestamp_consistency check (
  (status = 'open'::app_private.bid_status and closed_at is null and cancelled_at is null and awarded_quote_id is null and awarded_at is null)
  or (status = 'closed'::app_private.bid_status and closed_at is not null and cancelled_at is null and awarded_quote_id is null and awarded_at is null)
  or (status = 'awarded'::app_private.bid_status and closed_at is not null and cancelled_at is null and awarded_quote_id is not null and awarded_at is not null)
  or (status = 'cancelled'::app_private.bid_status and cancelled_at is not null and awarded_quote_id is null and awarded_at is null)
);

alter type app_private.bid_api_result add attribute awarded_quote_id uuid;
alter type app_private.bid_api_result add attribute awarded_trader_organization_id uuid;
alter type app_private.bid_api_result add attribute awarded_trader_organization_label text;
alter type app_private.bid_api_result add attribute awarded_total_amount numeric;
alter type app_private.bid_api_result add attribute awarded_at timestamptz;

create type app_private.quote_api_result as (
  id uuid, bid_id uuid, trader_organization_id uuid, trader_organization_label text,
  revision bigint, created_by uuid, fuel_prices jsonb, barge_fee numeric, total_amount numeric,
  created_at timestamptz, updated_at timestamptz, access_active boolean,
  organization_active boolean, eligible_for_award boolean, is_awarded boolean
);

create function app_private.reject_quote_identity_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.created_by is distinct from old.created_by
    or new.bid_id is distinct from old.bid_id
    or new.trader_organization_id is distinct from old.trader_organization_id then
    raise exception using errcode = '42501', message = 'Quote identity is immutable';
  end if;
  return new;
end;
$$;

create trigger reject_quote_identity_change before update of created_by, bid_id, trader_organization_id
on app_private.quotes for each row execute function app_private.reject_quote_identity_change();
create trigger set_quotes_updated_at before update on app_private.quotes
for each row execute function app_private.set_updated_at();

alter table app_private.bid_trader_organization_access enable row level security;
alter table app_private.quotes enable row level security;
alter table app_private.quote_items enable row level security;
alter table app_private.quote_audit_events enable row level security;
revoke all on table app_private.bid_trader_organization_access, app_private.quotes, app_private.quote_items, app_private.quote_audit_events from public, anon, authenticated;

create or replace function app_private.effective_bid_status(p_status app_private.bid_status, p_deadline_at timestamptz)
returns text language sql volatile security definer set search_path = '' as $$
  select case
    when p_status = 'awarded'::app_private.bid_status then 'awarded'
    when p_status = 'closed'::app_private.bid_status then 'closed'
    when p_status = 'cancelled'::app_private.bid_status then 'cancelled'
    when p_deadline_at is not null and p_deadline_at <= clock_timestamp() then 'closed'
    else 'open'
  end;
$$;

create function app_private.require_active_trader_actor(p_actor_membership_id uuid)
returns table (user_id uuid, membership_id uuid, organization_id uuid, membership_role app_private.membership_role)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'An active TRADER membership is required'; end if;
  return query
  select account.user_id, membership.id, organization.id, membership.role
  from app_private.user_accounts account
  join app_private.organization_memberships membership on membership.user_id = account.user_id
  join app_private.organizations organization on organization.id = membership.organization_id
  where membership.id = p_actor_membership_id and account.user_id = auth.uid()
    and account.status = 'active'::app_private.account_status
    and membership.status = 'active'::app_private.membership_status
    and organization.status = 'active'::app_private.organization_status
    and organization.kind = 'trader'::app_private.organization_kind
    and membership.role = 'trader'::app_private.membership_role;
  if not found then raise exception using errcode = '42501', message = 'An active TRADER membership is required'; end if;
end;
$$;

create function app_private.require_active_trader_organization(p_organization_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from app_private.organizations organization
    where organization.id = p_organization_id and organization.kind = 'trader'::app_private.organization_kind
      and organization.status = 'active'::app_private.organization_status) then
    raise exception using errcode = '22023', message = 'Target organization must be an active TRADER organization';
  end if;
end;
$$;

create function app_private.require_trader_bid_access(p_actor_membership_id uuid, p_bid_id uuid)
returns table (user_id uuid, membership_id uuid, organization_id uuid, membership_role app_private.membership_role)
language plpgsql security definer set search_path = '' as $$
declare v_actor record;
begin
  select * into v_actor from app_private.require_active_trader_actor(p_actor_membership_id);
  if not exists (select 1 from app_private.bid_trader_organization_access access
      where access.bid_id = p_bid_id and access.trader_organization_id = v_actor.organization_id) then
    raise exception using errcode = '42501', message = 'Current TRADER bid access is required';
  end if;
  return query select v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role;
end;
$$;

create function app_private.validate_quote_values(p_bid_id uuid, p_fuel_grades text[], p_unit_prices numeric[], p_barge_fee numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_index integer; v_grade text; v_price numeric;
begin
  if p_fuel_grades is null or p_unit_prices is null or cardinality(p_fuel_grades) is null or cardinality(p_unit_prices) is null
    or cardinality(p_fuel_grades) = 0 or cardinality(p_fuel_grades) <> cardinality(p_unit_prices) then
    raise exception using errcode = '22023', message = 'Fuel grades and unit prices must be non-empty equal-length arrays';
  end if;
  if p_barge_fee is null or p_barge_fee::text in ('NaN', 'Infinity', '-Infinity') or p_barge_fee < 0 then
    raise exception using errcode = '22023', message = 'Barge fee must be finite and non-negative';
  end if;
  for v_index in 1..cardinality(p_fuel_grades) loop
    v_grade := p_fuel_grades[v_index]; v_price := p_unit_prices[v_index];
    if v_grade is null then raise exception using errcode = '22023', message = 'Fuel grade is required'; end if;
    if v_price is null or v_price::text in ('NaN', 'Infinity', '-Infinity') or v_price <= 0 then
      raise exception using errcode = '22023', message = 'Unit price must be finite and greater than zero';
    end if;
  end loop;
  if (select count(distinct grade) from unnest(p_fuel_grades) grade) <> cardinality(p_fuel_grades) then
    raise exception using errcode = '22023', message = 'Fuel grades must be unique';
  end if;
  if (select array_agg(grade order by grade) from unnest(p_fuel_grades) grade) is distinct from
     (select array_agg(item.fuel_grade order by item.fuel_grade) from app_private.bid_items item where item.bid_id = p_bid_id) then
    raise exception using errcode = '22023', message = 'Quote fuel grades must exactly match bid fuel grades';
  end if;
end;
$$;

create function app_private.quote_snapshot(p_quote_id uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select jsonb_build_object('id', quote.id, 'bid_id', quote.bid_id, 'trader_organization_id', quote.trader_organization_id,
    'revision', quote.revision, 'created_by', quote.created_by, 'barge_fee', quote.barge_fee,
    'fuel_prices', coalesce((select jsonb_agg(jsonb_build_object('fuel_grade', item.fuel_grade, 'unit_price', item.unit_price) order by item.display_order)
      from app_private.quote_items item where item.quote_id = quote.id), '[]'::jsonb),
    'total_amount', quote.barge_fee + coalesce((select sum(item.unit_price * bid_item.quantity_mt)
      from app_private.quote_items item join app_private.bid_items bid_item on bid_item.bid_id = quote.bid_id and bid_item.fuel_grade = item.fuel_grade where item.quote_id = quote.id), 0))
  from app_private.quotes quote where quote.id = p_quote_id;
$$;

create function app_private.quote_result(p_quote_id uuid)
returns app_private.quote_api_result language sql volatile security definer set search_path = '' as $$
  select row(quote.id, quote.bid_id, quote.trader_organization_id, organization.name, quote.revision, quote.created_by,
    coalesce((select jsonb_agg(jsonb_build_object('fuel_grade', item.fuel_grade, 'unit_price', item.unit_price) order by item.display_order) from app_private.quote_items item where item.quote_id = quote.id), '[]'::jsonb),
    quote.barge_fee, quote.barge_fee + coalesce((select sum(item.unit_price * bid_item.quantity_mt) from app_private.quote_items item join app_private.bid_items bid_item on bid_item.bid_id = quote.bid_id and bid_item.fuel_grade = item.fuel_grade where item.quote_id = quote.id), 0),
    quote.created_at, quote.updated_at,
    exists (select 1 from app_private.bid_trader_organization_access access where access.bid_id = quote.bid_id and access.trader_organization_id = quote.trader_organization_id),
    organization.status = 'active'::app_private.organization_status,
    exists (select 1 from app_private.bid_trader_organization_access access where access.bid_id = quote.bid_id and access.trader_organization_id = quote.trader_organization_id) and organization.status = 'active'::app_private.organization_status,
    bid.awarded_quote_id = quote.id
  )::app_private.quote_api_result
  from app_private.quotes quote join app_private.organizations organization on organization.id = quote.trader_organization_id
  join app_private.bids bid on bid.id = quote.bid_id where quote.id = p_quote_id;
$$;

create or replace function app_private.bid_snapshot(p_bid_id uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select jsonb_build_object('id', bid.id, 'vessel_voyage', bid.vessel_voyage, 'port_name', bid.port_name,
    'delivery_window', bid.delivery_window, 'deadline_at', bid.deadline_at, 'raw_status', bid.status::text,
    'effective_status', app_private.effective_bid_status(bid.status, bid.deadline_at), 'revision', bid.revision,
    'created_by', bid.created_by, 'responsible_buyer_user_id', bid.responsible_buyer_user_id,
    'fuel_items', coalesce((select jsonb_agg(jsonb_build_object('fuel_grade', item.fuel_grade, 'quantity_mt', item.quantity_mt) order by item.display_order) from app_private.bid_items item where item.bid_id = bid.id), '[]'::jsonb),
    'allowed_trader_organization_ids', coalesce((select jsonb_agg(access.trader_organization_id order by access.trader_organization_id) from app_private.bid_trader_organization_access access where access.bid_id = bid.id), '[]'::jsonb),
    'awarded_quote_id', bid.awarded_quote_id,
    'awarded_trader_organization_id', (select quote.trader_organization_id from app_private.quotes quote where quote.id = bid.awarded_quote_id),
    'awarded_trader_organization_label', (select organization.name from app_private.quotes quote join app_private.organizations organization on organization.id = quote.trader_organization_id where quote.id = bid.awarded_quote_id),
    'awarded_total_amount', case when bid.awarded_quote_id is null then null else (app_private.quote_snapshot(bid.awarded_quote_id) ->> 'total_amount')::numeric end,
    'awarded_at', bid.awarded_at, 'awarded_quote', case when bid.awarded_quote_id is null then null else app_private.quote_snapshot(bid.awarded_quote_id) end)
  from app_private.bids bid where bid.id = p_bid_id;
$$;

create or replace function app_private.bid_result(p_bid_id uuid)
returns app_private.bid_api_result language sql volatile security definer set search_path = '' as $$
  select row(bid.id, bid.vessel_voyage, bid.port_name, bid.delivery_window, bid.deadline_at, bid.status::text,
    app_private.effective_bid_status(bid.status, bid.deadline_at), bid.revision, bid.created_by,
    coalesce(nullif(btrim(creator_account.display_name), ''), nullif(split_part(creator.email, '@', 1), ''), bid.created_by::text),
    bid.responsible_buyer_user_id, coalesce(nullif(btrim(responsible_account.display_name), ''), nullif(split_part(responsible.email, '@', 1), ''), bid.responsible_buyer_user_id::text),
    coalesce((select jsonb_agg(jsonb_build_object('fuel_grade', item.fuel_grade, 'quantity_mt', item.quantity_mt) order by item.display_order) from app_private.bid_items item where item.bid_id = bid.id), '[]'::jsonb),
    bid.created_at, bid.updated_at, bid.closed_at, bid.cancelled_at, bid.awarded_quote_id, quote.trader_organization_id, organization.name,
    case when quote.id is null then null else quote.barge_fee + coalesce((select sum(item.unit_price * bid_item.quantity_mt) from app_private.quote_items item join app_private.bid_items bid_item on bid_item.bid_id = bid.id and bid_item.fuel_grade = item.fuel_grade where item.quote_id = quote.id), 0) end, bid.awarded_at
  )::app_private.bid_api_result
  from app_private.bids bid join auth.users creator on creator.id = bid.created_by join app_private.user_accounts creator_account on creator_account.user_id = creator.id
  join auth.users responsible on responsible.id = bid.responsible_buyer_user_id join app_private.user_accounts responsible_account on responsible_account.user_id = responsible.id
  left join app_private.quotes quote on quote.id = bid.awarded_quote_id left join app_private.organizations organization on organization.id = quote.trader_organization_id
  where bid.id = p_bid_id;
$$;

create or replace function public.update_bid(p_actor_membership_id uuid, p_bid_id uuid, p_expected_revision bigint, p_vessel_voyage text, p_port_name text, p_delivery_window text, p_deadline_at timestamptz, p_fuel_grades text[], p_quantities numeric[])
returns app_private.bid_api_result language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_bid app_private.bids%rowtype; v_before jsonb; v_result app_private.bid_api_result; v_has_quote boolean;
begin
  select * into v_actor from app_private.require_active_buyer_actor(p_actor_membership_id);
  select * into v_bid from app_private.bids where id = p_bid_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Bid not found'; end if;
  if p_expected_revision is null or v_bid.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'Bid revision conflict'; end if;
  if app_private.effective_bid_status(v_bid.status, v_bid.deadline_at) <> 'open' then raise exception using errcode = '55000', message = 'Bid details are editable only while effective-open'; end if;
  perform app_private.validate_bid_deadline(p_deadline_at); perform app_private.validate_bid_items(p_fuel_grades, p_quantities);
  select exists(select 1 from app_private.quotes quote where quote.bid_id = p_bid_id) into v_has_quote;
  if v_has_quote and (app_private.validate_bid_text(p_vessel_voyage, 'vessel_voyage') is distinct from v_bid.vessel_voyage or app_private.validate_bid_text(p_port_name, 'port_name') is distinct from v_bid.port_name or app_private.validate_bid_text(p_delivery_window, 'delivery_window') is distinct from v_bid.delivery_window
    or (select array_agg(grade order by grade) from unnest(p_fuel_grades) grade) is distinct from (select array_agg(item.fuel_grade order by item.fuel_grade) from app_private.bid_items item where item.bid_id = p_bid_id)
    or (select jsonb_agg(jsonb_build_object('fuel_grade', item.fuel_grade, 'quantity_mt', item.quantity_mt) order by item.display_order) from (select p_fuel_grades[i] fuel_grade, p_quantities[i] quantity_mt, i::smallint display_order from generate_subscripts(p_fuel_grades, 1) i) item) is distinct from (select jsonb_agg(jsonb_build_object('fuel_grade', item.fuel_grade, 'quantity_mt', item.quantity_mt) order by item.display_order) from app_private.bid_items item where item.bid_id = p_bid_id)) then
    raise exception using errcode = '55000', message = 'Commercial bid terms are immutable after the first quote';
  end if;
  if v_bid.vessel_voyage = app_private.validate_bid_text(p_vessel_voyage, 'vessel_voyage') and v_bid.port_name = app_private.validate_bid_text(p_port_name, 'port_name') and v_bid.delivery_window = app_private.validate_bid_text(p_delivery_window, 'delivery_window') and v_bid.deadline_at is not distinct from p_deadline_at
    and (select jsonb_agg(jsonb_build_object('fuel_grade', item.fuel_grade, 'quantity_mt', item.quantity_mt) order by item.display_order) from app_private.bid_items item where item.bid_id = p_bid_id) = (select jsonb_agg(jsonb_build_object('fuel_grade', p_fuel_grades[i], 'quantity_mt', p_quantities[i]) order by i) from generate_subscripts(p_fuel_grades, 1) i) then raise exception using errcode = '22023', message = 'Bid update makes no changes'; end if;
  v_before := app_private.bid_snapshot(p_bid_id);
  update app_private.bids set vessel_voyage=app_private.validate_bid_text(p_vessel_voyage,'vessel_voyage'), port_name=app_private.validate_bid_text(p_port_name,'port_name'), delivery_window=app_private.validate_bid_text(p_delivery_window,'delivery_window'), deadline_at=p_deadline_at, revision=revision+1 where id=p_bid_id;
  delete from app_private.bid_items where bid_id=p_bid_id;
  insert into app_private.bid_items (bid_id,fuel_grade,quantity_mt,display_order) select p_bid_id,p_fuel_grades[i],p_quantities[i],i::smallint from generate_subscripts(p_fuel_grades,1) i;
  perform app_private.append_bid_audit(p_bid_id,'details_updated',v_actor.user_id,v_actor.membership_id,v_actor.organization_id,v_actor.membership_role,v_bid.revision,v_bid.status,v_bid.responsible_buyer_user_id,v_before);
  select * into v_result from app_private.bid_result(p_bid_id); return v_result;
end;
$$;

create or replace function public.reassign_bid(p_actor_membership_id uuid, p_bid_id uuid, p_expected_revision bigint, p_responsible_buyer_user_id uuid)
returns app_private.bid_api_result language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_bid app_private.bids%rowtype; v_before jsonb; v_result app_private.bid_api_result;
begin
  select * into v_actor from app_private.require_active_buyer_actor(p_actor_membership_id); select * into v_bid from app_private.bids where id=p_bid_id for update;
  if not found then raise exception using errcode='P0002', message='Bid not found'; end if;
  if p_expected_revision is null or v_bid.revision <> p_expected_revision then raise exception using errcode='40001', message='Bid revision conflict'; end if;
  if v_bid.status in ('cancelled','awarded') then raise exception using errcode='55000', message='Cancelled or awarded bids cannot be reassigned'; end if;
  if p_responsible_buyer_user_id=v_bid.responsible_buyer_user_id then raise exception using errcode='22023', message='Bid is already assigned to that BUYER'; end if;
  perform app_private.require_active_buyer_target(p_responsible_buyer_user_id); v_before:=app_private.bid_snapshot(p_bid_id);
  update app_private.bids set responsible_buyer_user_id=p_responsible_buyer_user_id,revision=revision+1 where id=p_bid_id;
  perform app_private.append_bid_audit(p_bid_id,'responsible_buyer_changed',v_actor.user_id,v_actor.membership_id,v_actor.organization_id,v_actor.membership_role,v_bid.revision,v_bid.status,v_bid.responsible_buyer_user_id,v_before);
  select * into v_result from app_private.bid_result(p_bid_id); return v_result;
end;
$$;

create function public.list_active_trader_organizations(p_actor_membership_id uuid)
returns table (organization_id uuid, organization_label text) language plpgsql security definer set search_path = '' as $$
begin perform app_private.require_active_buyer_actor(p_actor_membership_id); return query select organization.id, organization.name from app_private.organizations organization where organization.kind='trader'::app_private.organization_kind and organization.status='active'::app_private.organization_status order by organization.name, organization.id; end;
$$;

create function public.list_bid_trader_access(p_actor_membership_id uuid, p_bid_id uuid default null)
returns table (bid_id uuid, trader_organization_id uuid, trader_organization_label text, granted_at timestamptz, granted_by_user_id uuid, granted_by_membership_id uuid) language plpgsql security definer set search_path = '' as $$
begin perform app_private.require_active_buyer_actor(p_actor_membership_id); return query select access.bid_id,access.trader_organization_id,organization.name,access.granted_at,access.granted_by_user_id,access.granted_by_membership_id from app_private.bid_trader_organization_access access join app_private.organizations organization on organization.id=access.trader_organization_id where p_bid_id is null or access.bid_id=p_bid_id order by access.bid_id,organization.name,organization.id; end;
$$;

create function public.grant_bid_trader_access(p_actor_membership_id uuid, p_bid_id uuid, p_expected_revision bigint, p_trader_organization_id uuid)
returns app_private.bid_api_result language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_bid app_private.bids%rowtype; v_before jsonb; v_result app_private.bid_api_result;
begin
  select * into v_actor from app_private.require_active_buyer_actor(p_actor_membership_id); select * into v_bid from app_private.bids where id=p_bid_id for update;
  if not found then raise exception using errcode='P0002',message='Bid not found'; end if; if p_expected_revision is null or v_bid.revision<>p_expected_revision then raise exception using errcode='40001',message='Bid revision conflict'; end if;
  if app_private.effective_bid_status(v_bid.status,v_bid.deadline_at)<>'open' then raise exception using errcode='55000',message='TRADER scope can be granted only while effective-open'; end if;
  perform app_private.require_active_trader_organization(p_trader_organization_id);
  if exists(select 1 from app_private.bid_trader_organization_access access where access.bid_id=p_bid_id and access.trader_organization_id=p_trader_organization_id) then raise exception using errcode='23505',message='TRADER organization already has bid access'; end if;
  v_before:=app_private.bid_snapshot(p_bid_id); insert into app_private.bid_trader_organization_access(bid_id,trader_organization_id,granted_by_user_id,granted_by_membership_id) values(p_bid_id,p_trader_organization_id,v_actor.user_id,v_actor.membership_id);
  update app_private.bids set revision=revision+1 where id=p_bid_id; perform app_private.append_bid_audit(p_bid_id,'trader_access_granted',v_actor.user_id,v_actor.membership_id,v_actor.organization_id,v_actor.membership_role,v_bid.revision,v_bid.status,v_bid.responsible_buyer_user_id,v_before);
  select * into v_result from app_private.bid_result(p_bid_id); return v_result;
end;
$$;

create function public.revoke_bid_trader_access(p_actor_membership_id uuid, p_bid_id uuid, p_expected_revision bigint, p_trader_organization_id uuid)
returns app_private.bid_api_result language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_bid app_private.bids%rowtype; v_before jsonb; v_result app_private.bid_api_result;
begin
  select * into v_actor from app_private.require_active_buyer_actor(p_actor_membership_id); select * into v_bid from app_private.bids where id=p_bid_id for update;
  if not found then raise exception using errcode='P0002',message='Bid not found'; end if; if p_expected_revision is null or v_bid.revision<>p_expected_revision then raise exception using errcode='40001',message='Bid revision conflict'; end if;
  if not exists(select 1 from app_private.bid_trader_organization_access access where access.bid_id=p_bid_id and access.trader_organization_id=p_trader_organization_id) then raise exception using errcode='P0002',message='TRADER bid access not found'; end if;
  v_before:=app_private.bid_snapshot(p_bid_id); delete from app_private.bid_trader_organization_access where bid_id=p_bid_id and trader_organization_id=p_trader_organization_id; update app_private.bids set revision=revision+1 where id=p_bid_id;
  perform app_private.append_bid_audit(p_bid_id,'trader_access_revoked',v_actor.user_id,v_actor.membership_id,v_actor.organization_id,v_actor.membership_role,v_bid.revision,v_bid.status,v_bid.responsible_buyer_user_id,v_before); select * into v_result from app_private.bid_result(p_bid_id); return v_result;
end;
$$;

create function public.list_trader_bids(p_actor_membership_id uuid)
returns table (id uuid,vessel_voyage text,port_name text,delivery_window text,deadline_at timestamptz,raw_status text,effective_status text,revision bigint,fuel_items jsonb,created_at timestamptz,updated_at timestamptz,closed_at timestamptz,cancelled_at timestamptz) language plpgsql security definer set search_path = '' as $$
declare v_actor record;
begin select * into v_actor from app_private.require_active_trader_actor(p_actor_membership_id); return query select bid.id,bid.vessel_voyage,bid.port_name,bid.delivery_window,bid.deadline_at,bid.status::text,app_private.effective_bid_status(bid.status,bid.deadline_at),bid.revision,coalesce((select jsonb_agg(jsonb_build_object('fuel_grade',item.fuel_grade,'quantity_mt',item.quantity_mt) order by item.display_order) from app_private.bid_items item where item.bid_id=bid.id),'[]'::jsonb),bid.created_at,bid.updated_at,bid.closed_at,bid.cancelled_at from app_private.bids bid join app_private.bid_trader_organization_access access on access.bid_id=bid.id and access.trader_organization_id=v_actor.organization_id order by bid.created_at desc,bid.id; end;
$$;

create function public.list_my_quotes(p_actor_membership_id uuid)
returns setof app_private.quote_api_result language plpgsql security definer set search_path = '' as $$
declare v_actor record;
begin select * into v_actor from app_private.require_active_trader_actor(p_actor_membership_id); return query select result.* from app_private.quotes quote join app_private.bid_trader_organization_access access on access.bid_id=quote.bid_id and access.trader_organization_id=v_actor.organization_id cross join lateral app_private.quote_result(quote.id) result where quote.trader_organization_id=v_actor.organization_id order by quote.created_at,quote.id; end;
$$;

create function public.list_quotes_for_buyers(p_actor_membership_id uuid, p_bid_id uuid default null)
returns setof app_private.quote_api_result language plpgsql security definer set search_path = '' as $$
begin perform app_private.require_active_buyer_actor(p_actor_membership_id); return query select result.* from app_private.quotes quote cross join lateral app_private.quote_result(quote.id) result where p_bid_id is null or quote.bid_id=p_bid_id order by quote.created_at,quote.id; end;
$$;

create function app_private.append_quote_audit(p_quote_id uuid, p_event_type text, p_actor_user_id uuid, p_actor_membership_id uuid, p_actor_organization_id uuid, p_actor_role app_private.membership_role, p_prior_revision bigint, p_before_snapshot jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_quote app_private.quotes%rowtype;
begin select * into v_quote from app_private.quotes where id=p_quote_id; insert into app_private.quote_audit_events(quote_id,bid_id,trader_organization_id,event_type,actor_user_id,actor_membership_id,actor_organization_id,actor_role,prior_revision,resulting_revision,before_snapshot,after_snapshot) values(p_quote_id,v_quote.bid_id,v_quote.trader_organization_id,p_event_type,p_actor_user_id,p_actor_membership_id,p_actor_organization_id,p_actor_role,p_prior_revision,v_quote.revision,p_before_snapshot,app_private.quote_snapshot(p_quote_id)); end;
$$;

create function public.create_quote(p_actor_membership_id uuid,p_bid_id uuid,p_fuel_grades text[],p_unit_prices numeric[],p_barge_fee numeric)
returns app_private.quote_api_result language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_bid app_private.bids%rowtype; v_quote_id uuid; v_result app_private.quote_api_result;
begin
  select * into v_actor from app_private.require_active_trader_actor(p_actor_membership_id); select * into v_bid from app_private.bids where id=p_bid_id for update;
  if not found then raise exception using errcode='P0002',message='Bid not found'; end if;
  if not exists(select 1 from app_private.bid_trader_organization_access access where access.bid_id=p_bid_id and access.trader_organization_id=v_actor.organization_id) then raise exception using errcode='42501',message='Current TRADER bid access is required'; end if;
  if app_private.effective_bid_status(v_bid.status,v_bid.deadline_at)<>'open' then raise exception using errcode='55000',message='Quotes are editable only while effective-open'; end if;
  if exists(select 1 from app_private.quotes quote where quote.bid_id=p_bid_id and quote.trader_organization_id=v_actor.organization_id) then raise exception using errcode='23505',message='Organization already has a quote for this bid'; end if;
  perform app_private.validate_quote_values(p_bid_id,p_fuel_grades,p_unit_prices,p_barge_fee);
  insert into app_private.quotes(bid_id,trader_organization_id,created_by,barge_fee) values(p_bid_id,v_actor.organization_id,v_actor.user_id,p_barge_fee) returning id into v_quote_id;
  insert into app_private.quote_items(quote_id,fuel_grade,unit_price,display_order) select v_quote_id,bid_item.fuel_grade,p_unit_prices[array_position(p_fuel_grades,bid_item.fuel_grade)],bid_item.display_order from app_private.bid_items bid_item where bid_item.bid_id=p_bid_id order by bid_item.display_order;
  perform app_private.append_quote_audit(v_quote_id,'created',v_actor.user_id,v_actor.membership_id,v_actor.organization_id,v_actor.membership_role,null,null); select * into v_result from app_private.quote_result(v_quote_id); return v_result;
end;
$$;

create function public.update_quote(p_actor_membership_id uuid,p_quote_id uuid,p_expected_revision bigint,p_fuel_grades text[],p_unit_prices numeric[],p_barge_fee numeric)
returns app_private.quote_api_result language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_bid app_private.bids%rowtype; v_quote app_private.quotes%rowtype; v_before jsonb; v_result app_private.quote_api_result;
begin
  select * into v_actor from app_private.require_active_trader_actor(p_actor_membership_id);
  select bid.* into v_bid from app_private.bids bid join app_private.quotes quote on quote.bid_id=bid.id where quote.id=p_quote_id for update of bid;
  if not found then raise exception using errcode='P0002',message='Quote not found'; end if;
  if not exists(select 1 from app_private.bid_trader_organization_access access where access.bid_id=v_bid.id and access.trader_organization_id=v_actor.organization_id) then raise exception using errcode='42501',message='Current TRADER bid access is required'; end if;
  if app_private.effective_bid_status(v_bid.status,v_bid.deadline_at)<>'open' then raise exception using errcode='55000',message='Quotes are editable only while effective-open'; end if;
  select * into v_quote from app_private.quotes where id=p_quote_id for update;
  if v_quote.trader_organization_id<>v_actor.organization_id then raise exception using errcode='42501',message='Quote belongs to another TRADER organization'; end if;
  if p_expected_revision is null or v_quote.revision<>p_expected_revision then raise exception using errcode='40001',message='Quote revision conflict'; end if;
  perform app_private.validate_quote_values(v_bid.id,p_fuel_grades,p_unit_prices,p_barge_fee);
  if v_quote.barge_fee=p_barge_fee and (select jsonb_agg(jsonb_build_object('fuel_grade',item.fuel_grade,'unit_price',item.unit_price) order by item.display_order) from app_private.quote_items item where item.quote_id=p_quote_id) = (select jsonb_agg(jsonb_build_object('fuel_grade',p_fuel_grades[i],'unit_price',p_unit_prices[i]) order by i) from generate_subscripts(p_fuel_grades,1) i) then raise exception using errcode='22023',message='Quote update makes no changes'; end if;
  v_before:=app_private.quote_snapshot(p_quote_id); update app_private.quotes set barge_fee=p_barge_fee,revision=revision+1 where id=p_quote_id; delete from app_private.quote_items where quote_id=p_quote_id;
  insert into app_private.quote_items(quote_id,fuel_grade,unit_price,display_order) select p_quote_id,bid_item.fuel_grade,p_unit_prices[array_position(p_fuel_grades,bid_item.fuel_grade)],bid_item.display_order from app_private.bid_items bid_item where bid_item.bid_id=v_bid.id order by bid_item.display_order;
  perform app_private.append_quote_audit(p_quote_id,'updated',v_actor.user_id,v_actor.membership_id,v_actor.organization_id,v_actor.membership_role,v_quote.revision,v_before); select * into v_result from app_private.quote_result(p_quote_id); return v_result;
end;
$$;

create function public.award_bid(p_actor_membership_id uuid,p_bid_id uuid,p_expected_revision bigint,p_quote_id uuid,p_expected_quote_revision bigint)
returns app_private.bid_api_result language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_bid app_private.bids%rowtype; v_quote app_private.quotes%rowtype; v_before jsonb; v_result app_private.bid_api_result;
begin
  select * into v_actor from app_private.require_active_buyer_actor(p_actor_membership_id); select * into v_bid from app_private.bids where id=p_bid_id for update;
  if not found then raise exception using errcode='P0002',message='Bid not found'; end if; if p_expected_revision is null or v_bid.revision<>p_expected_revision then raise exception using errcode='40001',message='Bid revision conflict'; end if;
  if v_bid.status in ('cancelled','awarded') then raise exception using errcode='55000',message='Cancelled or awarded bids cannot be awarded'; end if;
  if app_private.effective_bid_status(v_bid.status,v_bid.deadline_at)<>'closed' then raise exception using errcode='55000',message='Bid must be effective-closed before award'; end if;
  select * into v_quote from app_private.quotes where id=p_quote_id for update; if not found or v_quote.bid_id<>p_bid_id then raise exception using errcode='22023',message='Quote does not belong to bid'; end if;
  if p_expected_quote_revision is null or v_quote.revision<>p_expected_quote_revision then raise exception using errcode='40001',message='Quote revision conflict'; end if;
  if not exists(select 1 from app_private.bid_trader_organization_access access where access.bid_id=p_bid_id and access.trader_organization_id=v_quote.trader_organization_id) then raise exception using errcode='55000',message='Quote TRADER access is no longer active'; end if;
  perform app_private.require_active_trader_organization(v_quote.trader_organization_id); v_before:=app_private.bid_snapshot(p_bid_id);
  update app_private.bids set status='awarded',awarded_quote_id=p_quote_id,awarded_at=clock_timestamp(),closed_at=coalesce(v_bid.closed_at,clock_timestamp()),revision=revision+1 where id=p_bid_id;
  perform app_private.append_bid_audit(p_bid_id,'awarded',v_actor.user_id,v_actor.membership_id,v_actor.organization_id,v_actor.membership_role,v_bid.revision,v_bid.status,v_bid.responsible_buyer_user_id,v_before); select * into v_result from app_private.bid_result(p_bid_id); return v_result;
end;
$$;

revoke all on function app_private.reject_quote_identity_change(), app_private.require_active_trader_actor(uuid), app_private.require_active_trader_organization(uuid), app_private.require_trader_bid_access(uuid,uuid), app_private.validate_quote_values(uuid,text[],numeric[],numeric), app_private.quote_snapshot(uuid), app_private.quote_result(uuid), app_private.append_quote_audit(uuid,text,uuid,uuid,uuid,app_private.membership_role,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.list_active_trader_organizations(uuid), public.list_bid_trader_access(uuid,uuid), public.grant_bid_trader_access(uuid,uuid,bigint,uuid), public.revoke_bid_trader_access(uuid,uuid,bigint,uuid), public.list_trader_bids(uuid), public.list_my_quotes(uuid), public.list_quotes_for_buyers(uuid,uuid), public.create_quote(uuid,uuid,text[],numeric[],numeric), public.update_quote(uuid,uuid,bigint,text[],numeric[],numeric), public.award_bid(uuid,uuid,bigint,uuid,bigint) from public, anon;
grant execute on function public.list_active_trader_organizations(uuid), public.list_bid_trader_access(uuid,uuid), public.grant_bid_trader_access(uuid,uuid,bigint,uuid), public.revoke_bid_trader_access(uuid,uuid,bigint,uuid), public.list_trader_bids(uuid), public.list_my_quotes(uuid), public.list_quotes_for_buyers(uuid,uuid), public.create_quote(uuid,uuid,text[],numeric[],numeric), public.update_quote(uuid,uuid,bigint,text[],numeric[],numeric), public.award_bid(uuid,uuid,bigint,uuid,bigint) to authenticated;
