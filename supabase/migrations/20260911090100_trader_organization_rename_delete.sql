-- SELLER administration evolution: preserve an append-only tombstone after a
-- completely unused TRADER organization is physically deleted.

do $$
declare
  v_constraint name;
begin
  select key_column_usage.constraint_name into v_constraint
  from information_schema.table_constraints as table_constraint
  join information_schema.key_column_usage as key_column_usage
    on key_column_usage.constraint_schema = table_constraint.constraint_schema
   and key_column_usage.constraint_name = table_constraint.constraint_name
  where table_constraint.table_schema = 'app_private'
    and table_constraint.table_name = 'trader_organization_admin_audit_events'
    and table_constraint.constraint_type = 'UNIQUE'
    and key_column_usage.column_name = 'trader_organization_id';

  if v_constraint is null then
    raise exception 'Expected original TRADER organization audit unique constraint is missing';
  end if;
  execute format('alter table app_private.trader_organization_admin_audit_events drop constraint %I', v_constraint);

  select key_column_usage.constraint_name into v_constraint
  from information_schema.table_constraints as table_constraint
  join information_schema.key_column_usage as key_column_usage
    on key_column_usage.constraint_schema = table_constraint.constraint_schema
   and key_column_usage.constraint_name = table_constraint.constraint_name
  where table_constraint.table_schema = 'app_private'
    and table_constraint.table_name = 'trader_organization_admin_audit_events'
    and table_constraint.constraint_type = 'FOREIGN KEY'
    and key_column_usage.column_name = 'trader_organization_id';

  if v_constraint is null then
    raise exception 'Expected TRADER organization audit foreign key is missing';
  end if;
  execute format('alter table app_private.trader_organization_admin_audit_events drop constraint %I', v_constraint);
end;
$$;

alter table app_private.trader_organization_admin_audit_events
  drop constraint trader_organization_admin_audit_snapshot_shape,
  alter column after_snapshot drop not null;

create function app_private.is_trader_organization_admin_snapshot(p_snapshot jsonb)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select p_snapshot is not null
    and jsonb_typeof(p_snapshot) = 'object'
    and p_snapshot ?& array['organization_id', 'organization_label', 'organization_status']
    and (p_snapshot - array['organization_id', 'organization_label', 'organization_status']::text[]) = '{}'::jsonb
    and jsonb_typeof(p_snapshot -> 'organization_id') = 'string'
    and jsonb_typeof(p_snapshot -> 'organization_label') = 'string'
    and jsonb_typeof(p_snapshot -> 'organization_status') = 'string'
    and length(p_snapshot ->> 'organization_label') between 1 and 120
    and p_snapshot ->> 'organization_status' in ('active', 'inactive', 'suspended');
$$;

alter table app_private.trader_organization_admin_audit_events
  add constraint trader_organization_admin_audit_snapshot_shape check (
    (
      event_type = 'created'::app_private.trader_organization_admin_event_type
      and before_snapshot is null
      and app_private.is_trader_organization_admin_snapshot(after_snapshot)
      and after_snapshot ->> 'organization_status' = 'active'
    )
    or (
      event_type = 'deactivated'::app_private.trader_organization_admin_event_type
      and app_private.is_trader_organization_admin_snapshot(before_snapshot)
      and app_private.is_trader_organization_admin_snapshot(after_snapshot)
      and before_snapshot ->> 'organization_id' = after_snapshot ->> 'organization_id'
      and before_snapshot ->> 'organization_status' = 'active'
      and after_snapshot ->> 'organization_status' = 'inactive'
    )
    or (
      event_type = 'renamed'::app_private.trader_organization_admin_event_type
      and app_private.is_trader_organization_admin_snapshot(before_snapshot)
      and app_private.is_trader_organization_admin_snapshot(after_snapshot)
      and before_snapshot ->> 'organization_id' = after_snapshot ->> 'organization_id'
      and before_snapshot ->> 'organization_status' = after_snapshot ->> 'organization_status'
      and before_snapshot ->> 'organization_label' is distinct from after_snapshot ->> 'organization_label'
    )
    or (
      event_type = 'deleted'::app_private.trader_organization_admin_event_type
      and app_private.is_trader_organization_admin_snapshot(before_snapshot)
      and after_snapshot is null
    )
  );

