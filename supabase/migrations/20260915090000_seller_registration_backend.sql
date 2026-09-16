create type app_private.seller_registration_source as enum ('self_signup', 'invited');
create type app_private.seller_registration_status as enum ('pending', 'approved', 'rejected');
create type app_private.seller_registration_audit_event_type as enum ('submitted', 'approved', 'rejected');

create table app_private.seller_registration_requests (
  id uuid primary key default gen_random_uuid(),
  applicant_user_id uuid not null references auth.users(id) on delete restrict,
  source app_private.seller_registration_source not null,
  requested_organization_name text not null,
  status app_private.seller_registration_status not null default 'pending',
  revision integer not null default 1 check (revision >= 1),
  submitted_at timestamptz not null default timezone('utc', now()),
  decided_at timestamptz,
  decided_by_user_id uuid references auth.users(id) on delete restrict,
  decided_by_membership_id uuid references app_private.organization_memberships(id) on delete restrict,
  decided_by_buyer_organization_id uuid references app_private.organizations(id) on delete restrict,
  mapped_trader_organization_id uuid references app_private.organizations(id) on delete restrict,
  constraint seller_registration_requested_name_valid check (
    requested_organization_name = btrim(requested_organization_name)
    and requested_organization_name <> ''
    and char_length(requested_organization_name) <= 120
  ),
  constraint seller_registration_state_shape check (
    (status = 'pending' and decided_at is null and decided_by_user_id is null and decided_by_membership_id is null and decided_by_buyer_organization_id is null and mapped_trader_organization_id is null)
    or (status = 'rejected' and decided_at is not null and decided_by_user_id is not null and decided_by_membership_id is not null and decided_by_buyer_organization_id is not null and mapped_trader_organization_id is null)
    or (status = 'approved' and decided_at is not null and decided_by_user_id is not null and decided_by_membership_id is not null and decided_by_buyer_organization_id is not null and mapped_trader_organization_id is not null)
  )
);

create unique index seller_registration_one_pending_per_applicant
  on app_private.seller_registration_requests(applicant_user_id)
  where status = 'pending'::app_private.seller_registration_status;

create table app_private.seller_registration_audit_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references app_private.seller_registration_requests(id) on delete restrict,
  applicant_user_id uuid not null references auth.users(id) on delete restrict,
  event_type app_private.seller_registration_audit_event_type not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_membership_id uuid references app_private.organization_memberships(id) on delete restrict,
  actor_buyer_organization_id uuid references app_private.organizations(id) on delete restrict,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint seller_registration_audit_actor_shape check (
    (event_type = 'submitted' and actor_user_id = applicant_user_id and actor_membership_id is null and actor_buyer_organization_id is null)
    or (event_type in ('approved', 'rejected') and actor_membership_id is not null and actor_buyer_organization_id is not null)
  )
);

alter table app_private.seller_registration_requests enable row level security;
alter table app_private.seller_registration_audit_events enable row level security;
revoke all on table app_private.seller_registration_requests from public, anon, authenticated;
revoke all on table app_private.seller_registration_audit_events from public, anon, authenticated;

create function app_private.seller_registration_snapshot(p_request app_private.seller_registration_requests)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'request_id', p_request.id, 'applicant_user_id', p_request.applicant_user_id,
    'source', p_request.source::text, 'requested_organization_name', p_request.requested_organization_name,
    'status', p_request.status::text, 'revision', p_request.revision,
    'submitted_at', p_request.submitted_at, 'decided_at', p_request.decided_at,
    'mapped_trader_organization_id', p_request.mapped_trader_organization_id
  );
$$;

