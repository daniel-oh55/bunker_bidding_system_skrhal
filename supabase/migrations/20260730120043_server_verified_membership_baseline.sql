create schema if not exists app_private;

create type app_private.account_status as enum ('inactive', 'active', 'suspended');
create type app_private.organization_kind as enum ('buyer', 'trader');
create type app_private.organization_status as enum ('inactive', 'active', 'suspended');
create type app_private.membership_role as enum ('buyer_admin', 'buyer_operator', 'trader');
create type app_private.membership_status as enum ('inactive', 'active', 'suspended');

create table app_private.user_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status app_private.account_status not null default 'inactive',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table app_private.organizations (
  id uuid primary key default gen_random_uuid(),
  kind app_private.organization_kind not null,
  name text not null check (btrim(name) <> ''),
  status app_private.organization_status not null default 'inactive',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table app_private.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null references app_private.organizations (id) on delete cascade,
  role app_private.membership_role not null,
  status app_private.membership_status not null default 'inactive',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, organization_id)
);

create function app_private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create trigger set_user_accounts_updated_at
before update on app_private.user_accounts
for each row execute function app_private.set_updated_at();

create trigger set_organizations_updated_at
before update on app_private.organizations
for each row execute function app_private.set_updated_at();

create trigger set_organization_memberships_updated_at
before update on app_private.organization_memberships
for each row execute function app_private.set_updated_at();

create function app_private.create_inactive_user_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app_private.user_accounts (user_id, status)
  values (new.id, 'inactive'::app_private.account_status)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger create_inactive_user_account_after_auth_user_insert
after insert on auth.users
for each row execute function app_private.create_inactive_user_account();

insert into app_private.user_accounts (user_id, status)
select id, 'inactive'::app_private.account_status
from auth.users
on conflict (user_id) do nothing;

create function app_private.enforce_membership_role_organization_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from app_private.organizations as organization
    where organization.id = new.organization_id
      and (
        (organization.kind = 'buyer'::app_private.organization_kind
          and new.role in ('buyer_admin'::app_private.membership_role, 'buyer_operator'::app_private.membership_role))
        or (organization.kind = 'trader'::app_private.organization_kind
          and new.role = 'trader'::app_private.membership_role)
      )
  ) then
    raise exception 'Membership role % is incompatible with organization %', new.role, new.organization_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger enforce_membership_role_organization_kind
before insert or update of organization_id, role on app_private.organization_memberships
for each row execute function app_private.enforce_membership_role_organization_kind();

alter table app_private.user_accounts enable row level security;
alter table app_private.organizations enable row level security;
alter table app_private.organization_memberships enable row level security;

revoke all on schema app_private from public, anon, authenticated;
revoke all on table app_private.user_accounts from public, anon, authenticated;
revoke all on table app_private.organizations from public, anon, authenticated;
revoke all on table app_private.organization_memberships from public, anon, authenticated;

create function app_private.current_access_context_impl()
returns table (
  membership_id uuid,
  organization_id uuid,
  organization_kind text,
  membership_role text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    membership.id,
    organization.id,
    organization.kind::text,
    membership.role::text
  from app_private.user_accounts as account
  join app_private.organization_memberships as membership
    on membership.user_id = account.user_id
  join app_private.organizations as organization
    on organization.id = membership.organization_id
  where account.user_id = auth.uid()
    and account.status = 'active'::app_private.account_status
    and organization.status = 'active'::app_private.organization_status
    and membership.status = 'active'::app_private.membership_status;
$$;

create function public.current_access_context()
returns table (
  membership_id uuid,
  organization_id uuid,
  organization_kind text,
  membership_role text
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from app_private.current_access_context_impl();
$$;

revoke all on function app_private.set_updated_at() from public, anon, authenticated;
revoke all on function app_private.create_inactive_user_account() from public, anon, authenticated;
revoke all on function app_private.enforce_membership_role_organization_kind() from public, anon, authenticated;
revoke all on function app_private.current_access_context_impl() from public, anon, authenticated;
revoke all on function public.current_access_context() from public, anon;
grant usage on schema public to authenticated;
grant execute on function public.current_access_context() to authenticated;