create index trader_organization_admin_audit_trader_organization_idx
on app_private.trader_organization_admin_audit_events (trader_organization_id);
create unique index trader_organization_admin_audit_created_uidx
on app_private.trader_organization_admin_audit_events (trader_organization_id)
where event_type = 'created'::app_private.trader_organization_admin_event_type;
create unique index trader_organization_admin_audit_deactivated_uidx
on app_private.trader_organization_admin_audit_events (trader_organization_id)
where event_type = 'deactivated'::app_private.trader_organization_admin_event_type;
create unique index trader_organization_admin_audit_deleted_uidx
on app_private.trader_organization_admin_audit_events (trader_organization_id)
where event_type = 'deleted'::app_private.trader_organization_admin_event_type;

create or replace function app_private.append_trader_organization_admin_audit(
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
    case when p_event_type = 'deleted'::app_private.trader_organization_admin_event_type
      then null
      else app_private.trader_organization_admin_snapshot(p_trader_organization)
    end
  );
end;
$$;

create function public.rename_trader_organization(
  p_actor_membership_id uuid,
  p_trader_organization_id uuid,
  p_expected_organization_label text,
  p_expected_organization_status text,
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
  v_organization app_private.organizations%rowtype;
  v_before_snapshot jsonb;
  v_name text;
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
  if btrim(v_organization.name) is distinct from p_expected_organization_label
    or v_organization.status::text is distinct from p_expected_organization_status then
    raise exception using errcode = '40001', message = 'SELLER organization changed; reload and try again';
  end if;

  v_name := btrim(p_organization_name);
  if v_name is null or v_name = '' then
    raise exception using errcode = '22023', message = 'SELLER organization name is required';
  end if;
  if char_length(v_name) > 120 then
    raise exception using errcode = '22023', message = 'SELLER organization name must be at most 120 characters';
  end if;

  if lower(v_name) <> lower(btrim(v_organization.name)) then
    v_before_snapshot := app_private.trader_organization_admin_snapshot(v_organization);
    update app_private.organizations
    set name = v_name
    where id = v_organization.id
    returning * into v_organization;

    perform app_private.append_trader_organization_admin_audit(
      v_organization,
      'renamed'::app_private.trader_organization_admin_event_type,
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

create function public.delete_trader_organization(
  p_actor_membership_id uuid,
  p_trader_organization_id uuid,
  p_expected_organization_label text,
  p_expected_organization_status text
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
  if btrim(v_organization.name) is distinct from p_expected_organization_label
    or v_organization.status::text is distinct from p_expected_organization_status then
    raise exception using errcode = '40001', message = 'SELLER organization changed; reload and try again';
  end if;

  if exists (select 1 from app_private.organization_memberships as membership where membership.organization_id = v_organization.id)
    or exists (select 1 from app_private.bid_trader_organization_access as bid_access where bid_access.trader_organization_id = v_organization.id)
    or exists (select 1 from app_private.bid_trader_organization_responses as response where response.trader_organization_id = v_organization.id)
    or exists (select 1 from app_private.quotes as quote where quote.trader_organization_id = v_organization.id)
    or exists (select 1 from app_private.quote_audit_events as quote_audit where quote_audit.trader_organization_id = v_organization.id or quote_audit.actor_organization_id = v_organization.id)
    or exists (select 1 from app_private.bid_trader_organization_response_audit_events as response_audit where response_audit.trader_organization_id = v_organization.id or response_audit.actor_organization_id = v_organization.id)
    or exists (select 1 from app_private.bid_audit_events as bid_audit where bid_audit.actor_organization_id = v_organization.id) then
    raise exception using errcode = '55000', message = 'SELLER organization has memberships or retained bidding history; deactivate it instead';
  end if;

  v_before_snapshot := app_private.trader_organization_admin_snapshot(v_organization);
  perform app_private.append_trader_organization_admin_audit(
    v_organization,
    'deleted'::app_private.trader_organization_admin_event_type,
    v_actor.user_id,
    v_actor.membership_id,
    v_actor.organization_id,
    v_actor.membership_role,
    v_before_snapshot
  );

  delete from app_private.organizations where id = v_organization.id;
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

revoke all on function app_private.is_trader_organization_admin_snapshot(jsonb) from public, anon, authenticated;
revoke all on function app_private.append_trader_organization_admin_audit(app_private.organizations,app_private.trader_organization_admin_event_type,uuid,uuid,uuid,app_private.membership_role,jsonb) from public, anon, authenticated;
revoke all on function public.rename_trader_organization(uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.delete_trader_organization(uuid,uuid,text,text) from public, anon, authenticated;

grant execute on function public.rename_trader_organization(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.delete_trader_organization(uuid,uuid,text,text) to authenticated;
