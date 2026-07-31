import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

const operationTimeoutMs = 10_000;
const loopbackHosts = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '0:0:0:0:0:0:0:1',
]);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function parseLoopbackUrl(value, allowedProtocols, label) {
  assert(value, `${label} is required.`);

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} is invalid.`);
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  assert(
    allowedProtocols.has(parsed.protocol) && loopbackHosts.has(host),
    `Refusing to use a non-loopback ${label}.`,
  );

  return parsed;
}

async function withTimeout(operation, label) {
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} exceeded the ${operationTimeoutMs}ms timeout.`));
    }, operationTimeoutMs);
  });

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

function createCallerClient(apiUrl, publishableKey) {
  return createClient(apiUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function createFixtureClient(apiUrl, fixtureKey) {
  return createClient(apiUrl, fixtureKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function run() {
  const [
    apiUrl,
    publishableKey,
    fixtureKey,
    databaseUrl,
    ...unexpectedArguments
  ] = process.argv.slice(2);

  assert(
    unexpectedArguments.length === 0,
    'Expected exactly four runtime arguments.',
  );
  parseLoopbackUrl(apiUrl, new Set(['http:', 'https:']), 'API URL');
  parseLoopbackUrl(
    databaseUrl,
    new Set(['postgres:', 'postgresql:']),
    'database URL',
  );
  assert(publishableKey, 'A local publishable or anon key is required.');
  assert(fixtureKey, 'A local elevated fixture key is required.');
  assert(
    publishableKey !== fixtureKey,
    'Caller and fixture credentials must be different.',
  );

  const fixtureClient = createFixtureClient(apiUrl, fixtureKey);
  const database = new Client({
    connectionString: databaseUrl,
    application_name: 'frontend-auth-access-integration',
    connectionTimeoutMillis: operationTimeoutMs,
    query_timeout: operationTimeoutMs,
    statement_timeout: operationTimeoutMs,
  });
  const createdUserIds = [];
  const createdOrganizationIds = [];
  const authenticatedCallers = [];
  let primaryError = null;
  const cleanupErrors = [];

  async function query(text, values, label) {
    return await withTimeout(database.query(text, values), label);
  }

  async function createUser(label) {
    const id = randomUUID();
    const email = `${label}-${id}@auth-access.test`;
    const password = `Local-${randomUUID()}-9a!`;
    const { data, error } = await withTimeout(
      fixtureClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
      `create ${label} user`,
    );

    if (data.user) {
      createdUserIds.push(data.user.id);
    }
    assert(!error && data.user, `Could not create the ${label} fixture user.`);
    return { id: data.user.id, email, password };
  }

  function newCaller() {
    return createCallerClient(apiUrl, publishableKey);
  }

  async function signIn(caller, user, label) {
    const { data, error } = await withTimeout(
      caller.auth.signInWithPassword({
        email: user.email,
        password: user.password,
      }),
      `${label} sign-in`,
    );
    const errorCode = error?.code ?? 'unknown';
    assert(
      !error && data.session,
      `${label} sign-in failed unexpectedly (${errorCode}).`,
    );
    authenticatedCallers.push(caller);
  }

  async function contextsFor(caller, label) {
    const { data, error } = await withTimeout(
      caller.rpc('current_access_context'),
      `${label} context query`,
    );
    assert(!error, `${label} context query failed unexpectedly.`);
    assert(Array.isArray(data), `${label} context query did not return an array.`);
    return data;
  }

  async function setAccountStatus(userId, status) {
    const result = await query(
      'update app_private.user_accounts set status = $2 where user_id = $1',
      [userId, status],
      `set account status to ${status}`,
    );
    assert(result.rowCount === 1, 'Expected exactly one fixture account row.');
  }

  async function setOrganizationStatus(organizationId, status) {
    const result = await query(
      'update app_private.organizations set status = $2 where id = $1',
      [organizationId, status],
      `set organization status to ${status}`,
    );
    assert(result.rowCount === 1, 'Expected exactly one fixture organization row.');
  }

  async function setMembershipStatus(membershipId, status) {
    const result = await query(
      'update app_private.organization_memberships set status = $2 where id = $1',
      [membershipId, status],
      `set membership status to ${status}`,
    );
    assert(result.rowCount === 1, 'Expected exactly one fixture membership row.');
  }

  async function createOrganizationWithMembership({
    userId,
    kind,
    role,
  }) {
    const organizationId = randomUUID();
    const membershipId = randomUUID();
    createdOrganizationIds.push(organizationId);

    await query(
      `insert into app_private.organizations (id, kind, name, status)
       values ($1, $2, $3, 'active')`,
      [organizationId, kind, `auth-access-${organizationId}`],
      'create fixture organization',
    );
    await query(
      `insert into app_private.organization_memberships
         (id, user_id, organization_id, role, status)
       values ($1, $2, $3, $4, 'active')`,
      [membershipId, userId, organizationId, role],
      'create fixture membership',
    );

    return { organizationId, membershipId };
  }

  try {
    await withTimeout(database.connect(), 'connect to local database');
    await query(
      `set statement_timeout to '${operationTimeoutMs}ms'`,
      [],
      'configure statement timeout',
    );

    const signupCaller = newCaller();
    const signupEmail = `public-signup-${randomUUID()}@auth-access.test`;
    const signupResult = await withTimeout(
      signupCaller.auth.signUp({
        email: signupEmail,
        password: `Local-${randomUUID()}-9a!`,
      }),
      'public signup rejection check',
    );
    if (signupResult.data.user) {
      createdUserIds.push(signupResult.data.user.id);
    }
    if (signupResult.data.session) {
      authenticatedCallers.push(signupCaller);
    }
    assert(signupResult.error, 'Public signup unexpectedly succeeded.');

    const noContextUser = await createUser('no-context');
    await setAccountStatus(noContextUser.id, 'active');
    const invalidPasswordCaller = newCaller();

    const invalidPasswordResult = await withTimeout(
      invalidPasswordCaller.auth.signInWithPassword({
        email: noContextUser.email,
        password: `Wrong-${randomUUID()}-9a!`,
      }),
      'invalid password check',
    );
    assert(
      invalidPasswordResult.error && !invalidPasswordResult.data.session,
      'Invalid credentials unexpectedly produced a session.',
    );

    const noContextCaller = newCaller();
    await signIn(noContextCaller, noContextUser, 'no-context user');
    const noContexts = await contextsFor(noContextCaller, 'no-context user');
    assert(
      noContexts.length === 0,
      'A user without an active membership unexpectedly received context.',
    );

    const activeUser = await createUser('active');
    await setAccountStatus(activeUser.id, 'active');
    const firstMembership = await createOrganizationWithMembership({
      userId: activeUser.id,
      kind: 'buyer',
      role: 'buyer_admin',
    });
    const activeCaller = newCaller();
    await signIn(activeCaller, activeUser, 'active user');

    const activeContexts = await contextsFor(activeCaller, 'active user');
    assert(
      activeContexts.length === 1
        && activeContexts[0].membership_id === firstMembership.membershipId
        && activeContexts[0].organization_id === firstMembership.organizationId
        && activeContexts[0].organization_kind === 'buyer'
        && activeContexts[0].membership_role === 'buyer_admin',
      'The active caller did not receive the expected server context.',
    );

    await setAccountStatus(activeUser.id, 'suspended');
    assert(
      (await contextsFor(activeCaller, 'suspended account')).length === 0,
      'A suspended account retained active context.',
    );
    await setAccountStatus(activeUser.id, 'active');

    await setOrganizationStatus(firstMembership.organizationId, 'suspended');
    assert(
      (await contextsFor(activeCaller, 'suspended organization')).length === 0,
      'A suspended organization retained active context.',
    );
    await setOrganizationStatus(firstMembership.organizationId, 'active');

    await setMembershipStatus(firstMembership.membershipId, 'suspended');
    assert(
      (await contextsFor(activeCaller, 'suspended membership')).length === 0,
      'A suspended membership retained active context.',
    );
    await setMembershipStatus(firstMembership.membershipId, 'active');

    const secondMembership = await createOrganizationWithMembership({
      userId: activeUser.id,
      kind: 'trader',
      role: 'trader',
    });
    const multipleContexts = await contextsFor(activeCaller, 'multiple memberships');
    const returnedMembershipIds = new Set(
      multipleContexts.map((context) => context.membership_id),
    );
    assert(
      multipleContexts.length === 2
        && returnedMembershipIds.has(firstMembership.membershipId)
        && returnedMembershipIds.has(secondMembership.membershipId),
      'Multiple active memberships were collapsed or changed.',
    );

    console.log('Frontend Auth/access integration tests passed: 7 boundary scenarios.');
  } catch (error) {
    primaryError = error;
  } finally {
    for (const caller of authenticatedCallers) {
      try {
        await withTimeout(
          caller.auth.signOut({ scope: 'local' }),
          'caller sign-out cleanup',
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    for (const organizationId of createdOrganizationIds.reverse()) {
      try {
        await query(
          'delete from app_private.organizations where id = $1',
          [organizationId],
          'delete fixture organization',
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    for (const userId of createdUserIds.reverse()) {
      try {
        const { error } = await withTimeout(
          fixtureClient.auth.admin.deleteUser(userId),
          'delete fixture user',
        );
        if (error) {
          cleanupErrors.push(new Error('Fixture user cleanup failed.'));
        }
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    try {
      await withTimeout(database.end(), 'close local database connection');
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (primaryError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      'Integration assertions and fixture cleanup failed.',
    );
  }
  if (primaryError) {
    throw primaryError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Fixture cleanup did not complete.');
  }
}

run().catch((error) => {
  console.error(`Frontend Auth/access integration tests failed: ${error.message}`);
  process.exitCode = 1;
});
