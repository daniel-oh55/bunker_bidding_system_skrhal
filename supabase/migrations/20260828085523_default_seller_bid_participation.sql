-- Snapshot active SELLER organizations into explicit per-BID access at creation,
-- and expose a BUYER-only participant comparison without placeholder quotes.

create or replace function public.create_bid(
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
  insert into app_private.bid_trader_organization_access (bid_id, trader_organization_id, granted_by_user_id, granted_by_membership_id)
  select v_bid_id, organization.id, v_actor.user_id, v_actor.membership_id
  from app_private.organizations as organization
  where organization.kind = 'trader'::app_private.organization_kind
    and organization.status = 'active'::app_private.organization_status;
  perform app_private.append_bid_audit(v_bid_id, 'created', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, null, null, null, null);
  select result.* into v_result from app_private.bid_result(v_bid_id) as result;
  return v_result;
end;
$$;

create function public.list_bid_seller_comparison_for_buyers(
  p_actor_membership_id uuid,
  p_bid_id uuid
)
returns table (
  bid_id uuid,
  trader_organization_id uuid,
  trader_organization_label text,
  access_active boolean,
  organization_active boolean,
  quote jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_active_buyer_actor(p_actor_membership_id);
  return query
  with participant_organizations as (
    select access.trader_organization_id
    from app_private.bid_trader_organization_access as access
    where access.bid_id = p_bid_id
    union
    select retained_quote.trader_organization_id
    from app_private.quotes as retained_quote
    where retained_quote.bid_id = p_bid_id
  )
  select
    p_bid_id,
    organization.id,
    organization.name,
    exists (
      select 1
      from app_private.bid_trader_organization_access as access
      where access.bid_id = p_bid_id
        and access.trader_organization_id = organization.id
    ),
    organization.status = 'active'::app_private.organization_status,
    case when retained_quote.id is null then null else to_jsonb(app_private.quote_result(retained_quote.id)) end
  from participant_organizations as participant
  join app_private.organizations as organization on organization.id = participant.trader_organization_id
  left join app_private.quotes as retained_quote
    on retained_quote.bid_id = p_bid_id
   and retained_quote.trader_organization_id = participant.trader_organization_id
  order by lower(btrim(organization.name)), organization.id;
end;
$$;

revoke all on function public.list_bid_seller_comparison_for_buyers(uuid, uuid) from public, anon;
grant execute on function public.list_bid_seller_comparison_for_buyers(uuid, uuid) to authenticated;
