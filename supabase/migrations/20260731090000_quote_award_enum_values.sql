-- Keep enum labels in a committed migration before any later migration uses them.
alter type app_private.bid_status add value if not exists 'awarded';
alter type app_private.bid_audit_event_type add value if not exists 'trader_access_granted';
alter type app_private.bid_audit_event_type add value if not exists 'trader_access_revoked';
alter type app_private.bid_audit_event_type add value if not exists 'awarded';
