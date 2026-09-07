-- Audit-preserving, terminal-only BID archive retention.
-- Archive is orthogonal to the raw lifecycle status and is intentionally one-way.

alter table app_private.bids
  add column archived_at timestamptz null,
  add constraint bids_archive_terminal_only check (
    archived_at is null
    or status in ('cancelled'::app_private.bid_status, 'awarded'::app_private.bid_status)
  );

create function app_private.reject_bid_archive_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.archived_at is not null and new.archived_at is distinct from old.archived_at then
    raise exception using errcode = '42501', message = 'Bid archive state is immutable';
  end if;
  return new;
end;
$$;

create trigger reject_bid_archive_change
before update of archived_at on app_private.bids
for each row execute function app_private.reject_bid_archive_change();

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
    'archived_at', bid.archived_at,
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

create function public.archive_bid(
  p_actor_membership_id uuid,
  p_bid_id uuid,
  p_expected_revision bigint
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
  if v_bid.archived_at is not null then
    raise exception using errcode = '55000', message = 'Bid is already archived';
  end if;
  if v_bid.status not in ('cancelled'::app_private.bid_status, 'awarded'::app_private.bid_status) then
    raise exception using errcode = '55000', message = 'Only raw cancelled or awarded bids can be archived';
  end if;

  v_before := app_private.bid_snapshot(p_bid_id);
  update app_private.bids
  set archived_at = clock_timestamp(), revision = revision + 1
  where id = p_bid_id;

  perform app_private.append_bid_audit(
    p_bid_id,
    'archived',
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

create or replace function public.list_bids(
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
    and bid.archived_at is null
    and (
      p_view = 'all'
      or (p_view = 'created_by_me' and bid.created_by = auth.uid())
      or (p_view = 'responsible_buyer' and bid.responsible_buyer_user_id = p_responsible_buyer_user_id)
    )
  order by bid.created_at desc, bid.id;
end;
$$;

create function public.list_archived_bids(
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
    and bid.archived_at is not null
    and (
      p_view = 'all'
      or (p_view = 'created_by_me' and bid.created_by = auth.uid())
      or (p_view = 'responsible_buyer' and bid.responsible_buyer_user_id = p_responsible_buyer_user_id)
    )
  order by bid.created_at desc, bid.id;
end;
$$;

revoke all on function app_private.reject_bid_archive_change() from public, anon, authenticated;
revoke all on function public.archive_bid(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.list_bids(uuid, date, text, uuid) from public, anon, authenticated;
revoke all on function public.list_archived_bids(uuid, date, text, uuid) from public, anon, authenticated;
grant execute on function public.archive_bid(uuid, uuid, bigint) to authenticated;
grant execute on function public.list_bids(uuid, date, text, uuid) to authenticated;
grant execute on function public.list_archived_bids(uuid, date, text, uuid) to authenticated;
