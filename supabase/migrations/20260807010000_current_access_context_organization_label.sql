drop function public.current_access_context();
drop function app_private.current_access_context_impl();

create function app_private.current_access_context_impl()
returns table (
  membership_id uuid,
  organization_id uuid,
  organization_kind text,
  membership_role text,
  organization_label text
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
    membership.role::text,
    btrim(organization.name)
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
  membership_role text,
  organization_label text
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from app_private.current_access_context_impl();
$$;

revoke all on function app_private.current_access_context_impl() from public, anon, authenticated;
revoke all on function public.current_access_context() from public, anon;
grant execute on function public.current_access_context() to authenticated;
