-- Server-authoritative BUYER bid lifecycle, responsibility, and audit history.
-- Creation events use a null before_snapshot; every other event has locked before/after snapshots.

alter table app_private.user_accounts
  add column display_name text null,
  add constraint user_accounts_display_name_not_blank check (display_name is null or btrim(display_name) <> '');

create type app_private.bid_status as enum ('open', 'closed', 'cancelled');
create type app_private.bid_audit_event_type as enum (
  'created', 'details_updated', 'responsible_buyer_changed', 'closed', 'reopened', 'cancelled'
);

create type app_private.bid_api_result as (
  id uuid,
  vessel_voyage text,
  port_name text,
  delivery_window text,
  deadline_at timestamptz,
  raw_status text,
  effective_status text,
  revision bigint,
  created_by uuid,
  created_by_label text,
  responsible_buyer_user_id uuid,
  responsible_buyer_label text,
  fuel_items jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  closed_at timestamptz,
  cancelled_at timestamptz
);

create table app_private.bids (
  id uuid primary key default gen_random_uuid(),
  vessel_voyage text not null check (btrim(vessel_voyage) <> ''),
  port_name text not null check (btrim(port_name) <> ''),
  delivery_window text not null check (btrim(delivery_window) <> ''),
  deadline_at timestamptz null,
  status app_private.bid_status not null default 'open',
  revision bigint not null default 1 check (revision >= 1),
  created_by uuid not null references auth.users (id) on delete restrict,
  responsible_buyer_user_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz null,
  cancelled_at timestamptz null,
  constraint bids_status_timestamp_consistency check (
    (status = 'open'::app_private.bid_status and closed_at is null and cancelled_at is null)
    or (status = 'closed'::app_private.bid_status and closed_at is not null and cancelled_at is null)
    or (status = 'cancelled'::app_private.bid_status and cancelled_at is not null)
  )
);

create table app_private.bid_items (
  bid_id uuid not null references app_private.bids (id) on delete restrict,
  fuel_grade text not null check (fuel_grade in ('vlsfo', 'hsfo', 'ulsfo', 'lsfo', 'lsmgo')),
  quantity_mt numeric not null check (quantity_mt > 0),
  display_order smallint not null check (display_order between 1 and 5),
  primary key (bid_id, fuel_grade),
  unique (bid_id, display_order)
);

create table app_private.bid_audit_events (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references app_private.bids (id) on delete restrict,
  event_type app_private.bid_audit_event_type not null,
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  actor_membership_id uuid not null references app_private.organization_memberships (id) on delete restrict,
  actor_organization_id uuid not null references app_private.organizations (id) on delete restrict,
  actor_role app_private.membership_role not null,
  occurred_at timestamptz not null default clock_timestamp(),
  prior_revision bigint null,
  resulting_revision bigint not null check (resulting_revision >= 1),
  prior_status app_private.bid_status null,
  resulting_status app_private.bid_status not null,
  prior_responsible_buyer_user_id uuid null references auth.users (id) on delete restrict,
  resulting_responsible_buyer_user_id uuid not null references auth.users (id) on delete restrict,
  before_snapshot jsonb null,
  after_snapshot jsonb not null,
  constraint bid_audit_revision_consistency check (
    (event_type = 'created'::app_private.bid_audit_event_type and prior_revision is null and before_snapshot is null)
    or (event_type <> 'created'::app_private.bid_audit_event_type and prior_revision is not null and before_snapshot is not null)
  ),
  constraint bid_audit_revision_step check (
    (event_type = 'created'::app_private.bid_audit_event_type and resulting_revision = 1)
    or (event_type <> 'created'::app_private.bid_audit_event_type and resulting_revision = prior_revision + 1)
  ),
  unique (bid_id, resulting_revision)
);

create index bids_created_by_idx on app_private.bids (created_by);
create index bids_responsible_buyer_idx on app_private.bids (responsible_buyer_user_id);

create function app_private.reject_bid_creator_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception using errcode = '42501', message = 'Bid creator is immutable';
  end if;
  return new;
end;
$$;

create trigger reject_bid_creator_change
before update of created_by on app_private.bids
for each row execute function app_private.reject_bid_creator_change();

create trigger set_bids_updated_at
before update on app_private.bids
for each row execute function app_private.set_updated_at();

