-- Provider-neutral, server-ingested normalized mail intake staging.
-- This queue is private, contains no raw message/address data, and never creates bids.

create type app_private.mail_intake_status as enum ('pending', 'dismissed');

create type app_private.mail_intake_api_result as (
  id uuid,
  received_at timestamptz,
  subject text,
  vessel_voyage text,
  port_name text,
  delivery_window text,
  fuel_items jsonb,
  warnings jsonb,
  status text,
  revision bigint,
  created_at timestamptz,
  updated_at timestamptz,
  dismissed_at timestamptz
);

create function app_private.mail_intake_fuel_items_are_valid(p_value jsonb)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_grade text;
  v_quantity numeric;
  v_grades text[] := array[]::text[];
begin
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 5 then
    return false;
  end if;

  for v_item in select value from jsonb_array_elements(p_value) as element(value)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ? 'grade')
       or not (v_item ? 'quantity')
       or (select count(*) from jsonb_object_keys(v_item)) <> 2
       or jsonb_typeof(v_item -> 'grade') <> 'string'
       or jsonb_typeof(v_item -> 'quantity') <> 'number' then
      return false;
    end if;

    v_grade := v_item ->> 'grade';
    if v_grade not in ('vlsfo', 'hsfo', 'ulsfo', 'lsfo', 'lsmgo')
       or v_grade = any(v_grades) then
      return false;
    end if;

    v_quantity := (v_item ->> 'quantity')::numeric;
    if v_quantity::text in ('NaN', 'Infinity', '-Infinity') or v_quantity <= 0 then
      return false;
    end if;

    v_grades := array_append(v_grades, v_grade);
  end loop;

  return true;
end;
$$;

create function app_private.mail_intake_warnings_are_valid(p_value jsonb)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  v_warning jsonb;
  v_text text;
begin
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 20 then
    return false;
  end if;

  for v_warning in select value from jsonb_array_elements(p_value) as element(value)
  loop
    if jsonb_typeof(v_warning) <> 'string' then
      return false;
    end if;

    v_text := v_warning #>> '{}';
    if btrim(v_text) = '' or char_length(v_text) > 300 then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create table app_private.mail_intake_items (
  id uuid primary key default gen_random_uuid(),
  source_provider text not null,
  source_mailbox_key text not null,
  source_message_id text not null,
  received_at timestamptz not null,
  subject text not null,
  vessel_voyage text null,
  port_name text null,
  delivery_window text null,
  fuel_items jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  status app_private.mail_intake_status not null default 'pending',
  revision bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  dismissed_at timestamptz null,
  dismissed_by_user_id uuid null references auth.users (id) on delete restrict,
  dismissed_by_membership_id uuid null references app_private.organization_memberships (id) on delete restrict,
  constraint mail_intake_items_source_provider_valid check (
    source_provider = btrim(source_provider)
    and source_provider ~ '^[a-z0-9_-]{1,32}$'
  ),
  constraint mail_intake_items_source_mailbox_key_valid check (
    source_mailbox_key = btrim(source_mailbox_key)
    and char_length(source_mailbox_key) between 1 and 128
    and source_mailbox_key !~ '@'
  ),
  constraint mail_intake_items_source_message_id_valid check (
    source_message_id = btrim(source_message_id)
    and char_length(source_message_id) between 1 and 512
  ),
  constraint mail_intake_items_received_at_finite check (isfinite(received_at)),
  constraint mail_intake_items_subject_valid check (
    subject = btrim(subject)
    and char_length(subject) <= 512
  ),
  constraint mail_intake_items_vessel_voyage_valid check (
    vessel_voyage is null
    or (vessel_voyage = btrim(vessel_voyage) and char_length(vessel_voyage) between 1 and 256)
  ),
  constraint mail_intake_items_port_name_valid check (
    port_name is null
    or (port_name = btrim(port_name) and char_length(port_name) between 1 and 256)
  ),
  constraint mail_intake_items_delivery_window_valid check (
    delivery_window is null
    or (delivery_window = btrim(delivery_window) and char_length(delivery_window) between 1 and 256)
  ),
  constraint mail_intake_items_fuel_items_valid check (
    app_private.mail_intake_fuel_items_are_valid(fuel_items)
  ),
  constraint mail_intake_items_warnings_valid check (
    app_private.mail_intake_warnings_are_valid(warnings)
  ),
  constraint mail_intake_items_revision_valid check (revision >= 1),
  constraint mail_intake_items_status_consistency check (
    (
      status = 'pending'::app_private.mail_intake_status
      and dismissed_at is null
      and dismissed_by_user_id is null
      and dismissed_by_membership_id is null
    )
    or (
      status = 'dismissed'::app_private.mail_intake_status
      and dismissed_at is not null
      and dismissed_by_user_id is not null
      and dismissed_by_membership_id is not null
    )
  ),
  constraint mail_intake_items_source_identity_key unique (
    source_provider,
    source_mailbox_key,
    source_message_id
  )
);

