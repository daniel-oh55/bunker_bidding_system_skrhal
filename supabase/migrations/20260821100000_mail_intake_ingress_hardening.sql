-- Pin the elevated server connector to the ingest-only mail-intake surface.
-- The SECURITY DEFINER ingest RPC remains the only persistence route.

revoke select, insert, update, delete, truncate
on table app_private.mail_intake_items
from public, anon, authenticated, service_role;

revoke execute
on function public.ingest_mail_intake_item(text, text, text, timestamptz, text, text, text, text, jsonb, jsonb)
from public, anon, authenticated;

revoke execute
on function public.list_mail_intake_items(uuid)
from public, anon, service_role;

revoke execute
on function public.dismiss_mail_intake_item(uuid, uuid, bigint)
from public, anon, service_role;

grant execute
on function public.ingest_mail_intake_item(text, text, text, timestamptz, text, text, text, text, jsonb, jsonb)
to service_role;

grant execute
on function public.list_mail_intake_items(uuid)
to authenticated;

grant execute
on function public.dismiss_mail_intake_item(uuid, uuid, bigint)
to authenticated;
