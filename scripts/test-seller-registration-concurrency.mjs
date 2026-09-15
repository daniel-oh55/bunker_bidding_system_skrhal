import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const [databaseUrl] = process.argv.slice(2);
const timeoutMs = 10_000;
function assert(condition, message) { if (!condition) throw new Error(message); }
function validateLocalDatabaseUrl(value) {
  assert(process.argv.length === 3, 'Expected exactly one local PostgreSQL URL.');
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('The database URL is invalid.'); }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  assert(['postgres:', 'postgresql:'].includes(parsed.protocol) && ['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1'].includes(host), 'Refusing a non-loopback database URL.');
}
async function rollback(client) { try { await client.query('rollback'); } catch { /* Continue scoped cleanup. */ } }
async function outcome(operation) {
  try { return { ok: true, result: await operation }; } catch (error) { return { ok: false, error }; }
}
async function callerTransaction(client, userId) {
  await client.query('begin');
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
}

// Observed PostgreSQL blocking is the barrier. The poll delay only limits load.
async function waitForApplicantLock(observer, waitingPid, blockingPid, race) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await observer.query('select wait_event_type, pg_blocking_pids(pid) as blockers from pg_stat_activity where pid = $1', [waitingPid]);
    if (rows[0]?.wait_event_type === 'Lock' && rows[0].blockers.map(Number).includes(Number(blockingPid))) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(race + ': competing caller did not block on the applicant transaction.');
}
async function createFixture(observer, fixture) {
  await observer.query('insert into auth.users (id, email, email_confirmed_at) select id, id::text || $2, now() from unnest($1::uuid[]) as id', [fixture.userIds, '@seller-registration-race.test']);
  await observer.query("update app_private.user_accounts set status = 'active' where user_id = any($1::uuid[])", [fixture.adminUserIds]);
  await observer.query(
    "insert into app_private.organizations (id, kind, name, status) values ($1, 'buyer', $2, 'active'), ($3, 'trader', $4, 'active'), ($5, 'trader', $6, 'active')",
    [fixture.buyerOrg, 'registration buyer ' + fixture.applicant, fixture.traderA, 'registration seller A ' + fixture.applicant, fixture.traderB, 'registration seller B ' + fixture.applicant],
  );
  await observer.query(
    "insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values ($1, $2, $3, 'buyer_admin', 'active'), ($4, $5, $3, 'buyer_admin', 'active')",
    [fixture.adminMemberships[0], fixture.adminUserIds[0], fixture.buyerOrg, fixture.adminMemberships[1], fixture.adminUserIds[1]],
  );
}
async function cleanup(observer, fixture) {
  await observer.query('begin');
  try {
    // Owner-only local fixture teardown follows the existing harness pattern.
    // Bypass the append-only trigger only for this applicant's audit rows.
    await observer.query("set local session_replication_role = 'replica'");
    await observer.query('delete from app_private.seller_registration_audit_events where applicant_user_id = $1', [fixture.applicant]);
    await observer.query("set local session_replication_role = 'origin'");
    await observer.query('delete from app_private.seller_registration_requests where applicant_user_id = $1', [fixture.applicant]);
    await observer.query('delete from app_private.organization_memberships where user_id = any($1::uuid[])', [fixture.userIds]);
    await observer.query('delete from app_private.organizations where id = any($1::uuid[])', [[fixture.buyerOrg, fixture.traderA, fixture.traderB]]);
    await observer.query('delete from auth.users where id = any($1::uuid[])', [fixture.userIds]);
    await observer.query('commit');
  } catch (error) { await rollback(observer); throw error; }
}
async function durableState(observer, fixture) {
  const requests = (await observer.query('select * from app_private.seller_registration_requests where applicant_user_id = $1', [fixture.applicant])).rows;
  const memberships = (await observer.query('select * from app_private.organization_memberships where user_id = $1', [fixture.applicant])).rows;
  const audits = (await observer.query('select * from app_private.seller_registration_audit_events where applicant_user_id = $1', [fixture.applicant])).rows;
  const account = (await observer.query('select status from app_private.user_accounts where user_id = $1', [fixture.applicant])).rows[0];
  return { requests, memberships, audits, account };
}
function checkState(state, fixture, status, mappedOrg = null, actorIndex = null) {
  assert(state.requests.length === 1, 'Expected exactly one durable registration request.');
  const request = state.requests[0];
  assert(request.status === status && request.revision === (status === 'pending' ? 1 : 2), 'Request status/revision split from winning transaction.');
  assert(request.mapped_trader_organization_id === mappedOrg, 'Request mapping does not match the winner.');
  assert(state.audits.filter((audit) => audit.event_type === 'submitted').length === 1, 'Expected exactly one submitted audit.');
  const terminalAudits = state.audits.filter((audit) => audit.event_type !== 'submitted');
  assert(terminalAudits.length === (status === 'pending' ? 0 : 1), 'Incorrect number of terminal audits.');
  if (status === 'approved') {
    assert(state.account.status === 'active' && state.memberships.length === 1, 'Approval did not atomically activate exactly one membership.');
    const membership = state.memberships[0];
    assert(membership.role === 'trader' && membership.status === 'active' && membership.organization_id === mappedOrg, 'Approved membership role/status/organization is incorrect.');
  } else {
    assert(state.account.status === 'inactive' && state.memberships.length === 0, 'Pending/rejected applicant gained business access.');
  }
  if (actorIndex !== null) {
    const audit = terminalAudits[0];
    assert(audit.event_type === status && audit.actor_user_id === fixture.adminUserIds[actorIndex] && audit.actor_membership_id === fixture.adminMemberships[actorIndex] && audit.actor_buyer_organization_id === fixture.buyerOrg, 'Terminal audit did not retain the winning server actor.');
    assert(request.decided_by_user_id === audit.actor_user_id && request.decided_by_membership_id === audit.actor_membership_id && request.decided_by_buyer_organization_id === audit.actor_buyer_organization_id, 'Decision and audit actor identities disagree.');
    assert(audit.before_snapshot.status === 'pending' && audit.before_snapshot.revision === 1 && audit.after_snapshot.status === status && audit.after_snapshot.revision === 2, 'Audit snapshots do not describe the single transition.');
  }
}
async function seededRequest(client, fixture) {
  await callerTransaction(client, fixture.applicant);
  const { rows } = await client.query('select * from public.submit_seller_registration_request($1)', ['Race Seller']);
  await client.query('commit');
  return rows[0];
}
const submit = (client, label) => client.query('select * from public.submit_seller_registration_request($1)', [label]);
const approve = (client, fixture, request, actorIndex, org) => client.query('select * from public.approve_seller_registration_request($1,$2,$3,$4)', [fixture.adminMemberships[actorIndex], request.request_id, request.revision, org]);
const reject = (client, fixture, request, actorIndex) => client.query('select * from public.reject_seller_registration_request($1,$2,$3)', [fixture.adminMemberships[actorIndex], request.request_id, request.revision]);
async function competingTransaction({ a, b, observer, pids }, race, firstUser, secondUser, firstOperation, secondOperation) {
  let pending;
  try {
    await callerTransaction(a, firstUser);
    const first = await firstOperation(a);
    await callerTransaction(b, secondUser);
    pending = outcome(secondOperation(b));
    await waitForApplicantLock(observer, pids.b, pids.a, race);
    await a.query('commit');
    const second = await pending;
    if (second.ok) await b.query('commit'); else await rollback(b);
    return { first, second };
  } finally {
    await rollback(a);
    if (pending) await pending;
    await rollback(b);
  }
}
async function withFixture(clients, race, run) {
  const fixture = { applicant: randomUUID(), adminUserIds: [randomUUID(), randomUUID()], adminMemberships: [randomUUID(), randomUUID()], buyerOrg: randomUUID(), traderA: randomUUID(), traderB: randomUUID() };
  fixture.userIds = [fixture.applicant, ...fixture.adminUserIds];
  try { await createFixture(clients.observer, fixture); await run(fixture); console.log(race + ': passed'); }
  finally { await rollback(clients.a); await rollback(clients.b); await cleanup(clients.observer, fixture); }
}

