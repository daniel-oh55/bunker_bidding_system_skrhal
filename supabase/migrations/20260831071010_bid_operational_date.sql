-- Server-authoritative Asia/Seoul operational BID dates.
-- Historical rows are classified once from their immutable creation timestamps.

create function app_private.current_bid_date()
returns date
language sql
volatile
security definer
set search_path = ''
as $$
  select (clock_timestamp() at time zone 'Asia/Seoul')::date;
$$;

alter table app_private.bids add column bid_date date null;

-- Avoid presenting the one-time metadata classification as a business update
-- or publishing one Realtime invalidation per historical BID.
alter table app_private.bids disable trigger set_bids_updated_at;
alter table app_private.bids disable trigger broadcast_bid_workspace_changed;
update app_private.bids
set bid_date = (created_at at time zone 'Asia/Seoul')::date;
alter table app_private.bids enable trigger broadcast_bid_workspace_changed;
alter table app_private.bids enable trigger set_bids_updated_at;

alter table app_private.bids
  alter column bid_date set default app_private.current_bid_date(),
  alter column bid_date set not null;

create index bids_bid_date_created_at_idx
on app_private.bids (bid_date, created_at desc, id);

create function app_private.reject_bid_date_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.bid_date is distinct from old.bid_date then
    raise exception using errcode = '42501', message = 'Bid operational date is immutable';
  end if;
  return new;
end;
$$;

create trigger reject_bid_date_change
before update of bid_date on app_private.bids
for each row execute function app_private.reject_bid_date_change();

alter type app_private.bid_api_result add attribute bid_date date;

create or replace function app_private.bid_snapshot(p_bid_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', bid.id,
    'bid_date', bid.bid_date,
    'vessel_voyage', bid.vessel_voyage,
    'port_name', bid.port_name,
    'delivery_window', bid.delivery_window,
    'deadline_at', bid.deadline_at,
    'raw_status', bid.status::text,
    'effective_status', app_private.effective_bid_status(bid.status, bid.deadline_at),
    'revision', bid.revision,
    'created_by', bid.created_by,
    'responsible_buyer_user_id', bid.responsible_buyer_user_id,
    'fuel_items', coalesce((
      select jsonb_agg(
        jsonb_build_object('fuel_grade', item.fuel_grade, 'quantity_mt', item.quantity_mt)
        order by item.display_order
      )
      from app_private.bid_items as item
      where item.bid_id = bid.id
    ), '[]'::jsonb),
    'allowed_trader_organization_ids', coalesce((
      select jsonb_agg(access.trader_organization_id order by access.trader_organization_id)
      from app_private.bid_trader_organization_access as access
      where access.bid_id = bid.id
    ), '[]'::jsonb),
    'awarded_quote_id', bid.awarded_quote_id,
    'awarded_trader_organization_id', (
      select quote.trader_organization_id
      from app_private.quotes as quote
      where quote.id = bid.awarded_quote_id
    ),
    'awarded_trader_organization_label', (
      select organization.name
      from app_private.quotes as quote
      join app_private.organizations as organization on organization.id = quote.trader_organization_id
      where quote.id = bid.awarded_quote_id
    ),
    'awarded_total_amount', case
      when bid.awarded_quote_id is null then null
      else (app_private.quote_snapshot(bid.awarded_quote_id) ->> 'total_amount')::numeric
    end,
    'awarded_at', bid.awarded_at,
    'awarded_quote', case
      when bid.awarded_quote_id is null then null
      else app_private.quote_snapshot(bid.awarded_quote_id)
    end
  )
  from app_private.bids as bid
  where bid.id = p_bid_id;
$$;

create or replace function app_private.bid_result(p_bid_id uuid)
returns app_private.bid_api_result
language sql
volatile
security definer
set search_path = ''
as $$
  select row(
    bid.id,
    bid.vessel_voyage,
    bid.port_name,
    bid.delivery_window,
    bid.deadline_at,
    bid.status::text,
    app_private.effective_bid_status(bid.status, bid.deadline_at),
    bid.revision,
    bid.created_by,
    coalesce(nullif(btrim(creator_account.display_name), ''), nullif(split_part(creator.email, '@', 1), ''), bid.created_by::text),
    bid.responsible_buyer_user_id,
    coalesce(nullif(btrim(responsible_account.display_name), ''), nullif(split_part(responsible.email, '@', 1), ''), bid.responsible_buyer_user_id::text),
    coalesce((
      select jsonb_agg(
        jsonb_build_object('fuel_grade', item.fuel_grade, 'quantity_mt', item.quantity_mt)
        order by item.display_order
      )
      from app_private.bid_items as item
      where item.bid_id = bid.id
    ), '[]'::jsonb),
    bid.created_at,
    bid.updated_at,
    bid.closed_at,
    bid.cancelled_at,
    bid.awarded_quote_id,
    quote.trader_organization_id,
    organization.name,
    case
      when quote.id is null then null
      else quote.barge_fee + coalesce((
        select sum(item.unit_price * bid_item.quantity_mt)
        from app_private.quote_items as item
        join app_private.bid_items as bid_item
          on bid_item.bid_id = bid.id
         and bid_item.fuel_grade = item.fuel_grade
        where item.quote_id = quote.id
      ), 0)
    end,
    bid.awarded_at,
    bid.bid_date
  )::app_private.bid_api_result
  from app_private.bids as bid
  join auth.users as creator on creator.id = bid.created_by
  join app_private.user_accounts as creator_account on creator_account.user_id = creator.id
  join auth.users as responsible on responsible.id = bid.responsible_buyer_user_id
  join app_private.user_accounts as responsible_account on responsible_account.user_id = responsible.id
  left join app_private.quotes as quote on quote.id = bid.awarded_quote_id
  left join app_private.organizations as organization on organization.id = quote.trader_organization_id
  where bid.id = p_bid_id;
