-- Keep enum introduction separate from the functions that use these labels.
alter type app_private.trader_organization_admin_event_type add value 'renamed';
alter type app_private.trader_organization_admin_event_type add value 'deleted';