create function app_private.append_seller_registration_audit(
  p_request app_private.seller_registration_requests,
  p_event_type app_private.seller_registration_audit_event_type,
  p_actor_user_id uuid,
  p_actor_membership_id uuid,
  p_actor_buyer_organization_id uuid,
  p_before_snapshot jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into app_private.seller_registration_audit_events (
    request_id, applicant_user_id, event_type, actor_user_id, actor_membership_id,
    actor_buyer_organization_id, before_snapshot, after_snapshot
  ) values (
    p_request.id, p_request.applicant_user_id, p_event_type, p_actor_user_id,
    p_actor_membership_id, p_actor_buyer_organization_id, p_before_snapshot,
    app_private.seller_registration_snapshot(p_request)
  );
end;
$$;

create function app_private.reject_seller_registration_audit_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'SELLER registration audit is append-only';
end;
$$;
create trigger reject_seller_registration_audit_mutation before update or delete
on app_private.seller_registration_audit_events for each row
execute function app_private.reject_seller_registration_audit_mutation();

create function public.submit_seller_registration_request(p_requested_organization_name text)
returns table (request_id uuid, source text, requested_organization_name text, status text, revision integer, submitted_at timestamptz, decided_at timestamptz, mapped_trader_organization_id uuid)
language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_account app_private.user_accounts%rowtype; v_request app_private.seller_registration_requests%rowtype; v_name text; v_source app_private.seller_registration_source;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication is required'; end if;
  v_name := btrim(p_requested_organization_name);
  if v_name is null or v_name = '' or char_length(v_name) > 120 then raise exception using errcode = '22023', message = 'Requested organization name must be between 1 and 120 characters'; end if;
  select * into v_account from app_private.user_accounts where user_id = v_user_id for update;
  if not found or v_account.status <> 'inactive'::app_private.account_status then raise exception using errcode = '55000', message = 'Only inactive accounts may submit a SELLER registration'; end if;
  select case when invited_at is not null then 'invited'::app_private.seller_registration_source else 'self_signup'::app_private.seller_registration_source end into v_source from auth.users where id = v_user_id and email_confirmed_at is not null;
  if not found then raise exception using errcode = '55000', message = 'A confirmed email is required'; end if;
  if exists (select 1 from app_private.organization_memberships where user_id = v_user_id) then raise exception using errcode = '55000', message = 'Users with memberships cannot submit a SELLER registration'; end if;
  select registration.* into v_request
  from app_private.seller_registration_requests as registration
  where registration.applicant_user_id = v_user_id
    and registration.status = 'pending'::app_private.seller_registration_status
  for update;
  if found then
    if v_request.requested_organization_name = v_name then return query select v_request.id, v_request.source::text, v_request.requested_organization_name, v_request.status::text, v_request.revision, v_request.submitted_at, v_request.decided_at, v_request.mapped_trader_organization_id; return; end if;
    raise exception using errcode = '55000', message = 'A different SELLER registration is already pending';
  end if;
  insert into app_private.seller_registration_requests(applicant_user_id, source, requested_organization_name) values (v_user_id, v_source, v_name) returning * into v_request;
  perform app_private.append_seller_registration_audit(v_request, 'submitted'::app_private.seller_registration_audit_event_type, v_user_id, null, null, '{}'::jsonb);
  perform app_private.send_workspace_changed('workspace:buyer');
  return query select v_request.id, v_request.source::text, v_request.requested_organization_name, v_request.status::text, v_request.revision, v_request.submitted_at, v_request.decided_at, v_request.mapped_trader_organization_id;
end;
$$;

create function public.get_my_seller_registration_request()
returns table (request_id uuid, source text, requested_organization_name text, status text, revision integer, submitted_at timestamptz, decided_at timestamptz, mapped_trader_organization_id uuid)
language sql stable security definer set search_path = '' as $$
  select request.id, request.source::text, request.requested_organization_name, request.status::text, request.revision, request.submitted_at, request.decided_at, request.mapped_trader_organization_id
  from app_private.seller_registration_requests as request
  where request.applicant_user_id = auth.uid()
  order by request.submitted_at desc, request.id desc limit 1;
$$;

create function public.list_seller_registration_requests_for_admin(p_actor_membership_id uuid)
returns table (request_id uuid, applicant_user_id uuid, applicant_email text, source text, requested_organization_name text, revision integer, submitted_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform 1 from app_private.require_active_buyer_admin_actor(p_actor_membership_id);
  return query select request.id, request.applicant_user_id, users.email::text, request.source::text, request.requested_organization_name, request.revision, request.submitted_at
  from app_private.seller_registration_requests request join auth.users users on users.id = request.applicant_user_id
  where request.status = 'pending'::app_private.seller_registration_status order by request.submitted_at, request.id;
end;
$$;

create function public.approve_seller_registration_request(p_actor_membership_id uuid, p_request_id uuid, p_expected_revision integer, p_trader_organization_id uuid)
returns table (request_id uuid, source text, requested_organization_name text, status text, revision integer, submitted_at timestamptz, decided_at timestamptz, mapped_trader_organization_id uuid)
language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_request app_private.seller_registration_requests%rowtype; v_account app_private.user_accounts%rowtype; v_organization app_private.organizations%rowtype; v_before jsonb;
begin
  select * into v_actor from app_private.require_active_buyer_admin_actor(p_actor_membership_id);
  select * into v_request from app_private.seller_registration_requests where id = p_request_id;
  if not found then raise exception using errcode = '40001', message = 'SELLER registration changed; reload and try again'; end if;
  select * into v_account from app_private.user_accounts where user_id = v_request.applicant_user_id for update;
  select * into v_request from app_private.seller_registration_requests where id = p_request_id for update;
  if v_request.status <> 'pending'::app_private.seller_registration_status or v_request.revision is distinct from p_expected_revision then raise exception using errcode = '40001', message = 'SELLER registration changed; reload and try again'; end if;
  if v_account.status <> 'inactive'::app_private.account_status or not exists (select 1 from auth.users where id = v_request.applicant_user_id and email_confirmed_at is not null) or exists (select 1 from app_private.organization_memberships where user_id = v_request.applicant_user_id) then raise exception using errcode = '55000', message = 'Applicant is no longer eligible for approval'; end if;
  select * into v_organization from app_private.organizations where id = p_trader_organization_id for update;
  if not found or v_organization.kind <> 'trader'::app_private.organization_kind or v_organization.status <> 'active'::app_private.organization_status then raise exception using errcode = '22023', message = 'Target must be an active TRADER organization'; end if;
  v_before := app_private.seller_registration_snapshot(v_request);
  insert into app_private.organization_memberships(user_id, organization_id, role, status) values (v_request.applicant_user_id, v_organization.id, 'trader'::app_private.membership_role, 'active'::app_private.membership_status);
  update app_private.user_accounts set status = 'active'::app_private.account_status where user_id = v_request.applicant_user_id;
  update app_private.seller_registration_requests as registration
  set status = 'approved'::app_private.seller_registration_status,
      revision = registration.revision + 1,
      decided_at = timezone('utc', now()),
      decided_by_user_id = v_actor.user_id,
      decided_by_membership_id = v_actor.membership_id,
      decided_by_buyer_organization_id = v_actor.organization_id,
      mapped_trader_organization_id = v_organization.id
  where registration.id = v_request.id
  returning registration.* into v_request;
  perform app_private.append_seller_registration_audit(v_request, 'approved'::app_private.seller_registration_audit_event_type, v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_before);
  perform app_private.send_workspace_changed('workspace:buyer'); perform app_private.send_access_changed(v_request.applicant_user_id);
  return query select v_request.id, v_request.source::text, v_request.requested_organization_name, v_request.status::text, v_request.revision, v_request.submitted_at, v_request.decided_at, v_request.mapped_trader_organization_id;
end;
$$;

create function public.reject_seller_registration_request(p_actor_membership_id uuid, p_request_id uuid, p_expected_revision integer)
returns table (request_id uuid, source text, requested_organization_name text, status text, revision integer, submitted_at timestamptz, decided_at timestamptz, mapped_trader_organization_id uuid)
language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_request app_private.seller_registration_requests%rowtype; v_account app_private.user_accounts%rowtype; v_before jsonb;
begin
  select * into v_actor from app_private.require_active_buyer_admin_actor(p_actor_membership_id);
  select * into v_request from app_private.seller_registration_requests where id = p_request_id;
  if not found then raise exception using errcode = '40001', message = 'SELLER registration changed; reload and try again'; end if;
  select * into v_account from app_private.user_accounts where user_id = v_request.applicant_user_id for update;
  select * into v_request from app_private.seller_registration_requests where id = p_request_id for update;
  if v_request.status <> 'pending'::app_private.seller_registration_status or v_request.revision is distinct from p_expected_revision then raise exception using errcode = '40001', message = 'SELLER registration changed; reload and try again'; end if;
  v_before := app_private.seller_registration_snapshot(v_request);
  update app_private.seller_registration_requests as registration
  set status = 'rejected'::app_private.seller_registration_status,
      revision = registration.revision + 1,
      decided_at = timezone('utc', now()),
      decided_by_user_id = v_actor.user_id,
      decided_by_membership_id = v_actor.membership_id,
      decided_by_buyer_organization_id = v_actor.organization_id
  where registration.id = v_request.id
  returning registration.* into v_request;
  perform app_private.append_seller_registration_audit(v_request, 'rejected'::app_private.seller_registration_audit_event_type, v_actor.user_id, v_actor.membership_id, v_actor.organization_id, v_before);
  perform app_private.send_workspace_changed('workspace:buyer'); perform app_private.send_access_changed(v_request.applicant_user_id);
  return query select v_request.id, v_request.source::text, v_request.requested_organization_name, v_request.status::text, v_request.revision, v_request.submitted_at, v_request.decided_at, v_request.mapped_trader_organization_id;
end;
$$;

create function public.authorize_seller_registration_invite(p_actor_membership_id uuid)
returns table (status text) language plpgsql stable security definer set search_path = '' as $$
begin
  perform 1 from app_private.require_active_buyer_admin_actor(p_actor_membership_id);
  return query select 'authorized'::text;
end;
$$;

revoke all on function app_private.seller_registration_snapshot(app_private.seller_registration_requests) from public, anon, authenticated;
revoke all on function app_private.append_seller_registration_audit(app_private.seller_registration_requests,app_private.seller_registration_audit_event_type,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function app_private.reject_seller_registration_audit_mutation() from public, anon, authenticated;
revoke all on function public.submit_seller_registration_request(text) from public, anon;
revoke all on function public.get_my_seller_registration_request() from public, anon;
revoke all on function public.list_seller_registration_requests_for_admin(uuid) from public, anon;
revoke all on function public.approve_seller_registration_request(uuid,uuid,integer,uuid) from public, anon;
revoke all on function public.reject_seller_registration_request(uuid,uuid,integer) from public, anon;
revoke all on function public.authorize_seller_registration_invite(uuid) from public, anon;
grant execute on function public.submit_seller_registration_request(text) to authenticated;
grant execute on function public.get_my_seller_registration_request() to authenticated;
grant execute on function public.list_seller_registration_requests_for_admin(uuid) to authenticated;
grant execute on function public.approve_seller_registration_request(uuid,uuid,integer,uuid) to authenticated;
grant execute on function public.reject_seller_registration_request(uuid,uuid,integer) to authenticated;
grant execute on function public.authorize_seller_registration_invite(uuid) to authenticated;
