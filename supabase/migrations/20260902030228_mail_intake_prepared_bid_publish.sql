-- A normalized intake item remains private preparation data. It can link to one
-- authoritative BID after an explicit BUYER publish, but is never itself a BID.

alter table app_private.mail_intake_items
  add column converted_bid_id uuid null references app_private.bids (id) on delete restrict,
  add column converted_at timestamptz null,
  add column converted_by_user_id uuid null references auth.users (id) on delete restrict,
  add column converted_by_membership_id uuid null references app_private.organization_memberships (id) on delete restrict,
  add constraint mail_intake_items_conversion_consistency check (
    (
      converted_bid_id is null
      and converted_at is null
      and converted_by_user_id is null
      and converted_by_membership_id is null
    )
    or (
      status = 'pending'::app_private.mail_intake_status
      and converted_bid_id is not null
      and converted_at is not null
      and converted_by_user_id is not null
      and converted_by_membership_id is not null
    )
  ),
  add constraint mail_intake_items_converted_bid_id_key unique (converted_bid_id);

create function app_private.create_authoritative_bid(
  p_actor_user_id uuid,
  p_actor_membership_id uuid,
  p_actor_organization_id uuid,
  p_actor_role app_private.membership_role,
  p_vessel_voyage text,
  p_port_name text,
  p_delivery_window text,
  p_deadline_at timestamptz,
  p_responsible_buyer_user_id uuid,
  p_fuel_grades text[],
  p_quantities numeric[],
  p_selected_trader_organization_ids uuid[] default null
)
returns app_private.bid_api_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bid_id uuid;
  v_result app_private.bid_api_result;
  v_selected_count integer;
  v_active_selected_count integer;
begin
  perform app_private.validate_bid_deadline(p_deadline_at);
  perform app_private.validate_bid_items(p_fuel_grades, p_quantities);

  if p_responsible_buyer_user_id is null then
    p_responsible_buyer_user_id := p_actor_user_id;
  end if;
  perform app_private.require_active_buyer_target(p_responsible_buyer_user_id);

  if p_selected_trader_organization_ids is not null then
    if array_position(p_selected_trader_organization_ids, null) is not null then
      raise exception using errcode = '22023', message = 'Selected SELLER organizations are invalid';
    end if;

    select cardinality(p_selected_trader_organization_ids), count(distinct selected.organization_id)
    into v_selected_count, v_active_selected_count
    from unnest(p_selected_trader_organization_ids) as selected(organization_id);

    if v_selected_count <> v_active_selected_count then
      raise exception using errcode = '22023', message = 'Selected SELLER organizations are duplicated';
    end if;

    select count(*) into v_active_selected_count
    from app_private.organizations as organization
    where organization.id = any(p_selected_trader_organization_ids)
      and organization.kind = 'trader'::app_private.organization_kind
      and organization.status = 'active'::app_private.organization_status;

    if v_selected_count <> v_active_selected_count then
      raise exception using errcode = '22023', message = 'Selected SELLER organizations must be active';
    end if;
  end if;

  insert into app_private.bids (
    vessel_voyage,
    port_name,
    delivery_window,
    deadline_at,
    status,
    created_by,
    responsible_buyer_user_id
  ) values (
    app_private.validate_bid_text(p_vessel_voyage, 'vessel_voyage'),
    app_private.validate_bid_text(p_port_name, 'port_name'),
    app_private.validate_bid_text(p_delivery_window, 'delivery_window'),
    p_deadline_at,
    'open',
    p_actor_user_id,
    p_responsible_buyer_user_id
  ) returning id into v_bid_id;

  insert into app_private.bid_items (bid_id, fuel_grade, quantity_mt, display_order)
  select v_bid_id, grades.grade, p_quantities[grades.ordinality], grades.ordinality::smallint
  from unnest(p_fuel_grades) with ordinality as grades(grade, ordinality);

  insert into app_private.bid_trader_organization_access (
    bid_id,
    trader_organization_id,
    granted_by_user_id,
    granted_by_membership_id
  )
  select v_bid_id, organization.id, p_actor_user_id, p_actor_membership_id
  from app_private.organizations as organization
  where organization.kind = 'trader'::app_private.organization_kind
    and organization.status = 'active'::app_private.organization_status
    and (
      p_selected_trader_organization_ids is null
      or organization.id = any(p_selected_trader_organization_ids)
    );

  insert into app_private.bid_trader_organization_responses (
    bid_id,
    trader_organization_id,
    response_status,
    revision
  )
  select access.bid_id, access.trader_organization_id, 'awaiting', 1
  from app_private.bid_trader_organization_access as access
  where access.bid_id = v_bid_id;

  perform app_private.append_bid_audit(
    v_bid_id,
    'created',
    p_actor_user_id,
    p_actor_membership_id,
    p_actor_organization_id,
    p_actor_role,
    null,
    null,
    null,
    null
  );

  select result.* into v_result
  from app_private.bid_result(v_bid_id) as result;
  return v_result;