$$;

drop function public.list_bids(uuid, text, uuid);

create function public.list_bids(
  p_actor_membership_id uuid,
  p_bid_date date,
  p_view text,
  p_responsible_buyer_user_id uuid
)
returns setof app_private.bid_api_result
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_active_buyer_actor(p_actor_membership_id);
  if p_bid_date is null then
    raise exception using errcode = '22023', message = 'A BID operational date is required';
  end if;
  if p_view is null or p_view not in ('all', 'created_by_me', 'responsible_buyer') then
    raise exception using errcode = '22023', message = 'Unknown bid view';
  end if;
  if p_view = 'responsible_buyer' and p_responsible_buyer_user_id is null then
    raise exception using errcode = '22023', message = 'responsible_buyer view requires a target user';
  end if;

  return query
  select result.*
  from app_private.bids as bid
  cross join lateral app_private.bid_result(bid.id) as result
  where bid.bid_date = p_bid_date
    and (
      p_view = 'all'
      or (p_view = 'created_by_me' and bid.created_by = auth.uid())
      or (p_view = 'responsible_buyer' and bid.responsible_buyer_user_id = p_responsible_buyer_user_id)
    )
  order by bid.created_at desc, bid.id;
end;
$$;

create or replace function public.list_trader_bids(p_actor_membership_id uuid)
returns table (
  id uuid,
  vessel_voyage text,
  port_name text,
  delivery_window text,
  deadline_at timestamptz,
  raw_status text,
  effective_status text,
  revision bigint,
  fuel_items jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  closed_at timestamptz,
  cancelled_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor record;
begin
  select * into v_actor from app_private.require_active_trader_actor(p_actor_membership_id);
  return query
  select
    bid.id,
    bid.vessel_voyage,
    bid.port_name,
    bid.delivery_window,
    bid.deadline_at,
    bid.status::text,
    app_private.effective_bid_status(bid.status, bid.deadline_at),
    bid.revision,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('fuel_grade', item.fuel_grade, 'quantity_mt', item.quantity_mt)
        order by item.display_order
      )
      from app_private.bid_items as item
      where item.bid_id = bid.id
    ), '[]'::jsonb),
    bid.created_at,
    bid.updated_at,
    bid.closed_at,
    bid.cancelled_at
  from app_private.bids as bid
  join app_private.bid_trader_organization_access as access
    on access.bid_id = bid.id
   and access.trader_organization_id = v_actor.organization_id
  where bid.bid_date = app_private.current_bid_date()
  order by bid.created_at desc, bid.id;
end;
$$;

create or replace function public.list_my_quotes(p_actor_membership_id uuid)
returns setof app_private.quote_api_result
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor record;
begin
  select * into v_actor from app_private.require_active_trader_actor(p_actor_membership_id);
  return query
  select result.*
  from app_private.quotes as quote
  join app_private.bids as bid on bid.id = quote.bid_id
  join app_private.bid_trader_organization_access as access
    on access.bid_id = quote.bid_id
   and access.trader_organization_id = v_actor.organization_id
  cross join lateral app_private.quote_result(quote.id) as result
  where quote.trader_organization_id = v_actor.organization_id
    and bid.bid_date = app_private.current_bid_date()
  order by quote.created_at, quote.id;
end;
$$;

