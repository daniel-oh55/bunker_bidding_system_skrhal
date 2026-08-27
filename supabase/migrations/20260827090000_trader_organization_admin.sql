-- BUYER-admin management of user-facing SELLER masters. SELLER identity remains
-- the existing TRADER organization model; no account, membership, or BID scope
-- is provisioned by these functions.

create unique index organizations_trader_normalized_name_uidx
on app_private.organizations ((lower(btrim(name))))
where kind = 'trader'::app_private.organization_kind;

create type app_private.trader_organization_admin_event_type as enum (
  'created',
  'deactivated'
);

create table app_private.trader_organization_admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  trader_organization_id uuid not null references app_private.organizations (id) on delete restrict,
  event_type app_private.trader_organization_admin_event_type not null,
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  actor_membership_id uuid not null references app_private.organization_memberships (id) on delete restrict,
  actor_buyer_organization_id uuid not null references app_private.organizations (id) on delete restrict,
  actor_role app_private.membership_role not null check (actor_role = 'buyer_admin'::app_private.membership_role),
  occurred_at timestamptz not null default clock_timestamp(),
  before_snapshot jsonb null,
  after_snapshot jsonb not null,
  constraint trader_organization_admin_audit_snapshot_shape check (
    jsonb_typeof(after_snapshot) = 'object'
    and after_snapshot ?& array['organization_id', 'organization_label', 'organization_status']
    and (after_snapshot - array['organization_id', 'organization_label', 'organization_status']::text[]) = '{}'::jsonb
    and jsonb_typeof(after_snapshot -> 'organization_id') = 'string'
    and jsonb_typeof(after_snapshot -> 'organization_label') = 'string'
    and jsonb_typeof(after_snapshot -> 'organization_status') = 'string'
    and length(after_snapshot ->> 'organization_label') between 1 and 120
    and after_snapshot ->> 'organization_status' in ('active', 'inactive', 'suspended')
    and (
      before_snapshot is null
      or (
        jsonb_typeof(before_snapshot) = 'object'
        and before_snapshot ?& array['organization_id', 'organization_label', 'organization_status']
        and (before_snapshot - array['organization_id', 'organization_label', 'organization_status']::text[]) = '{}'::jsonb
        and jsonb_typeof(before_snapshot -> 'organization_id') = 'string'
        and jsonb_typeof(before_snapshot -> 'organization_label') = 'string'
        and jsonb_typeof(before_snapshot -> 'organization_status') = 'string'
        and length(before_snapshot ->> 'organization_label') between 1 and 120
        and before_snapshot ->> 'organization_status' in ('active', 'inactive', 'suspended')
      )
    )
    and (
      (event_type = 'created'::app_private.trader_organization_admin_event_type
        and before_snapshot is null
        and after_snapshot ->> 'organization_status' = 'active')
      or
      (event_type = 'deactivated'::app_private.trader_organization_admin_event_type
        and before_snapshot ->> 'organization_status' = 'active'
        and after_snapshot ->> 'organization_status' = 'inactive')
    )
  ),
  unique (trader_organization_id, event_type)
);

alter table app_private.trader_organization_admin_audit_events enable row level security;
revoke all on table app_private.trader_organization_admin_audit_events from public, anon, authenticated;

create function app_private.reject_trader_organization_admin_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'TRADER organization administration audit is append-only';
end;
$$;

create trigger reject_trader_organization_admin_audit_mutation
before update or delete on app_private.trader_organization_admin_audit_events
for each row execute function app_private.reject_trader_organization_admin_audit_mutation();

create function app_private.require_active_buyer_admin_actor(p_actor_membership_id uuid)
returns table (
  user_id uuid,
  membership_id uuid,
  organization_id uuid,
  membership_role app_private.membership_role
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'An active BUYER administrator membership is required';
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
    and membership.role = 'buyer_admin'::app_private.membership_role;

  if not found then
    raise exception using errcode = '42501', message = 'An active BUYER administrator membership is required';
  end if;
end;
$$;

create function app_private.trader_organization_admin_snapshot(
  p_trader_organization app_private.organizations
)
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'organization_id', p_trader_organization.id,
    'organization_label', left(btrim(p_trader_organization.name), 120),
    'organization_status', p_trader_organization.status::text
  );
$$;