end;
$$;

create or replace function public.create_bid(
  p_actor_membership_id uuid,
  p_vessel_voyage text,
  p_port_name text,
  p_delivery_window text,
  p_deadline_at timestamptz,
  p_responsible_buyer_user_id uuid default null,
  p_fuel_grades text[] default null,
  p_quantities numeric[] default null
)
returns app_private.bid_api_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_result app_private.bid_api_result;
begin
  select * into v_actor
  from app_private.require_active_buyer_actor(p_actor_membership_id);

  select result.* into v_result
  from app_private.create_authoritative_bid(
    v_actor.user_id,
    v_actor.membership_id,
    v_actor.organization_id,
    v_actor.membership_role,
    p_vessel_voyage,
    p_port_name,
    p_delivery_window,
    p_deadline_at,
    p_responsible_buyer_user_id,
    p_fuel_grades,
    p_quantities,
    null
  ) as result;
  return v_result;
end;
$$;

create function public.publish_mail_intake_bid(
  p_actor_membership_id uuid,
  p_item_id uuid,
  p_expected_revision bigint,
  p_vessel_voyage text,
  p_port_name text,
  p_delivery_window text,
  p_deadline_at timestamptz,
  p_responsible_buyer_user_id uuid default null,
  p_fuel_grades text[] default null,
  p_quantities numeric[] default null,
  p_selected_trader_organization_ids uuid[] default null
)
returns app_private.bid_api_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_item app_private.mail_intake_items%rowtype;
  v_result app_private.bid_api_result;
begin
  select * into v_actor
  from app_private.require_active_buyer_actor(p_actor_membership_id);

  select * into v_item
  from app_private.mail_intake_items
  where id = p_item_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Mail intake item not found';
  end if;

  if v_item.converted_bid_id is not null then
    select result.* into v_result
    from app_private.bid_result(v_item.converted_bid_id) as result;
    return v_result;
  end if;

  if p_expected_revision is null or v_item.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Mail intake revision conflict';
  end if;

  if v_item.status <> 'pending'::app_private.mail_intake_status then
    raise exception using errcode = '55000', message = 'Only pending mail intake can be published';
  end if;

  if p_deadline_at is null then
    raise exception using errcode = '22023', message = 'Publish deadline is required';
  end if;

  if p_selected_trader_organization_ids is null then
    raise exception using errcode = '22023', message = 'Selected SELLER organizations are required';
  end if;

  select result.* into v_result
  from app_private.create_authoritative_bid(
    v_actor.user_id,
    v_actor.membership_id,
    v_actor.organization_id,
    v_actor.membership_role,
    p_vessel_voyage,
    p_port_name,
    p_delivery_window,
    p_deadline_at,
    p_responsible_buyer_user_id,
    p_fuel_grades,
    p_quantities,
    p_selected_trader_organization_ids
  ) as result;

  update app_private.mail_intake_items
  set converted_bid_id = v_result.id,
      converted_at = clock_timestamp(),
      converted_by_user_id = v_actor.user_id,
      converted_by_membership_id = v_actor.membership_id,
      revision = revision + 1
  where id = p_item_id;

  return v_result;
end;
$$;

