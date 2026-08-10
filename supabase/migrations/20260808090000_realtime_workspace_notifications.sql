-- Private Realtime Broadcast invalidation hints. These topics never carry bidding data
-- and are authorized from current server-side membership state only.

create policy "authenticated receive authorized workspace broadcasts"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (
    (
      realtime.topic() = 'workspace:buyer'
      and exists (
        select 1
        from public.current_access_context() as context
        where context.organization_kind = 'buyer'
          and context.membership_role in ('buyer_admin', 'buyer_operator')
      )
    )
    or (
      exists (
        select 1
        from public.current_access_context() as context
        where context.organization_kind = 'trader'
          and context.membership_role = 'trader'
          and realtime.topic() = 'workspace:trader:' || context.organization_id::text
      )
    )
    or (
      auth.uid() is not null
      and realtime.topic() = 'workspace:access:' || auth.uid()::text
    )
  )
);

create function app_private.send_workspace_changed(p_topic text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('kind', 'workspace_changed'),
    'workspace_changed',
    p_topic,
    true
  );
end;
$$;

create function app_private.send_access_changed(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is not null then
    perform realtime.send(
      jsonb_build_object('kind', 'access_changed'),
      'access_changed',
      'workspace:access:' || p_user_id::text,
      true
    );
  end if;
end;
$$;

create function app_private.broadcast_bid_workspace_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trader_organization record;
begin
  perform app_private.send_workspace_changed('workspace:buyer');

  for trader_organization in
    select access.trader_organization_id
    from app_private.bid_trader_organization_access as access
    where access.bid_id = new.id
  loop
    perform app_private.send_workspace_changed(
      'workspace:trader:' || trader_organization.trader_organization_id::text
    );
  end loop;

  return new;
end;
$$;

create function app_private.broadcast_quote_workspace_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.send_workspace_changed('workspace:buyer');
  perform app_private.send_workspace_changed(
    'workspace:trader:' || new.trader_organization_id::text
  );
  return new;
end;
$$;

create function app_private.broadcast_bid_trader_access_workspace_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_trader_organization_id uuid;
begin
  affected_trader_organization_id := case
    when tg_op = 'DELETE' then old.trader_organization_id
    else new.trader_organization_id
  end;

  perform app_private.send_workspace_changed('workspace:buyer');
  perform app_private.send_workspace_changed(
    'workspace:trader:' || affected_trader_organization_id::text
  );

  return coalesce(new, old);
end;
$$;

create function app_private.broadcast_user_account_access_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.send_access_changed(new.user_id);
  return new;
end;
$$;

create function app_private.broadcast_membership_access_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app_private.send_access_changed(old.user_id);
    return old;
  end if;

  perform app_private.send_access_changed(new.user_id);
  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    perform app_private.send_access_changed(old.user_id);
  end if;
  return new;
end;
$$;

create function app_private.broadcast_organization_access_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member record;
begin
  for member in
    select membership.user_id
    from app_private.organization_memberships as membership
    where membership.organization_id = new.id
  loop
    perform app_private.send_access_changed(member.user_id);
  end loop;

  perform app_private.send_workspace_changed('workspace:buyer');
  return new;
end;
$$;

create trigger broadcast_bid_workspace_changed
after insert or update on app_private.bids
for each row execute function app_private.broadcast_bid_workspace_changed();

create trigger broadcast_quote_workspace_changed
after insert or update on app_private.quotes
for each row execute function app_private.broadcast_quote_workspace_changed();

create trigger broadcast_bid_trader_access_workspace_changed
after insert or delete on app_private.bid_trader_organization_access
for each row execute function app_private.broadcast_bid_trader_access_workspace_changed();

create trigger broadcast_user_account_access_changed
after update of status on app_private.user_accounts
for each row execute function app_private.broadcast_user_account_access_changed();

create trigger broadcast_membership_access_changed
after insert or delete or update of user_id, organization_id, role, status
on app_private.organization_memberships
for each row execute function app_private.broadcast_membership_access_changed();

create trigger broadcast_organization_access_changed
after update of status, kind, name on app_private.organizations
for each row execute function app_private.broadcast_organization_access_changed();

revoke all on function app_private.send_workspace_changed(text) from public, anon, authenticated;
revoke all on function app_private.send_access_changed(uuid) from public, anon, authenticated;
revoke all on function app_private.broadcast_bid_workspace_changed() from public, anon, authenticated;
revoke all on function app_private.broadcast_quote_workspace_changed() from public, anon, authenticated;
revoke all on function app_private.broadcast_bid_trader_access_workspace_changed() from public, anon, authenticated;
revoke all on function app_private.broadcast_user_account_access_changed() from public, anon, authenticated;
revoke all on function app_private.broadcast_membership_access_changed() from public, anon, authenticated;
revoke all on function app_private.broadcast_organization_access_changed() from public, anon, authenticated;