create function app_private.append_trader_organization_admin_audit(
  p_trader_organization app_private.organizations,
  p_event_type app_private.trader_organization_admin_event_type,
  p_actor_user_id uuid,
  p_actor_membership_id uuid,
  p_actor_buyer_organization_id uuid,
  p_actor_role app_private.membership_role,
  p_before_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app_private.trader_organization_admin_audit_events (
    trader_organization_id,
    event_type,
    actor_user_id,
    actor_membership_id,
    actor_buyer_organization_id,
    actor_role,
    before_snapshot,
    after_snapshot
  ) values (
    p_trader_organization.id,
    p_event_type,
    p_actor_user_id,
    p_actor_membership_id,
    p_actor_buyer_organization_id,
    p_actor_role,
    p_before_snapshot,
    app_private.trader_organization_admin_snapshot(p_trader_organization)
  );
end;
$$;

create function public.list_trader_organizations_for_admin(p_actor_membership_id uuid)
returns table (
  organization_id uuid,
  organization_label text,
  organization_status text,
  active_trader_membership_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_active_buyer_admin_actor(p_actor_membership_id);

  return query
  select
    organization.id,
    btrim(organization.name),
    organization.status::text,
    count(membership.id) filter (
      where membership.status = 'active'::app_private.membership_status
        and membership.role = 'trader'::app_private.membership_role
    )::bigint,
    organization.created_at,
    organization.updated_at
  from app_private.organizations as organization
  left join app_private.organization_memberships as membership
    on membership.organization_id = organization.id
  where organization.kind = 'trader'::app_private.organization_kind
  group by organization.id
  order by lower(btrim(organization.name)), organization.id;
end;
$$;

create function public.create_trader_organization(
  p_actor_membership_id uuid,
  p_organization_name text
)
returns table (
  organization_id uuid,
  organization_label text,
  organization_status text,
  active_trader_membership_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_name text;
  v_organization app_private.organizations%rowtype;
begin
  select * into v_actor
  from app_private.require_active_buyer_admin_actor(p_actor_membership_id);

  v_name := btrim(p_organization_name);
  if v_name is null or v_name = '' then
    raise exception using errcode = '22023', message = 'SELLER organization name is required';
  end if;
  if char_length(v_name) > 120 then
    raise exception using errcode = '22023', message = 'SELLER organization name must be at most 120 characters';
  end if;

  insert into app_private.organizations (kind, name, status)
  values ('trader'::app_private.organization_kind, v_name, 'active'::app_private.organization_status)
  returning * into v_organization;

  perform app_private.append_trader_organization_admin_audit(
    v_organization,
    'created'::app_private.trader_organization_admin_event_type,
    v_actor.user_id,
    v_actor.membership_id,
    v_actor.organization_id,
    v_actor.membership_role,
    null
  );
  perform app_private.send_workspace_changed('workspace:buyer');

  return query select
    v_organization.id,
    btrim(v_organization.name),
    v_organization.status::text,
    0::bigint,
    v_organization.created_at,
    v_organization.updated_at;
end;
$$;

create function public.deactivate_trader_organization(
  p_actor_membership_id uuid,
  p_trader_organization_id uuid
)
returns table (
  organization_id uuid,
  organization_label text,
  organization_status text,
  active_trader_membership_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_organization app_private.organizations%rowtype;
  v_before_snapshot jsonb;
  v_active_members bigint;
begin
  select * into v_actor
  from app_private.require_active_buyer_admin_actor(p_actor_membership_id);

  select * into v_organization
  from app_private.organizations as organization
  where organization.id = p_trader_organization_id
  for update;

  if not found or v_organization.kind <> 'trader'::app_private.organization_kind then
    raise exception using errcode = '22023', message = 'Target organization must be a TRADER organization';
  end if;
  if v_organization.status = 'suspended'::app_private.organization_status then
    raise exception using errcode = '55000', message = 'Suspended SELLER organizations cannot be deactivated';
  end if;

  if v_organization.status = 'active'::app_private.organization_status then
    v_before_snapshot := app_private.trader_organization_admin_snapshot(v_organization);
    update app_private.organizations
    set status = 'inactive'::app_private.organization_status
    where id = v_organization.id
    returning * into v_organization;

    perform app_private.append_trader_organization_admin_audit(
      v_organization,
      'deactivated'::app_private.trader_organization_admin_event_type,
      v_actor.user_id,
      v_actor.membership_id,
      v_actor.organization_id,
      v_actor.membership_role,
      v_before_snapshot
    );
  end if;

  select count(membership.id)::bigint into v_active_members
  from app_private.organization_memberships as membership
  where membership.organization_id = v_organization.id
    and membership.status = 'active'::app_private.membership_status
    and membership.role = 'trader'::app_private.membership_role;

  return query select
    v_organization.id,
    btrim(v_organization.name),
    v_organization.status::text,
    v_active_members,
    v_organization.created_at,
    v_organization.updated_at;
end;
$$;

revoke all on function app_private.reject_trader_organization_admin_audit_mutation() from public, anon, authenticated;
revoke all on function app_private.require_active_buyer_admin_actor(uuid) from public, anon, authenticated;
revoke all on function app_private.trader_organization_admin_snapshot(app_private.organizations) from public, anon, authenticated;
revoke all on function app_private.append_trader_organization_admin_audit(app_private.organizations,app_private.trader_organization_admin_event_type,uuid,uuid,uuid,app_private.membership_role,jsonb) from public, anon, authenticated;
revoke all on function public.list_trader_organizations_for_admin(uuid) from public, anon, authenticated;
revoke all on function public.create_trader_organization(uuid,text) from public, anon, authenticated;
revoke all on function public.deactivate_trader_organization(uuid,uuid) from public, anon, authenticated;

grant execute on function public.list_trader_organizations_for_admin(uuid) to authenticated;
grant execute on function public.create_trader_organization(uuid,text) to authenticated;
grant execute on function public.deactivate_trader_organization(uuid,uuid) to authenticated;
