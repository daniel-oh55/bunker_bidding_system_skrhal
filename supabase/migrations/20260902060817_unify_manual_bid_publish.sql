-- Manual BID creation and mail-intake Publish share one authoritative creation
-- boundary: a future deadline and at least one explicit active SELLER are
-- required, and no legacy browser-callable overload may retain broader scope.

create or replace function app_private.create_authoritative_bid(
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
  if p_deadline_at is null then
    raise exception using errcode = '22023', message = 'Publish deadline is required';
  end if;
  perform app_private.validate_bid_deadline(p_deadline_at);
  perform app_private.validate_bid_items(p_fuel_grades, p_quantities);

  if p_responsible_buyer_user_id is null then
    p_responsible_buyer_user_id := p_actor_user_id;
  end if;
  perform app_private.require_active_buyer_target(p_responsible_buyer_user_id);

  if p_selected_trader_organization_ids is null then
    raise exception using errcode = '22023', message = 'Selected SELLER organizations are required';
  end if;
  if cardinality(p_selected_trader_organization_ids) < 1 then
    raise exception using errcode = '22023', message = 'At least one selected active SELLER is required';
  end if;
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
    and organization.id = any(p_selected_trader_organization_ids);

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

drop function public.create_bid(
  uuid, text, text, text, timestamptz, uuid, text[], numeric[]
) restrict;

create function public.create_bid(
  p_actor_membership_id uuid,
  p_vessel_voyage text,
  p_port_name text,
  p_delivery_window text,
  p_deadline_at timestamptz,
  p_responsible_buyer_user_id uuid,
  p_fuel_grades text[],
  p_quantities numeric[],
  p_selected_trader_organization_ids uuid[]
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
    p_selected_trader_organization_ids
  ) as result;
  return v_result;
end;
$$;

revoke all on function app_private.create_authoritative_bid(
  uuid, uuid, uuid, app_private.membership_role, text, text, text, timestamptz, uuid, text[], numeric[], uuid[]
) from public, anon, authenticated;

revoke all on function public.create_bid(
  uuid, text, text, text, timestamptz, uuid, text[], numeric[], uuid[]
) from public, anon, authenticated;
grant execute on function public.create_bid(
  uuid, text, text, text, timestamptz, uuid, text[], numeric[], uuid[]
) to authenticated;