alter table app_private.bids enable row level security;
alter table app_private.bid_items enable row level security;
alter table app_private.bid_audit_events enable row level security;

revoke all on table app_private.bids, app_private.bid_items, app_private.bid_audit_events from public, anon, authenticated;

create function app_private.require_active_buyer_actor(p_actor_membership_id uuid)
returns table (user_id uuid, membership_id uuid, organization_id uuid, membership_role app_private.membership_role)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'An active BUYER membership is required';
  end if;

  return query
  select account.user_id, membership.id, organization.id, membership.role
  from app_private.user_accounts as account
  join app_private.organization_memberships as membership on membership.user_id = account.user_id
  join app_private.organizations as organization on organization.id = membership.organization_id
  where membership.id = p_actor_membership_id
    and account.user_id = auth.uid()
    and account.status = 'active'::app_private.account_status
    and membership.status = 'active'::app_private.membership_status
    and organization.status = 'active'::app_private.organization_status
    and organization.kind = 'buyer'::app_private.organization_kind
    and membership.role in ('buyer_admin'::app_private.membership_role, 'buyer_operator'::app_private.membership_role);

  if not found then
    raise exception using errcode = '42501', message = 'An active BUYER membership is required';
  end if;
end;
$$;

create function app_private.require_active_buyer_target(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from app_private.user_accounts as account
    join app_private.organization_memberships as membership on membership.user_id = account.user_id
    join app_private.organizations as organization on organization.id = membership.organization_id
    where account.user_id = p_user_id
      and account.status = 'active'::app_private.account_status
      and membership.status = 'active'::app_private.membership_status
      and organization.status = 'active'::app_private.organization_status
      and organization.kind = 'buyer'::app_private.organization_kind
      and membership.role in ('buyer_admin'::app_private.membership_role, 'buyer_operator'::app_private.membership_role)
  ) then
    raise exception using errcode = '22023', message = 'Responsible BUYER must have an active BUYER membership';
  end if;
end;
$$;