create function app_private.set_mail_intake_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

create trigger set_mail_intake_items_updated_at
before update on app_private.mail_intake_items
for each row execute function app_private.set_mail_intake_updated_at();

alter table app_private.mail_intake_items enable row level security;
revoke all on table app_private.mail_intake_items from public, anon, authenticated;

create function app_private.mail_intake_result(p_item_id uuid)
returns app_private.mail_intake_api_result
language sql
stable
security definer
set search_path = ''
as $$
  select row(
    item.id,
    item.received_at,
    item.subject,
    item.vessel_voyage,
    item.port_name,
    item.delivery_window,
    item.fuel_items,
    item.warnings,
    item.status::text,
    item.revision,
    item.created_at,
    item.updated_at,
    item.dismissed_at
  )::app_private.mail_intake_api_result
  from app_private.mail_intake_items as item
  where item.id = p_item_id;
$$;

create function public.ingest_mail_intake_item(
  p_source_provider text,
  p_source_mailbox_key text,
  p_source_message_id text,
  p_received_at timestamptz,
  p_subject text,
  p_vessel_voyage text default null,
  p_port_name text default null,
  p_delivery_window text default null,
  p_fuel_items jsonb default '[]'::jsonb,
  p_warnings jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_provider text := btrim(p_source_provider);
  v_source_mailbox_key text := btrim(p_source_mailbox_key);
  v_source_message_id text := btrim(p_source_message_id);
  v_subject text := btrim(p_subject);
  v_vessel_voyage text := nullif(btrim(p_vessel_voyage), '');
  v_port_name text := nullif(btrim(p_port_name), '');
  v_delivery_window text := nullif(btrim(p_delivery_window), '');
  v_item_id uuid;
begin
  if v_source_provider is null or v_source_provider !~ '^[a-z0-9_-]{1,32}$' then
    raise exception using errcode = '22023', message = 'source_provider is invalid';
  end if;

  if v_source_mailbox_key is null
     or char_length(v_source_mailbox_key) not between 1 and 128
     or v_source_mailbox_key ~ '@' then
    raise exception using errcode = '22023', message = 'source_mailbox_key is invalid';
  end if;

  if v_source_message_id is null or char_length(v_source_message_id) not between 1 and 512 then
    raise exception using errcode = '22023', message = 'source_message_id is invalid';
  end if;

  if p_received_at is null or not isfinite(p_received_at) then
    raise exception using errcode = '22023', message = 'received_at is invalid';
  end if;

  if p_subject is null or char_length(v_subject) > 512 then
    raise exception using errcode = '22023', message = 'subject is invalid';
  end if;

  if (p_vessel_voyage is not null and v_vessel_voyage is null)
     or char_length(v_vessel_voyage) > 256 then
    raise exception using errcode = '22023', message = 'vessel_voyage is invalid';
  end if;

  if (p_port_name is not null and v_port_name is null)
     or char_length(v_port_name) > 256 then
    raise exception using errcode = '22023', message = 'port_name is invalid';
  end if;

  if (p_delivery_window is not null and v_delivery_window is null)
     or char_length(v_delivery_window) > 256 then
    raise exception using errcode = '22023', message = 'delivery_window is invalid';
  end if;

  if app_private.mail_intake_fuel_items_are_valid(p_fuel_items) is not true then
    raise exception using errcode = '22023', message = 'fuel_items is invalid';
  end if;

  if app_private.mail_intake_warnings_are_valid(p_warnings) is not true then
    raise exception using errcode = '22023', message = 'warnings is invalid';
  end if;

  insert into app_private.mail_intake_items (
    source_provider,
    source_mailbox_key,
    source_message_id,
    received_at,
    subject,
    vessel_voyage,
    port_name,
    delivery_window,
    fuel_items,
    warnings
  ) values (
    v_source_provider,
    v_source_mailbox_key,
    v_source_message_id,
    p_received_at,
    v_subject,
    v_vessel_voyage,
    v_port_name,
    v_delivery_window,
    p_fuel_items,
    p_warnings
  )
  on conflict (source_provider, source_mailbox_key, source_message_id) do nothing
  returning id into v_item_id;

  if v_item_id is null then
    select item.id
    into v_item_id
    from app_private.mail_intake_items as item
    where item.source_provider = v_source_provider
      and item.source_mailbox_key = v_source_mailbox_key
      and item.source_message_id = v_source_message_id;
  end if;

  if v_item_id is null then
    raise exception using errcode = '40001', message = 'Mail intake identity could not be resolved';
  end if;

  return v_item_id;
end;
$$;

create function public.list_mail_intake_items(p_actor_membership_id uuid)
returns setof app_private.mail_intake_api_result
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_active_buyer_actor(p_actor_membership_id);

  return query
  select result.*
  from app_private.mail_intake_items as item
  cross join lateral app_private.mail_intake_result(item.id) as result
  where item.status = 'pending'::app_private.mail_intake_status
  order by item.received_at desc, item.created_at desc, item.id;
end;
$$;

create function public.dismiss_mail_intake_item(
  p_actor_membership_id uuid,
  p_item_id uuid,
  p_expected_revision bigint
)
returns app_private.mail_intake_api_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_item app_private.mail_intake_items%rowtype;
  v_result app_private.mail_intake_api_result;
begin
  select * into v_actor
  from app_private.require_active_buyer_actor(p_actor_membership_id);

  select * into v_item
  from app_private.mail_intake_items
  where id = p_item_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Mail intake item not found';
  end if;

  if p_expected_revision is null or v_item.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Mail intake revision conflict';
  end if;

  if v_item.status = 'dismissed'::app_private.mail_intake_status then
    raise exception using errcode = '55000', message = 'Mail intake item is already dismissed';
  end if;

  update app_private.mail_intake_items
  set status = 'dismissed'::app_private.mail_intake_status,
      dismissed_at = clock_timestamp(),
      dismissed_by_user_id = v_actor.user_id,
      dismissed_by_membership_id = v_actor.membership_id,
      revision = revision + 1
  where id = p_item_id;

  select result.* into v_result
  from app_private.mail_intake_result(p_item_id) as result;

  return v_result;
end;
$$;

revoke all on function app_private.mail_intake_fuel_items_are_valid(jsonb) from public, anon, authenticated;
revoke all on function app_private.mail_intake_warnings_are_valid(jsonb) from public, anon, authenticated;
revoke all on function app_private.set_mail_intake_updated_at() from public, anon, authenticated;
revoke all on function app_private.mail_intake_result(uuid) from public, anon, authenticated;

revoke all on function public.ingest_mail_intake_item(text, text, text, timestamptz, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_mail_intake_item(text, text, text, timestamptz, text, text, text, text, jsonb, jsonb) to service_role;

revoke all on function public.list_mail_intake_items(uuid) from public, anon, authenticated;
revoke all on function public.dismiss_mail_intake_item(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.list_mail_intake_items(uuid) to authenticated;
grant execute on function public.dismiss_mail_intake_item(uuid, uuid, bigint) to authenticated;
