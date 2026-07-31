begin;
select plan(55);

select has_schema('app_private', 'app_private schema exists');

select has_type('app_private', 'account_status', 'account status type exists');
select has_type('app_private', 'organization_kind', 'organization kind type exists');
select has_type('app_private', 'organization_status', 'organization status type exists');
select has_type('app_private', 'membership_role', 'membership role type exists');
select has_type('app_private', 'membership_status', 'membership status type exists');

select has_table('app_private', 'user_accounts', 'user accounts table exists');
select has_table('app_private', 'organizations', 'organizations table exists');
select has_table('app_private', 'organization_memberships', 'organization memberships table exists');

select columns_are(
  'app_private',
  'user_accounts',
  array['user_id', 'status', 'created_at', 'updated_at', 'display_name'],
  'user accounts has the required columns'
);
select columns_are(
  'app_private',
  'organizations',
  array['id', 'kind', 'name', 'status', 'created_at', 'updated_at'],
  'organizations has the required columns'
);
select columns_are(
  'app_private',
  'organization_memberships',
  array['id', 'user_id', 'organization_id', 'role', 'status', 'created_at', 'updated_at'],
  'memberships has the required columns'
);

select col_is_pk('app_private', 'user_accounts', 'user_id', 'user accounts has its primary key');
select col_is_pk('app_private', 'organizations', 'id', 'organizations has its primary key');
select col_is_pk('app_private', 'organization_memberships', 'id', 'memberships has its primary key');

select fk_ok('app_private', 'user_accounts', 'user_id', 'auth', 'users', 'id', 'user accounts references auth users');
select fk_ok('app_private', 'organization_memberships', 'user_id', 'auth', 'users', 'id', 'memberships reference auth users');
select fk_ok('app_private', 'organization_memberships', 'organization_id', 'app_private', 'organizations', 'id', 'memberships reference organizations');
select has_index('app_private', 'organization_memberships', 'organization_memberships_user_id_organization_id_key', 'membership uniqueness index exists');

select ok((select relrowsecurity from pg_class where oid = 'app_private.user_accounts'::regclass), 'user accounts RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'app_private.organizations'::regclass), 'organizations RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'app_private.organization_memberships'::regclass), 'memberships RLS is enabled');

select ok(not has_table_privilege('anon', 'app_private.user_accounts', 'select'), 'anon cannot select user accounts');
select ok(not has_table_privilege('anon', 'app_private.user_accounts', 'insert'), 'anon cannot insert user accounts');
select ok(not has_table_privilege('anon', 'app_private.user_accounts', 'update'), 'anon cannot update user accounts');
select ok(not has_table_privilege('anon', 'app_private.user_accounts', 'delete'), 'anon cannot delete user accounts');
select ok(not has_table_privilege('authenticated', 'app_private.user_accounts', 'select'), 'authenticated cannot select user accounts');
select ok(not has_table_privilege('authenticated', 'app_private.user_accounts', 'insert'), 'authenticated cannot insert user accounts');
select ok(not has_table_privilege('authenticated', 'app_private.user_accounts', 'update'), 'authenticated cannot update user accounts');
select ok(not has_table_privilege('authenticated', 'app_private.user_accounts', 'delete'), 'authenticated cannot delete user accounts');

select ok(not has_table_privilege('anon', 'app_private.organizations', 'select'), 'anon cannot select organizations');
select ok(not has_table_privilege('anon', 'app_private.organizations', 'insert'), 'anon cannot insert organizations');
select ok(not has_table_privilege('anon', 'app_private.organizations', 'update'), 'anon cannot update organizations');
select ok(not has_table_privilege('anon', 'app_private.organizations', 'delete'), 'anon cannot delete organizations');
select ok(not has_table_privilege('authenticated', 'app_private.organizations', 'select'), 'authenticated cannot select organizations');
select ok(not has_table_privilege('authenticated', 'app_private.organizations', 'insert'), 'authenticated cannot insert organizations');
select ok(not has_table_privilege('authenticated', 'app_private.organizations', 'update'), 'authenticated cannot update organizations');
select ok(not has_table_privilege('authenticated', 'app_private.organizations', 'delete'), 'authenticated cannot delete organizations');

select ok(not has_table_privilege('anon', 'app_private.organization_memberships', 'select'), 'anon cannot select memberships');
select ok(not has_table_privilege('anon', 'app_private.organization_memberships', 'insert'), 'anon cannot insert memberships');
select ok(not has_table_privilege('anon', 'app_private.organization_memberships', 'update'), 'anon cannot update memberships');
select ok(not has_table_privilege('anon', 'app_private.organization_memberships', 'delete'), 'anon cannot delete memberships');
select ok(not has_table_privilege('authenticated', 'app_private.organization_memberships', 'select'), 'authenticated cannot select memberships');
select ok(not has_table_privilege('authenticated', 'app_private.organization_memberships', 'insert'), 'authenticated cannot insert memberships');
select ok(not has_table_privilege('authenticated', 'app_private.organization_memberships', 'update'), 'authenticated cannot update memberships');
select ok(not has_table_privilege('authenticated', 'app_private.organization_memberships', 'delete'), 'authenticated cannot delete memberships');

select ok(has_function_privilege('authenticated', 'public.current_access_context()', 'execute'), 'authenticated can execute the public access-context RPC');
select ok(not has_function_privilege('anon', 'public.current_access_context()', 'execute'), 'anon cannot execute the public access-context RPC');

select ok(to_regprocedure('app_private.enforce_organization_kind_membership_compatibility()') is not null, 'organization kind compatibility function exists');
select is(
  (select provolatile::text from pg_proc where oid = 'app_private.enforce_membership_role_organization_kind()'::regprocedure),
  'v',
  'membership role compatibility function is VOLATILE'
);
select is(
  (select provolatile::text from pg_proc where oid = 'app_private.enforce_organization_kind_membership_compatibility()'::regprocedure),
  'v',
  'organization kind compatibility function is VOLATILE'
);
select ok(exists (
  select 1
  from pg_trigger
  where tgrelid = 'app_private.organizations'::regclass
    and tgname = 'enforce_organization_kind_membership_compatibility'
    and not tgisinternal
), 'organization kind compatibility trigger exists');
select ok(not has_function_privilege('public', 'app_private.enforce_organization_kind_membership_compatibility()', 'execute'), 'PUBLIC cannot execute the organization kind compatibility function');
select ok(not has_function_privilege('anon', 'app_private.enforce_organization_kind_membership_compatibility()', 'execute'), 'anon cannot execute the organization kind compatibility function');
select ok(not has_function_privilege('authenticated', 'app_private.enforce_organization_kind_membership_compatibility()', 'execute'), 'authenticated cannot execute the organization kind compatibility function');

select * from finish();
rollback;