validateLocalDatabaseUrl(databaseUrl);
const clients = Object.fromEntries(['a', 'b', 'observer'].map((name) => [name, new Client({ connectionString: databaseUrl, connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs, application_name: 'seller-registration-concurrency-' + name })]));
try {
  await Promise.all(Object.values(clients).map((client) => client.connect()));
  for (const client of Object.values(clients)) {
    await client.query("set statement_timeout = '10s'");
    await client.query("set lock_timeout = '7s'");
    await client.query("set idle_in_transaction_session_timeout = '10s'");
  }
  const pids = Object.fromEntries(await Promise.all(Object.entries(clients).map(async ([name, client]) => [name, (await client.query('select pg_backend_pid() as pid')).rows[0].pid])));
  const sessions = { ...clients, pids };
  await withFixture(clients, 'A duplicate submission', async (fixture) => {
    const { first, second } = await competingTransaction(sessions, 'A', fixture.applicant, fixture.applicant, (client) => submit(client, '  Race Seller  '), (client) => submit(client, 'Race Seller'));
    assert(second.ok && first.rows[0].request_id === second.result.rows[0].request_id, 'Duplicate callers did not return the same authoritative request.');
    checkState(await durableState(clients.observer, fixture), fixture, 'pending');
  });
  await withFixture(clients, 'B two-admin approval', async (fixture) => {
    const request = await seededRequest(clients.a, fixture);
    const { second } = await competingTransaction(sessions, 'B', fixture.adminUserIds[0], fixture.adminUserIds[1], (client) => approve(client, fixture, request, 0, fixture.traderA), (client) => approve(client, fixture, request, 1, fixture.traderB));
    assert(!second.ok && second.error.code === '40001', 'Losing admin did not fail stale.');
    checkState(await durableState(clients.observer, fixture), fixture, 'approved', fixture.traderA, 0);
  });
  // Exercise both possible terminal winners with fresh fixtures.
  for (const rejectionWins of [false, true]) {
    await withFixture(clients, 'C approve vs reject (' + (rejectionWins ? 'rejected' : 'approved') + ' wins)', async (fixture) => {
      const request = await seededRequest(clients.a, fixture);
      const { second } = await competingTransaction(sessions, 'C', fixture.adminUserIds[0], fixture.adminUserIds[1], (client) => rejectionWins ? reject(client, fixture, request, 0) : approve(client, fixture, request, 0, fixture.traderA), (client) => rejectionWins ? approve(client, fixture, request, 1, fixture.traderB) : reject(client, fixture, request, 1));
      assert(!second.ok && second.error.code === '40001', 'Losing terminal transition did not fail stale.');
      checkState(await durableState(clients.observer, fixture), fixture, rejectionWins ? 'rejected' : 'approved', rejectionWins ? null : fixture.traderA, 0);
    });
  }
  await withFixture(clients, 'D approval vs new submission', async (fixture) => {
    const request = await seededRequest(clients.a, fixture);
    const { second } = await competingTransaction(sessions, 'D', fixture.adminUserIds[0], fixture.applicant, (client) => approve(client, fixture, request, 0, fixture.traderA), (client) => submit(client, 'Different Seller'));
    assert(!second.ok && second.error.code === '55000', 'Submission did not recheck the active account after waiting.');
    const state = await durableState(clients.observer, fixture);
    checkState(state, fixture, 'approved', fixture.traderA, 0);
    assert(state.requests.every((row) => row.status !== 'pending'), 'Approval left a new pending request behind.');
  });
  console.log('SELLER registration concurrency regression tests passed: 4 races.');
} catch (error) {
  console.error('SELLER registration concurrency regression tests failed: ' + (error.stack ?? error.message));
  process.exitCode = 1;
} finally {
  await Promise.all(Object.values(clients).map(async (client) => { await rollback(client); await client.end().catch(() => {}); }));
}
