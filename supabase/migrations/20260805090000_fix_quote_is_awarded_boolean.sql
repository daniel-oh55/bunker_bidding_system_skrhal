create or replace function app_private.quote_result(p_quote_id uuid)
returns app_private.quote_api_result language sql volatile security definer set search_path = '' as $$
  select row(quote.id, quote.bid_id, quote.trader_organization_id, organization.name, quote.revision, quote.created_by,
    coalesce((select jsonb_agg(jsonb_build_object('fuel_grade', item.fuel_grade, 'unit_price', item.unit_price) order by item.display_order) from app_private.quote_items item where item.quote_id = quote.id), '[]'::jsonb),
    quote.barge_fee, quote.barge_fee + coalesce((select sum(item.unit_price * bid_item.quantity_mt) from app_private.quote_items item join app_private.bid_items bid_item on bid_item.bid_id = quote.bid_id and bid_item.fuel_grade = item.fuel_grade where item.quote_id = quote.id), 0),
    quote.created_at, quote.updated_at,
    exists (select 1 from app_private.bid_trader_organization_access access where access.bid_id = quote.bid_id and access.trader_organization_id = quote.trader_organization_id),
    organization.status = 'active'::app_private.organization_status,
    exists (select 1 from app_private.bid_trader_organization_access access where access.bid_id = quote.bid_id and access.trader_organization_id = quote.trader_organization_id)
      and organization.status = 'active'::app_private.organization_status
      and app_private.effective_bid_status(bid.status, bid.deadline_at) = 'closed',
    coalesce(bid.awarded_quote_id = quote.id, false)
  )::app_private.quote_api_result
  from app_private.quotes quote join app_private.organizations organization on organization.id = quote.trader_organization_id
  join app_private.bids bid on bid.id = quote.bid_id where quote.id = p_quote_id;
$$;
