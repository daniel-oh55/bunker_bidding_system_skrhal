-- Private, presentation-only BID ordering for the authenticated active BUYER.
-- The owner is derived only from auth.uid() through require_active_buyer_actor.

create table app_private.buyer_bid_order_states (
  user_id uuid not null references auth.users (id) on delete restrict,
  bid_date date not null,
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, bid_date)
);

create table app_private.buyer_bid_preferences (
  user_id uuid not null,
  bid_date date not null,
  bid_id uuid not null references app_private.bids (id) on delete restrict,
  display_order integer not null check (display_order > 0),
  primary key (user_id, bid_date, bid_id),
  unique (user_id, bid_date, display_order),
  foreign key (user_id, bid_date)
    references app_private.buyer_bid_order_states (user_id, bid_date)
    on delete cascade
);

alter table app_private.buyer_bid_order_states enable row level security;
alter table app_private.buyer_bid_preferences enable row level security;
revoke all on table app_private.buyer_bid_order_states, app_private.buyer_bid_preferences from public, anon, authenticated;

create function public.get_my_bid_order(
  p_actor_membership_id uuid,
  p_bid_date date
)
returns table (revision integer, ordered_bid_ids uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_revision integer;
begin
  select * into v_actor
  from app_private.require_active_buyer_actor(p_actor_membership_id);

  if p_bid_date is null then
    raise exception using errcode = '22023', message = 'A BID operational date is required';
  end if;

  select state.revision into v_revision
  from app_private.buyer_bid_order_states as state
  where state.user_id = v_actor.user_id and state.bid_date = p_bid_date;

  return query
  with server_bids as (
    select bid.id, bid.created_at
    from app_private.bids as bid
    where bid.bid_date = p_bid_date
  ), ranked as (
    select server_bids.id, preference.display_order, server_bids.created_at
    from server_bids
    left join app_private.buyer_bid_preferences as preference
      on preference.user_id = v_actor.user_id
     and preference.bid_date = p_bid_date
     and preference.bid_id = server_bids.id
  )
  select coalesce(v_revision, 0), coalesce(
    array_agg(ranked.id order by (ranked.display_order is null), ranked.display_order, ranked.created_at desc, ranked.id),
    array[]::uuid[]
  )
  from ranked;
end;
$$;

create function public.save_my_bid_order(
  p_actor_membership_id uuid,
  p_bid_date date,
  p_expected_revision integer,
  p_ordered_bid_ids uuid[]
)
returns table (revision integer, ordered_bid_ids uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_state app_private.buyer_bid_order_states%rowtype;
  v_submitted_count integer;
  v_distinct_count integer;
  v_server_count integer;
  v_existing_count integer;
  v_matching_count integer;
begin
  select * into v_actor
  from app_private.require_active_buyer_actor(p_actor_membership_id);

  if p_bid_date is null then
    raise exception using errcode = '22023', message = 'A BID operational date is required';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'A non-negative expected BID order revision is required';
  end if;
  if p_ordered_bid_ids is null then
    raise exception using errcode = '22023', message = 'A complete BID order is required';
  end if;
  if array_position(p_ordered_bid_ids, null) is not null then
    raise exception using errcode = '22023', message = 'BID order cannot contain null IDs';
  end if;

  -- This unique-key insert serializes concurrent first writes before the row lock.
  insert into app_private.buyer_bid_order_states (user_id, bid_date, revision)
  values (v_actor.user_id, p_bid_date, 0)
  on conflict (user_id, bid_date) do nothing;

  select * into v_state
  from app_private.buyer_bid_order_states as state
  where state.user_id = v_actor.user_id and state.bid_date = p_bid_date
  for update;

  if v_state.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'BID order revision conflict';
  end if;

  v_submitted_count := cardinality(p_ordered_bid_ids);
  select count(distinct submitted.bid_id) into v_distinct_count
  from unnest(p_ordered_bid_ids) as submitted(bid_id);
  if v_submitted_count <> v_distinct_count then
    raise exception using errcode = '22023', message = 'BID order cannot contain duplicate IDs';
  end if;

  select count(*) into v_server_count
  from app_private.bids as bid
  where bid.bid_date = p_bid_date;
  select count(*) into v_existing_count
  from app_private.bids as bid
  where bid.id = any(p_ordered_bid_ids);
  if v_existing_count <> v_submitted_count then
    raise exception using errcode = '22023', message = 'BID order contains an unknown BID';
  end if;
  select count(*) into v_matching_count
  from app_private.bids as bid
  where bid.bid_date = p_bid_date and bid.id = any(p_ordered_bid_ids);
  if v_matching_count <> v_submitted_count then
    raise exception using errcode = '22023', message = 'BID order must contain only BIDs from the selected date';
  end if;
  if v_submitted_count <> v_server_count then
    raise exception using errcode = '40001', message = 'BID order conflicts with the latest BID list';
  end if;

  delete from app_private.buyer_bid_preferences as preference
  where preference.user_id = v_actor.user_id and preference.bid_date = p_bid_date;
  insert into app_private.buyer_bid_preferences (user_id, bid_date, bid_id, display_order)
  select v_actor.user_id, p_bid_date, ordered.bid_id, ordered.ordinality::integer
  from unnest(p_ordered_bid_ids) with ordinality as ordered(bid_id, ordinality);

  update app_private.buyer_bid_order_states as state
  set revision = state.revision + 1, updated_at = clock_timestamp()
  where state.user_id = v_actor.user_id and state.bid_date = p_bid_date
  returning state.* into v_state;

  return query select v_state.revision, p_ordered_bid_ids;
end;
$$;

revoke all on function public.get_my_bid_order(uuid, date) from public, anon, authenticated;
revoke all on function public.save_my_bid_order(uuid, date, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.get_my_bid_order(uuid, date) to authenticated;
grant execute on function public.save_my_bid_order(uuid, date, integer, uuid[]) to authenticated;