create or replace function public.list_mail_intake_items(p_actor_membership_id uuid)
returns setof app_private.mail_intake_api_result
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_active_buyer_actor(p_actor_membership_id);
  return query
  select result.*
  from app_private.mail_intake_items as item
  cross join lateral app_private.mail_intake_result(item.id) as result
  where item.status = 'pending'::app_private.mail_intake_status
    and item.converted_bid_id is null
  order by item.received_at desc, item.created_at desc, item.id;
end;
$$;

create or replace function public.dismiss_mail_intake_item(
  p_actor_membership_id uuid,
  p_item_id uuid,
  p_expected_revision bigint
)
returns app_private.mail_intake_api_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_item app_private.mail_intake_items%rowtype;
  v_result app_private.mail_intake_api_result;
begin
  select * into v_actor
  from app_private.require_active_buyer_actor(p_actor_membership_id);

  select * into v_item
  from app_private.mail_intake_items
  where id = p_item_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Mail intake item not found';
  end if;

  if v_item.converted_bid_id is not null then
    raise exception using errcode = '55000', message = 'Converted mail intake item cannot be dismissed';
  end if;

  if p_expected_revision is null or v_item.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Mail intake revision conflict';
  end if;

  if v_item.status = 'dismissed'::app_private.mail_intake_status then
    raise exception using errcode = '55000', message = 'Mail intake item is already dismissed';
  end if;

  update app_private.mail_intake_items
  set status = 'dismissed'::app_private.mail_intake_status,
      dismissed_at = clock_timestamp(),
      dismissed_by_user_id = v_actor.user_id,
      dismissed_by_membership_id = v_actor.membership_id,
      revision = revision + 1
  where id = p_item_id;

  select result.* into v_result
  from app_private.mail_intake_result(p_item_id) as result;
  return v_result;
end;
$$;

create or replace function public.revoke_bid_trader_access(
  p_actor_membership_id uuid,
  p_bid_id uuid,
  p_expected_revision bigint,
  p_trader_organization_id uuid
)
returns app_private.bid_api_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_bid app_private.bids%rowtype;
  v_before jsonb;
  v_result app_private.bid_api_result;
begin
  select * into v_actor
  from app_private.require_active_buyer_actor(p_actor_membership_id);

  select * into v_bid
  from app_private.bids
  where id = p_bid_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Bid not found';
  end if;
  if p_expected_revision is null or v_bid.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Bid revision conflict';
  end if;
  if app_private.effective_bid_status(v_bid.status, v_bid.deadline_at) <> 'open' then
    raise exception using errcode = '55000', message = 'TRADER scope can be revoked only while effective-open';
  end if;
  if not exists (
    select 1
    from app_private.bid_trader_organization_access as access
    where access.bid_id = p_bid_id
      and access.trader_organization_id = p_trader_organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'TRADER bid access not found';
  end if;

  v_before := app_private.bid_snapshot(p_bid_id);
  delete from app_private.bid_trader_organization_access
  where bid_id = p_bid_id
    and trader_organization_id = p_trader_organization_id;
  update app_private.bids
  set revision = revision + 1
  where id = p_bid_id;
  perform app_private.append_bid_audit(
    p_bid_id,
    'trader_access_revoked',
    v_actor.user_id,
    v_actor.membership_id,
    v_actor.organization_id,
    v_actor.membership_role,
    v_bid.revision,
    v_bid.status,
    v_bid.responsible_buyer_user_id,
    v_before
  );
  select result.* into v_result
  from app_private.bid_result(p_bid_id) as result;
  return v_result;
end;
$$;

revoke all on function app_private.create_authoritative_bid(
  uuid, uuid, uuid, app_private.membership_role, text, text, text, timestamptz, uuid, text[], numeric[], uuid[]
) from public, anon, authenticated;

revoke all on function public.publish_mail_intake_bid(
  uuid, uuid, bigint, text, text, text, timestamptz, uuid, text[], numeric[], uuid[]
) from public, anon;
grant execute on function public.publish_mail_intake_bid(
  uuid, uuid, bigint, text, text, text, timestamptz, uuid, text[], numeric[], uuid[]
) to authenticated;
