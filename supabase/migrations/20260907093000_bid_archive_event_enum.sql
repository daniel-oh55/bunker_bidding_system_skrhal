-- Keep the archive audit value in its own committed transaction so PostgreSQL
-- can use it safely in the following migration.

alter type app_private.bid_audit_event_type add value 'archived';
