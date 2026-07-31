import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const databaseUrl = process.argv[2];
const statementTimeout = '10s';
const blockingDeadlineMs = 5_000;
const pollingIntervalMs = 25;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function validateLocalDatabaseUrl(value) {
  if (!value) {
    fail('A local database URL is required as the first argument.');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('The database URL is invalid.');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1']);
  assert(
    (parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:') && loopbackHosts.has(host),
    `Refusing to connect to a non-local database host: ${parsed.hostname}`,
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function configure(client) {
  await client.query(`SET statement_timeout TO '${statementTimeout}'`);
  await client.query('SET default_transaction_isolation TO \'read committed\'');
}

async function begin(client) {
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
}

async function rollback(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Connection cleanup should continue even if this client has already failed.
  }
}

async function waitForBlocking(observer, waitingPid, blockingPid, raceName) {
  const deadline = Date.now() + blockingDeadlineMs;
  let lastObservation = null;

  while (Date.now() < deadline) {
    const { rows } = await observer.query(
      `select state, wait_event_type, wait_event, pg_blocking_pids(pid) as blocking_pids
       from pg_stat_activity
       where pid = $1`,
      [waitingPid],
    );
    lastObservation = rows[0] ?? null;
    const blockingPids = (lastObservation?.blocking_pids ?? []).map(Number);

    if (
      lastObservation?.wait_event_type === 'Lock'
      && blockingPids.includes(Number(blockingPid))
    ) {
      return;
    }

    await delay(pollingIntervalMs);
  }

  fail(
    `${raceName}: session B did not wait on session A before the ${blockingDeadlineMs}ms deadline; `
      + `last observation: ${JSON.stringify(lastObservation)}`,
  );
}

function assertConstraintFailure(outcome, raceName) {
  assert(!outcome.ok, `${raceName}: session B unexpectedly succeeded.`);
  assert(outcome.error.code !== '40P01', `${raceName}: deadlock detected instead of a constraint failure.`);
  assert(outcome.error.code !== '57014', `${raceName}: statement timeout was treated as success.`);
  assert(
    outcome.error.code === '23514',
    `${raceName}: expected SQLSTATE 23514, received ${outcome.error.code ?? 'no SQLSTATE'}: ${outcome.error.message}`,
  );
}

async function outcomeOf(queryPromise) {
  try {
    await queryPromise;
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

async function createUserAndOrganization(observer, raceName) {
  const userId = randomUUID();
  const organizationId = randomUUID();
  const organizationName = `concurrency-${raceName}-${organizationId}`;

  await observer.query('insert into auth.users (id, email) values ($1, $2)', [
    userId,
    `${userId}@concurrency.test`,
  ]);
  await observer.query(
    "update app_private.user_accounts set status = 'active' where user_id = $1",
    [userId],
  );
  await observer.query(
    `insert into app_private.organizations (id, kind, name, status)
     values ($1, 'buyer', $2, 'active')`,
    [organizationId, organizationName],
  );

  return { organizationId, userId };
}

async function deleteFixture(observer, fixture) {
  if (!fixture) {
    return;
  }

  await observer.query('delete from app_private.organizations where id = $1', [fixture.organizationId]);
  await observer.query('delete from auth.users where id = $1', [fixture.userId]);
}

async function accessContextFor(observer, userId, organizationId) {
  await observer.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  try {
    const { rows } = await observer.query(
      `select organization_kind, membership_role
       from public.current_access_context()
       where organization_id = $1`,
      [organizationId],
    );
    return rows;
  } finally {
    await observer.query('reset request.jwt.claim.sub');
  }
}

async function assertNoMismatch(observer, organizationId, raceName) {
  const { rows } = await observer.query(
    `select count(*)::int as count
     from app_private.organizations as organization
     join app_private.organization_memberships as membership
       on membership.organization_id = organization.id
     where organization.id = $1
       and (
         (organization.kind = 'buyer' and membership.role = 'trader')
         or (organization.kind = 'trader' and membership.role in ('buyer_admin', 'buyer_operator'))
       )`,
    [organizationId],
  );
  assert(rows[0].count === 0, `${raceName}: a mismatched organization kind and membership role persisted.`);
}

async function raceMembershipFirst({ a, b, observer, pids }) {
  const raceName = 'Race A (membership first)';
  let fixture;
  let aOpen = false;
  let bOpen = false;

  try {
    fixture = await createUserAndOrganization(observer, 'membership-first');

    await begin(a);
    aOpen = true;
    await a.query(
      `insert into app_private.organization_memberships (user_id, organization_id, role, status)
       values ($1, $2, 'buyer_admin', 'active')`,
      [fixture.userId, fixture.organizationId],
    );

    await begin(b);
    bOpen = true;
    const pendingKindChange = b.query(
      "update app_private.organizations set kind = 'trader' where id = $1",
      [fixture.organizationId],
    );
    pendingKindChange.catch(() => {});

    await waitForBlocking(observer, pids.b, pids.a, raceName);
    await a.query('COMMIT');
    aOpen = false;

    const outcome = await outcomeOf(pendingKindChange);
    assertConstraintFailure(outcome, raceName);
    await b.query('ROLLBACK');
    bOpen = false;

    const { rows } = await observer.query(
      `select organization.kind::text as kind, membership.role::text as role
       from app_private.organizations as organization
       join app_private.organization_memberships as membership on membership.organization_id = organization.id
       where organization.id = $1`,
      [fixture.organizationId],
    );
    assert(rows.length === 1 && rows[0].kind === 'buyer' && rows[0].role === 'buyer_admin', `${raceName}: final persisted state is incorrect.`);
    const context = await accessContextFor(observer, fixture.userId, fixture.organizationId);
    assert(context.length === 1 && context[0].organization_kind === 'buyer' && context[0].membership_role === 'buyer_admin', `${raceName}: current_access_context() returned an invalid final context.`);
    await assertNoMismatch(observer, fixture.organizationId, raceName);
  } finally {
    if (aOpen) await rollback(a);
    if (bOpen) await rollback(b);
    await deleteFixture(observer, fixture);
  }
}

async function raceOrganizationFirst({ a, b, observer, pids }) {
  const raceName = 'Race B (organization kind first)';
  let fixture;
  let aOpen = false;
  let bOpen = false;

  try {
    fixture = await createUserAndOrganization(observer, 'organization-first');

    await begin(a);
    aOpen = true;
    await a.query("update app_private.organizations set kind = 'trader' where id = $1", [fixture.organizationId]);

    await begin(b);
    bOpen = true;
    const pendingMembershipInsert = b.query(
      `insert into app_private.organization_memberships (user_id, organization_id, role, status)
       values ($1, $2, 'buyer_admin', 'active')`,
      [fixture.userId, fixture.organizationId],
    );
    pendingMembershipInsert.catch(() => {});

    await waitForBlocking(observer, pids.b, pids.a, raceName);
    await a.query('COMMIT');
    aOpen = false;

    const outcome = await outcomeOf(pendingMembershipInsert);
    assertConstraintFailure(outcome, raceName);
    await b.query('ROLLBACK');
    bOpen = false;

    const { rows } = await observer.query(
      `select organization.kind::text as kind, count(membership.id)::int as membership_count
       from app_private.organizations as organization
       left join app_private.organization_memberships as membership on membership.organization_id = organization.id
       where organization.id = $1
       group by organization.kind`,
      [fixture.organizationId],
    );
    assert(rows.length === 1 && rows[0].kind === 'trader' && rows[0].membership_count === 0, `${raceName}: final persisted state is incorrect.`);
    const context = await accessContextFor(observer, fixture.userId, fixture.organizationId);
    assert(context.length === 0, `${raceName}: current_access_context() returned a membership that should not exist.`);
    await assertNoMismatch(observer, fixture.organizationId, raceName);
  } finally {
    if (aOpen) await rollback(a);
    if (bOpen) await rollback(b);
    await deleteFixture(observer, fixture);
  }
}

async function raceRoleUpdate({ a, b, observer, pids }) {
  const raceName = 'Race C (role update versus kind update)';
  let fixture;
  let membershipId;
  let aOpen = false;
  let bOpen = false;

  try {
    fixture = await createUserAndOrganization(observer, 'role-update');
    membershipId = randomUUID();
    await observer.query(
      `insert into app_private.organization_memberships (id, user_id, organization_id, role, status)
       values ($1, $2, $3, 'buyer_admin', 'active')`,
      [membershipId, fixture.userId, fixture.organizationId],
    );

    await begin(a);
    aOpen = true;
    await a.query(
      "update app_private.organization_memberships set role = 'buyer_operator' where id = $1",
      [membershipId],
    );

    await begin(b);
    bOpen = true;
    const pendingKindChange = b.query(
      "update app_private.organizations set kind = 'trader' where id = $1",
      [fixture.organizationId],
    );
    pendingKindChange.catch(() => {});

    await waitForBlocking(observer, pids.b, pids.a, raceName);
    await a.query('COMMIT');
    aOpen = false;

    const outcome = await outcomeOf(pendingKindChange);
    assertConstraintFailure(outcome, raceName);
    await b.query('ROLLBACK');
    bOpen = false;

    const { rows } = await observer.query(
      `select organization.kind::text as kind, membership.role::text as role
       from app_private.organizations as organization
       join app_private.organization_memberships as membership on membership.organization_id = organization.id
       where membership.id = $1`,
      [membershipId],
    );
    assert(rows.length === 1 && rows[0].kind === 'buyer' && rows[0].role === 'buyer_operator', `${raceName}: final persisted state is incorrect.`);
    const context = await accessContextFor(observer, fixture.userId, fixture.organizationId);
    assert(context.length === 1 && context[0].organization_kind === 'buyer' && context[0].membership_role === 'buyer_operator', `${raceName}: current_access_context() returned an invalid final context.`);
    await assertNoMismatch(observer, fixture.organizationId, raceName);
  } finally {
    if (aOpen) await rollback(a);
    if (bOpen) await rollback(b);
    await deleteFixture(observer, fixture);
  }
}

validateLocalDatabaseUrl(databaseUrl);

const clients = {
  a: new Client({ connectionString: databaseUrl, application_name: 'membership-concurrency-session-a' }),
  b: new Client({ connectionString: databaseUrl, application_name: 'membership-concurrency-session-b' }),
  observer: new Client({ connectionString: databaseUrl, application_name: 'membership-concurrency-observer' }),
};

try {
  await Promise.all(Object.values(clients).map((client) => client.connect()));
  await Promise.all(Object.values(clients).map(configure));

  const pids = Object.fromEntries(await Promise.all(
    Object.entries(clients).map(async ([name, client]) => {
      const { rows } = await client.query('select pg_backend_pid() as pid');
      return [name, rows[0].pid];
    }),
  ));

  await raceMembershipFirst({ ...clients, pids });
  await raceOrganizationFirst({ ...clients, pids });
  await raceRoleUpdate({ ...clients, pids });
  console.log('Membership concurrency regression tests passed: 3 races.');
} catch (error) {
  console.error(`Membership concurrency regression tests failed: ${error.stack ?? error.message}`);
  process.exitCode = 1;
} finally {
  await Promise.all(Object.values(clients).map(async (client) => {
    await rollback(client);
    await client.end().catch(() => {});
  }));
}