create function app_private.validate_bid_text(p_value text, p_field text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_value text := nullif(btrim(p_value), '');
begin
  if v_value is null then
    raise exception using errcode = '22023', message = p_field || ' is required';
  end if;
  return v_value;
end;
$$;

create function app_private.validate_bid_deadline(p_deadline_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_deadline_at is not null and p_deadline_at <= clock_timestamp() then
    raise exception using errcode = '22023', message = 'Deadline must be strictly in the future';
  end if;
end;
$$;

create function app_private.validate_bid_items(p_fuel_grades text[], p_quantities numeric[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_index integer;
  v_grade text;
  v_quantity numeric;
begin
  if p_fuel_grades is null or p_quantities is null
     or cardinality(p_fuel_grades) is null or cardinality(p_quantities) is null
     or cardinality(p_fuel_grades) <> cardinality(p_quantities)
     or cardinality(p_fuel_grades) not between 1 and 5 then
    raise exception using errcode = '22023', message = 'Fuel grades and quantities must be non-empty equal-length arrays';
  end if;

  for v_index in 1..cardinality(p_fuel_grades) loop
    v_grade := p_fuel_grades[v_index];
    v_quantity := p_quantities[v_index];
    if v_grade is null or v_grade not in ('vlsfo', 'hsfo', 'ulsfo', 'lsfo', 'lsmgo') then
      raise exception using errcode = '22023', message = 'Unsupported fuel grade';
    end if;
    if v_quantity is null or v_quantity::text in ('NaN', 'Infinity', '-Infinity') or v_quantity <= 0 then
      raise exception using errcode = '22023', message = 'Fuel quantity must be finite and greater than zero';
    end if;
  end loop;

  if (select count(distinct grade) from unnest(p_fuel_grades) as grade) <> cardinality(p_fuel_grades) then
    raise exception using errcode = '22023', message = 'Fuel grades must be unique';
  end if;
end;
$$;

create function app_private.effective_bid_status(p_status app_private.bid_status, p_deadline_at timestamptz)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select case
    when p_status = 'closed'::app_private.bid_status then 'closed'
    when p_status = 'cancelled'::app_private.bid_status then 'cancelled'
    when p_deadline_at is not null and p_deadline_at <= clock_timestamp() then 'closed'
    else 'open'
  end;
$$;

create function app_private.bid_snapshot(p_bid_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', bid.id,
    'vessel_voyage', bid.vessel_voyage,
    'port_name', bid.port_name,
    'delivery_window', bid.delivery_window,
    'deadline_at', bid.deadline_at,
    'raw_status', bid.status::text,
    'effective_status', app_private.effective_bid_status(bid.status, bid.deadline_at),
    'revision', bid.revision,
    'created_by', bid.created_by,
    'responsible_buyer_user_id', bid.responsible_buyer_user_id,
    'fuel_items', coalesce(items.fuel_items, '[]'::jsonb)
  )
  from app_private.bids as bid
  left join lateral (
    select jsonb_agg(jsonb_build_object('fuel_grade', item.fuel_grade, 'quantity_mt', item.quantity_mt) order by item.display_order) as fuel_items
    from app_private.bid_items as item
    where item.bid_id = bid.id
  ) as items on true
  where bid.id = p_bid_id;
$$;

create function app_private.bid_result(p_bid_id uuid)
returns app_private.bid_api_result
language sql
volatile
security definer
set search_path = ''
as $$
  select row(
    bid.id, bid.vessel_voyage, bid.port_name, bid.delivery_window, bid.deadline_at,
    bid.status::text, app_private.effective_bid_status(bid.status, bid.deadline_at), bid.revision,
    bid.created_by,
    coalesce(nullif(btrim(creator_account.display_name), ''), nullif(split_part(creator.email, '@', 1), ''), bid.created_by::text),
    bid.responsible_buyer_user_id,
    coalesce(nullif(btrim(responsible_account.display_name), ''), nullif(split_part(responsible.email, '@', 1), ''), bid.responsible_buyer_user_id::text),
    coalesce(items.fuel_items, '[]'::jsonb), bid.created_at, bid.updated_at, bid.closed_at, bid.cancelled_at
  )::app_private.bid_api_result
  from app_private.bids as bid
  join auth.users as creator on creator.id = bid.created_by
  join app_private.user_accounts as creator_account on creator_account.user_id = creator.id
  join auth.users as responsible on responsible.id = bid.responsible_buyer_user_id
  join app_private.user_accounts as responsible_account on responsible_account.user_id = responsible.id
  left join lateral (
    select jsonb_agg(jsonb_build_object('fuel_grade', item.fuel_grade, 'quantity_mt', item.quantity_mt) order by item.display_order) as fuel_items
    from app_private.bid_items as item where item.bid_id = bid.id
  ) as items on true
  where bid.id = p_bid_id;
$$;

create function app_private.append_bid_audit(
  p_bid_id uuid, p_event_type app_private.bid_audit_event_type,
  p_actor_user_id uuid, p_actor_membership_id uuid, p_actor_organization_id uuid, p_actor_role app_private.membership_role,
  p_prior_revision bigint, p_prior_status app_private.bid_status, p_prior_responsible_buyer_user_id uuid, p_before_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_bid app_private.bids%rowtype;
begin
  select * into v_bid from app_private.bids where id = p_bid_id;
  insert into app_private.bid_audit_events (
    bid_id, event_type, actor_user_id, actor_membership_id, actor_organization_id, actor_role,
    prior_revision, resulting_revision, prior_status, resulting_status,
    prior_responsible_buyer_user_id, resulting_responsible_buyer_user_id, before_snapshot, after_snapshot
  ) values (
    p_bid_id, p_event_type, p_actor_user_id, p_actor_membership_id, p_actor_organization_id, p_actor_role,
    p_prior_revision, v_bid.revision, p_prior_status, v_bid.status,
    p_prior_responsible_buyer_user_id, v_bid.responsible_buyer_user_id, p_before_snapshot, app_private.bid_snapshot(p_bid_id)
  );
end;
$$;

create function public.list_active_buyers(p_actor_membership_id uuid)
returns table (user_id uuid, display_label text, active_buyer_membership_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_active_buyer_actor(p_actor_membership_id);
  return query
  select account.user_id,
    coalesce(nullif(btrim(account.display_name), ''), nullif(split_part(auth_user.email, '@', 1), ''), account.user_id::text),
    count(membership.id)::bigint
  from app_private.user_accounts as account
  join auth.users as auth_user on auth_user.id = account.user_id
  join app_private.organization_memberships as membership on membership.user_id = account.user_id
  join app_private.organizations as organization on organization.id = membership.organization_id
  where account.status = 'active'::app_private.account_status
    and membership.status = 'active'::app_private.membership_status
    and organization.status = 'active'::app_private.organization_status
    and organization.kind = 'buyer'::app_private.organization_kind
    and membership.role in ('buyer_admin'::app_private.membership_role, 'buyer_operator'::app_private.membership_role)
  group by account.user_id, account.display_name, auth_user.email
  order by display_label, account.user_id;
end;
$$;

create function public.list_bids(p_actor_membership_id uuid, p_view text default 'all', p_responsible_buyer_user_id uuid default null)
returns setof app_private.bid_api_result
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_active_buyer_actor(p_actor_membership_id);
  if p_view not in ('all', 'created_by_me', 'responsible_buyer') then
    raise exception using errcode = '22023', message = 'Unknown bid view';
  end if;
  if p_view = 'responsible_buyer' and p_responsible_buyer_user_id is null then
    raise exception using errcode = '22023', message = 'responsible_buyer view requires a target user';
  end if;
  return query
  select result.*
  from app_private.bids as bid
  cross join lateral app_private.bid_result(bid.id) as result
  where p_view = 'all'
     or (p_view = 'created_by_me' and bid.created_by = auth.uid())
     or (p_view = 'responsible_buyer' and bid.responsible_buyer_user_id = p_responsible_buyer_user_id)
  order by bid.created_at desc, bid.id;
end;
$$;

create function public.list_bid_audit(p_actor_membership_id uuid, p_bid_id uuid default null)
returns table (
  id uuid, bid_id uuid, event_type text, actor_user_id uuid, actor_membership_id uuid, actor_organization_id uuid,
  actor_role text, occurred_at timestamptz, prior_revision bigint, resulting_revision bigint,
  prior_status text, resulting_status text, prior_responsible_buyer_user_id uuid,
  resulting_responsible_buyer_user_id uuid, before_snapshot jsonb, after_snapshot jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_active_buyer_actor(p_actor_membership_id);
  return query
  select event.id, event.bid_id, event.event_type::text, event.actor_user_id, event.actor_membership_id,
    event.actor_organization_id, event.actor_role::text, event.occurred_at, event.prior_revision,
    event.resulting_revision, event.prior_status::text, event.resulting_status::text,
    event.prior_responsible_buyer_user_id, event.resulting_responsible_buyer_user_id,
    event.before_snapshot, event.after_snapshot
  from app_private.bid_audit_events as event
  where p_bid_id is null or event.bid_id = p_bid_id
  order by event.occurred_at, event.id;
end;
$$;

create function public.create_bid(
  p_actor_membership_id uuid, p_vessel_voyage text, p_port_name text, p_delivery_window text,
  p_deadline_at timestamptz, p_responsible_buyer_user_id uuid default null,
  p_fuel_grades text[] default null, p_quantities numeric[] default null
)
returns app_private.bid_api_result
language plpgsql
security definer
set search_path = ''
as $$
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
  perform app_private.append_bid_audit(v_bid_id, 'created', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, null, null, null, null);
  select result.* into v_result from app_private.bid_result(v_bid_id) as result;
  return v_result;
end;
$$;

create function public.update_bid(
  p_actor_membership_id uuid, p_bid_id uuid, p_expected_revision bigint,
  p_vessel_voyage text, p_port_name text, p_delivery_window text, p_deadline_at timestamptz,
  p_fuel_grades text[], p_quantities numeric[]
)
returns app_private.bid_api_result
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor record; v_bid app_private.bids%rowtype; v_before jsonb; v_result app_private.bid_api_result;
begin
  select * into v_actor from app_private.require_active_buyer_actor(p_actor_membership_id);
  select * into v_bid from app_private.bids where id = p_bid_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Bid not found'; end if;
  if p_expected_revision is null or v_bid.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'Bid revision conflict'; end if;
  if app_private.effective_bid_status(v_bid.status, v_bid.deadline_at) <> 'open' then raise exception using errcode = '55000', message = 'Bid details are editable only while effective-open'; end if;
  perform app_private.validate_bid_deadline(p_deadline_at);
  perform app_private.validate_bid_items(p_fuel_grades, p_quantities);
  v_before := app_private.bid_snapshot(p_bid_id);
  update app_private.bids set vessel_voyage = app_private.validate_bid_text(p_vessel_voyage, 'vessel_voyage'), port_name = app_private.validate_bid_text(p_port_name, 'port_name'), delivery_window = app_private.validate_bid_text(p_delivery_window, 'delivery_window'), deadline_at = p_deadline_at, revision = revision + 1 where id = p_bid_id;
  delete from app_private.bid_items where bid_id = p_bid_id;
  insert into app_private.bid_items (bid_id, fuel_grade, quantity_mt, display_order)
  select p_bid_id, grades.grade, p_quantities[grades.ordinality], grades.ordinality::smallint from unnest(p_fuel_grades) with ordinality as grades(grade, ordinality);
  perform app_private.append_bid_audit(p_bid_id, 'details_updated', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, v_bid.revision, v_bid.status, v_bid.responsible_buyer_user_id, v_before);
  select result.* into v_result from app_private.bid_result(p_bid_id) as result; return v_result;
end;
$$;

create function public.reassign_bid(p_actor_membership_id uuid, p_bid_id uuid, p_expected_revision bigint, p_responsible_buyer_user_id uuid)
returns app_private.bid_api_result
language plpgsql security definer set search_path = ''
as $$
declare v_actor record; v_bid app_private.bids%rowtype; v_before jsonb; v_result app_private.bid_api_result;
begin
  select * into v_actor from app_private.require_active_buyer_actor(p_actor_membership_id);
  select * into v_bid from app_private.bids where id = p_bid_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Bid not found'; end if;
  if p_expected_revision is null or v_bid.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'Bid revision conflict'; end if;
  if v_bid.status = 'cancelled' then raise exception using errcode = '55000', message = 'Cancelled bids cannot be reassigned'; end if;
  if p_responsible_buyer_user_id = v_bid.responsible_buyer_user_id then raise exception using errcode = '22023', message = 'Bid is already assigned to that BUYER'; end if;
  perform app_private.require_active_buyer_target(p_responsible_buyer_user_id);
  v_before := app_private.bid_snapshot(p_bid_id);
  update app_private.bids set responsible_buyer_user_id = p_responsible_buyer_user_id, revision = revision + 1 where id = p_bid_id;
  perform app_private.append_bid_audit(p_bid_id, 'responsible_buyer_changed', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, v_bid.revision, v_bid.status, v_bid.responsible_buyer_user_id, v_before);
  select result.* into v_result from app_private.bid_result(p_bid_id) as result; return v_result;
end;
$$;

create function public.close_bid(p_actor_membership_id uuid, p_bid_id uuid, p_expected_revision bigint)
returns app_private.bid_api_result
language plpgsql security definer set search_path = ''
as $$
declare v_actor record; v_bid app_private.bids%rowtype; v_before jsonb; v_result app_private.bid_api_result;
begin
  select * into v_actor from app_private.require_active_buyer_actor(p_actor_membership_id);
  select * into v_bid from app_private.bids where id = p_bid_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Bid not found'; end if;
  if p_expected_revision is null or v_bid.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'Bid revision conflict'; end if;
  if v_bid.status <> 'open' then raise exception using errcode = '55000', message = 'Only raw open bids can be closed'; end if;
  v_before := app_private.bid_snapshot(p_bid_id);
  update app_private.bids set status = 'closed', closed_at = clock_timestamp(), revision = revision + 1 where id = p_bid_id;
  perform app_private.append_bid_audit(p_bid_id, 'closed', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, v_bid.revision, v_bid.status, v_bid.responsible_buyer_user_id, v_before);
  select result.* into v_result from app_private.bid_result(p_bid_id) as result; return v_result;
end;
$$;

create function public.reopen_bid(p_actor_membership_id uuid, p_bid_id uuid, p_expected_revision bigint, p_deadline_at timestamptz)
returns app_private.bid_api_result
language plpgsql security definer set search_path = ''
as $$
declare v_actor record; v_bid app_private.bids%rowtype; v_before jsonb; v_result app_private.bid_api_result;
begin
  select * into v_actor from app_private.require_active_buyer_actor(p_actor_membership_id);
  select * into v_bid from app_private.bids where id = p_bid_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Bid not found'; end if;
  if p_expected_revision is null or v_bid.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'Bid revision conflict'; end if;
  if not (v_bid.status = 'closed' or (v_bid.status = 'open' and v_bid.deadline_at is not null and v_bid.deadline_at <= clock_timestamp())) then raise exception using errcode = '55000', message = 'Only closed or expired raw open bids can be reopened'; end if;
  perform app_private.validate_bid_deadline(p_deadline_at);
  v_before := app_private.bid_snapshot(p_bid_id);
  update app_private.bids set status = 'open', deadline_at = p_deadline_at, closed_at = null, revision = revision + 1 where id = p_bid_id;
  perform app_private.append_bid_audit(p_bid_id, 'reopened', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, v_bid.revision, v_bid.status, v_bid.responsible_buyer_user_id, v_before);
  select result.* into v_result from app_private.bid_result(p_bid_id) as result; return v_result;
end;
$$;

create function public.cancel_bid(p_actor_membership_id uuid, p_bid_id uuid, p_expected_revision bigint)
returns app_private.bid_api_result
language plpgsql security definer set search_path = ''
as $$
declare v_actor record; v_bid app_private.bids%rowtype; v_before jsonb; v_result app_private.bid_api_result;
begin
  select * into v_actor from app_private.require_active_buyer_actor(p_actor_membership_id);
  select * into v_bid from app_private.bids where id = p_bid_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Bid not found'; end if;
  if p_expected_revision is null or v_bid.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'Bid revision conflict'; end if;
  if v_bid.status not in ('open', 'closed') then raise exception using errcode = '55000', message = 'Only raw open or closed bids can be cancelled'; end if;
  v_before := app_private.bid_snapshot(p_bid_id);
  update app_private.bids set status = 'cancelled', cancelled_at = clock_timestamp(), revision = revision + 1 where id = p_bid_id;
  perform app_private.append_bid_audit(p_bid_id, 'cancelled', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, v_bid.revision, v_bid.status, v_bid.responsible_buyer_user_id, v_before);
  select result.* into v_result from app_private.bid_result(p_bid_id) as result; return v_result;
end;
$$;

revoke all on function app_private.reject_bid_creator_change() from public, anon, authenticated;
revoke all on function app_private.require_active_buyer_actor(uuid) from public, anon, authenticated;
revoke all on function app_private.require_active_buyer_target(uuid) from public, anon, authenticated;
revoke all on function app_private.validate_bid_text(text, text) from public, anon, authenticated;
revoke all on function app_private.validate_bid_deadline(timestamptz) from public, anon, authenticated;
revoke all on function app_private.validate_bid_items(text[], numeric[]) from public, anon, authenticated;
revoke all on function app_private.effective_bid_status(app_private.bid_status, timestamptz) from public, anon, authenticated;
revoke all on function app_private.bid_snapshot(uuid) from public, anon, authenticated;
revoke all on function app_private.bid_result(uuid) from public, anon, authenticated;
revoke all on function app_private.append_bid_audit(uuid, app_private.bid_audit_event_type, uuid, uuid, uuid, app_private.membership_role, bigint, app_private.bid_status, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.list_active_buyers(uuid) from public, anon;
revoke all on function public.list_bids(uuid, text, uuid) from public, anon;
revoke all on function public.list_bid_audit(uuid, uuid) from public, anon;
revoke all on function public.create_bid(uuid, text, text, text, timestamptz, uuid, text[], numeric[]) from public, anon;
revoke all on function public.update_bid(uuid, uuid, bigint, text, text, text, timestamptz, text[], numeric[]) from public, anon;
revoke all on function public.reassign_bid(uuid, uuid, bigint, uuid) from public, anon;
revoke all on function public.close_bid(uuid, uuid, bigint) from public, anon;
revoke all on function public.reopen_bid(uuid, uuid, bigint, timestamptz) from public, anon;
revoke all on function public.cancel_bid(uuid, uuid, bigint) from public, anon;
grant execute on function public.list_active_buyers(uuid), public.list_bids(uuid, text, uuid), public.list_bid_audit(uuid, uuid) to authenticated;
grant execute on function public.create_bid(uuid, text, text, text, timestamptz, uuid, text[], numeric[]) to authenticated;
grant execute on function public.update_bid(uuid, uuid, bigint, text, text, text, timestamptz, text[], numeric[]) to authenticated;
grant execute on function public.reassign_bid(uuid, uuid, bigint, uuid), public.close_bid(uuid, uuid, bigint), public.reopen_bid(uuid, uuid, bigint, timestamptz), public.cancel_bid(uuid, uuid, bigint) to authenticated;