create or replace function public.create_quote(
  p_actor_membership_id uuid,
  p_bid_id uuid,
  p_fuel_grades text[],
  p_unit_prices numeric[],
  p_barge_fee numeric
)
returns app_private.quote_api_result
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor record; v_bid app_private.bids%rowtype; v_quote_id uuid; v_result app_private.quote_api_result;
begin
  select * into v_actor from app_private.require_active_trader_actor(p_actor_membership_id);
  select * into v_bid from app_private.bids where id = p_bid_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Bid not found'; end if;
  if not exists (
    select 1 from app_private.bid_trader_organization_access as access
    where access.bid_id = p_bid_id and access.trader_organization_id = v_actor.organization_id
  ) then raise exception using errcode = '42501', message = 'Current TRADER bid access is required'; end if;
  if v_bid.bid_date <> app_private.current_bid_date() then
    raise exception using errcode = '55000', message = 'Quotes are editable only for today''s Seoul operational date';
  end if;
  if app_private.effective_bid_status(v_bid.status, v_bid.deadline_at) <> 'open' then
    raise exception using errcode = '55000', message = 'Quotes are editable only while effective-open';
  end if;
  if exists (
    select 1 from app_private.quotes as quote
    where quote.bid_id = p_bid_id and quote.trader_organization_id = v_actor.organization_id
  ) then raise exception using errcode = '23505', message = 'Organization already has a quote for this bid'; end if;
  perform app_private.validate_quote_values(p_bid_id, p_fuel_grades, p_unit_prices, p_barge_fee);
  insert into app_private.quotes (bid_id, trader_organization_id, created_by, barge_fee)
  values (p_bid_id, v_actor.organization_id, v_actor.user_id, p_barge_fee)
  returning id into v_quote_id;
  insert into app_private.quote_items (quote_id, fuel_grade, unit_price, display_order)
  select v_quote_id, bid_item.fuel_grade, p_unit_prices[array_position(p_fuel_grades, bid_item.fuel_grade)], bid_item.display_order
  from app_private.bid_items as bid_item
  where bid_item.bid_id = p_bid_id
  order by bid_item.display_order;
  perform app_private.append_quote_audit(v_quote_id, 'created', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, null, null);
  select * into v_result from app_private.quote_result(v_quote_id);
  return v_result;
end;
$$;

create or replace function public.update_quote(
  p_actor_membership_id uuid,
  p_quote_id uuid,
  p_expected_revision bigint,
  p_fuel_grades text[],
  p_unit_prices numeric[],
  p_barge_fee numeric
)
returns app_private.quote_api_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_bid app_private.bids%rowtype;
  v_quote app_private.quotes%rowtype;
  v_before jsonb;
  v_result app_private.quote_api_result;
  v_normalized_items jsonb;
begin
  select * into v_actor from app_private.require_active_trader_actor(p_actor_membership_id);
  select bid.* into v_bid
  from app_private.bids as bid
  join app_private.quotes as quote on quote.bid_id = bid.id
  where quote.id = p_quote_id
  for update of bid;
  if not found then raise exception using errcode = 'P0002', message = 'Quote not found'; end if;
  if not exists (
    select 1 from app_private.bid_trader_organization_access as access
    where access.bid_id = v_bid.id and access.trader_organization_id = v_actor.organization_id
  ) then raise exception using errcode = '42501', message = 'Current TRADER bid access is required'; end if;
  if v_bid.bid_date <> app_private.current_bid_date() then
    raise exception using errcode = '55000', message = 'Quotes are editable only for today''s Seoul operational date';
  end if;
  if app_private.effective_bid_status(v_bid.status, v_bid.deadline_at) <> 'open' then
    raise exception using errcode = '55000', message = 'Quotes are editable only while effective-open';
  end if;
  select * into v_quote from app_private.quotes where id = p_quote_id for update;
  if v_quote.trader_organization_id <> v_actor.organization_id then
    raise exception using errcode = '42501', message = 'Quote belongs to another TRADER organization';
  end if;
  if p_expected_revision is null or v_quote.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Quote revision conflict';
  end if;
  perform app_private.validate_quote_values(v_bid.id, p_fuel_grades, p_unit_prices, p_barge_fee);
  select jsonb_agg(
    jsonb_build_object(
      'fuel_grade', bid_item.fuel_grade,
      'unit_price', submitted.unit_price,
      'display_order', bid_item.display_order
    ) order by bid_item.display_order
  ) into v_normalized_items
  from app_private.bid_items as bid_item
  join unnest(p_fuel_grades, p_unit_prices) as submitted(fuel_grade, unit_price)
    on submitted.fuel_grade = bid_item.fuel_grade
  where bid_item.bid_id = v_bid.id;
  if v_quote.barge_fee = p_barge_fee and (
    select jsonb_agg(
      jsonb_build_object('fuel_grade', item.fuel_grade, 'unit_price', item.unit_price, 'display_order', item.display_order)
      order by item.display_order
    )
    from app_private.quote_items as item
    where item.quote_id = p_quote_id
  ) = v_normalized_items then
    raise exception using errcode = '22023', message = 'Quote update makes no changes';
  end if;
  v_before := app_private.quote_snapshot(p_quote_id);
  update app_private.quotes set barge_fee = p_barge_fee, revision = revision + 1 where id = p_quote_id;
  delete from app_private.quote_items where quote_id = p_quote_id;
  insert into app_private.quote_items (quote_id, fuel_grade, unit_price, display_order)
  select p_quote_id, item.fuel_grade, item.unit_price, item.display_order
  from jsonb_to_recordset(v_normalized_items) as item(fuel_grade text, unit_price numeric, display_order smallint)
  order by item.display_order;
  perform app_private.append_quote_audit(p_quote_id, 'updated', v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_actor.membership_role, v_quote.revision, v_before);
  select * into v_result from app_private.quote_result(p_quote_id);
  return v_result;
end;
$$;

revoke all on function app_private.current_bid_date(), app_private.reject_bid_date_change() from public, anon, authenticated;
revoke all on function public.list_bids(uuid, date, text, uuid) from public, anon;
grant execute on function public.list_bids(uuid, date, text, uuid) to authenticated;
