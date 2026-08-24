-- Provider-neutral, non-secret cursor state for server-side mail connectors.
-- Direct table access is denied; the connector may use only the two CAS RPCs.

create table app_private.mail_connector_cursors (
  source_provider text not null,
  source_mailbox_key text not null,
  cursor_value text not null,
  revision bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (source_provider, source_mailbox_key),
  constraint mail_connector_cursors_source_provider_valid check (
    source_provider = btrim(source_provider)
    and source_provider ~ '^[a-z0-9_-]{1,32}$'
  ),
  constraint mail_connector_cursors_source_mailbox_key_valid check (
    source_mailbox_key = btrim(source_mailbox_key)
    and char_length(source_mailbox_key) between 1 and 128
    and source_mailbox_key !~ '@'
  ),
  constraint mail_connector_cursors_cursor_value_valid check (
    cursor_value = btrim(cursor_value)
    and char_length(cursor_value) between 1 and 512
    and cursor_value !~ '[[:cntrl:]]'
  ),
  constraint mail_connector_cursors_revision_valid check (revision >= 1),
  constraint mail_connector_cursors_created_at_finite check (isfinite(created_at)),
  constraint mail_connector_cursors_updated_at_finite check (isfinite(updated_at))
);

alter table app_private.mail_connector_cursors enable row level security;

revoke all
on table app_private.mail_connector_cursors
from public, anon, authenticated, service_role;

create function public.get_mail_connector_cursor(
  p_source_provider text,
  p_source_mailbox_key text
)
returns table (
  cursor_value text,
  revision bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_source_provider text := btrim(p_source_provider);
  v_source_mailbox_key text := btrim(p_source_mailbox_key);
begin
  if v_source_provider is null or v_source_provider !~ '^[a-z0-9_-]{1,32}$' then
    raise exception using errcode = '22023', message = 'source_provider is invalid';
  end if;

  if v_source_mailbox_key is null
     or char_length(v_source_mailbox_key) not between 1 and 128
     or v_source_mailbox_key ~ '@' then
    raise exception using errcode = '22023', message = 'source_mailbox_key is invalid';
  end if;

  return query
  select stored.cursor_value, stored.revision
  from app_private.mail_connector_cursors as stored
  where stored.source_provider = v_source_provider
    and stored.source_mailbox_key = v_source_mailbox_key;
end;
$$;

create function public.compare_and_swap_mail_connector_cursor(
  p_source_provider text,
  p_source_mailbox_key text,
  p_expected_revision bigint,
  p_cursor_value text
)
returns table (
  cursor_value text,
  revision bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source_provider text := btrim(p_source_provider);
  v_source_mailbox_key text := btrim(p_source_mailbox_key);
  v_cursor_value text := btrim(p_cursor_value);
  v_result_cursor text;
  v_result_revision bigint;
begin
  if v_source_provider is null or v_source_provider !~ '^[a-z0-9_-]{1,32}$' then
    raise exception using errcode = '22023', message = 'source_provider is invalid';
  end if;

  if v_source_mailbox_key is null
     or char_length(v_source_mailbox_key) not between 1 and 128
     or v_source_mailbox_key ~ '@' then
    raise exception using errcode = '22023', message = 'source_mailbox_key is invalid';
  end if;

  if v_cursor_value is null
     or char_length(v_cursor_value) not between 1 and 512
     or v_cursor_value ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'cursor_value is invalid';
  end if;

  if p_expected_revision is null then
    insert into app_private.mail_connector_cursors (
      source_provider,
      source_mailbox_key,
      cursor_value
    )
    values (
      v_source_provider,
      v_source_mailbox_key,
      v_cursor_value
    )
    on conflict (source_provider, source_mailbox_key) do nothing
    returning mail_connector_cursors.cursor_value, mail_connector_cursors.revision
      into v_result_cursor, v_result_revision;
  else
    if p_expected_revision < 1 then
      raise exception using errcode = '22023', message = 'expected_revision is invalid';
    end if;

    update app_private.mail_connector_cursors as stored
    set cursor_value = v_cursor_value,
        revision = stored.revision + 1,
        updated_at = clock_timestamp()
    where stored.source_provider = v_source_provider
      and stored.source_mailbox_key = v_source_mailbox_key
      and stored.revision = p_expected_revision
    returning stored.cursor_value, stored.revision
      into v_result_cursor, v_result_revision;
  end if;

  if v_result_revision is null then
    raise exception using
      errcode = '40001',
      message = 'mail connector cursor revision conflict';
  end if;

  return query select v_result_cursor, v_result_revision;
end;
$$;

revoke all
on function public.get_mail_connector_cursor(text, text)
from public, anon, authenticated, service_role;

revoke all
on function public.compare_and_swap_mail_connector_cursor(text, text, bigint, text)
from public, anon, authenticated, service_role;

grant execute
on function public.get_mail_connector_cursor(text, text)
to service_role;

grant execute
on function public.compare_and_swap_mail_connector_cursor(text, text, bigint, text)
to service_role;
