import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const [databaseUrl] = process.argv.slice(2);
const timeoutMs = 10_000;

function assert(condition, message) { if (!condition) throw new Error(message); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function validateLocalDatabaseUrl(value) {
  assert(process.argv.length === 3, 'Expected exactly one local PostgreSQL URL.');
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('The database URL is invalid.'); }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  assert(['postgres:', 'postgresql:'].includes(parsed.protocol) && ['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1'].includes(host), `Refusing non-loopback database host: ${parsed.hostname}`);
}
async function configure(client) {
  await client.query("set statement_timeout = '10s'");
  await client.query("set lock_timeout = '5s'");
  await client.query("set idle_in_transaction_session_timeout = '10s'");
}
async function rollback(client) { try { await client.query('rollback'); } catch { /* cleanup continues */ } }
async function outcome(promise) { try { return { ok: true, value: await promise }; } catch (error) { return { ok: false, error }; } }
async function waitForBlocking(observer, waitingPid, blockingPid, raceName) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await observer.query('select wait_event_type, pg_blocking_pids(pid) as blockers from pg_stat_activity where pid = $1', [waitingPid]);
    if (rows[0]?.wait_event_type === 'Lock' && rows[0].blockers.map(Number).includes(Number(blockingPid))) return;
    await delay(25);
  }
  throw new Error(`${raceName}: second session did not block on the organization lock.`);
}
async function createFixture(observer, suffix) {
  const fixture = {
    adminUserId: randomUUID(), dependentUserId: randomUUID(), buyerOrganizationId: randomUUID(), membershipId: randomUUID(), sellerOrganizationId: randomUUID(), suffix,
  };
  await observer.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [fixture.adminUserId, `${fixture.adminUserId}@seller-delete-race.test`, fixture.dependentUserId, `${fixture.dependentUserId}@seller-delete-race.test`]);
  await observer.query("update app_private.user_accounts set status = 'active' where user_id = any($1::uuid[])", [[fixture.adminUserId, fixture.dependentUserId]]);
  await observer.query("insert into app_private.organizations (id, kind, name, status) values ($1, 'buyer', $2, 'active'), ($3, 'trader', $4, 'active')", [fixture.buyerOrganizationId, `seller delete race buyer ${suffix}`, fixture.sellerOrganizationId, `seller delete race seller ${suffix}`]);
  await observer.query("insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values ($1, $2, $3, 'buyer_admin', 'active')", [fixture.membershipId, fixture.adminUserId, fixture.buyerOrganizationId]);
  return fixture;
}
async function cleanup(observer, fixture) {
  if (!fixture) return;
  await observer.query('begin');
  try {
    await observer.query("set local session_replication_role = 'replica'");
    await observer.query('delete from app_private.trader_organization_admin_audit_events where trader_organization_id = $1', [fixture.sellerOrganizationId]);
    await observer.query("set local session_replication_role = 'origin'");
    await observer.query('delete from app_private.organization_memberships where organization_id in ($1, $2)', [fixture.buyerOrganizationId, fixture.sellerOrganizationId]);
    await observer.query('delete from app_private.organizations where id in ($1, $2)', [fixture.buyerOrganizationId, fixture.sellerOrganizationId]);
    await observer.query('delete from auth.users where id = any($1::uuid[])', [[fixture.adminUserId, fixture.dependentUserId]]);
    await observer.query('commit');
  } catch (error) { await rollback(observer); throw error; }
}

async function raceDependencyWins({ a, b, observer, pids }) {
  const raceName = 'dependency-wins';
  const fixture = await createFixture(observer, `${raceName}-${randomUUID()}`);
  let aOpen = false; let bOpen = false;
  try {
    await a.query('begin'); aOpen = true;
    await a.query("insert into app_private.organization_memberships (user_id, organization_id, role, status) values ($1, $2, 'trader', 'inactive')", [fixture.dependentUserId, fixture.sellerOrganizationId]);
    await b.query('begin'); bOpen = true;
    await b.query('set local role authenticated');
    await b.query("select set_config('request.jwt.claim.sub', $1, true)", [fixture.adminUserId]);
    const pendingDelete = b.query('select * from public.delete_trader_organization($1, $2, $3, $4)', [fixture.membershipId, fixture.sellerOrganizationId, `seller delete race seller ${fixture.suffix}`, 'active']);
    pendingDelete.catch(() => {});
    await waitForBlocking(observer, pids.b, pids.a, raceName);
    await a.query('commit'); aOpen = false;
    const deleted = await outcome(pendingDelete);
    assert(!deleted.ok && deleted.error.code === '55000' && deleted.error.message === 'SELLER organization has memberships or retained bidding history; deactivate it instead', `${raceName}: delete did not recheck and reject the committed dependency.`);
    await b.query('rollback'); bOpen = false;
    const { rows } = await observer.query("select (select count(*)::int from app_private.organizations where id = $1) as seller_count, (select count(*)::int from app_private.trader_organization_admin_audit_events where trader_organization_id = $1 and event_type = 'deleted') as delete_audits", [fixture.sellerOrganizationId]);
    assert(rows[0].seller_count === 1 && rows[0].delete_audits === 0, `${raceName}: rejected delete changed the seller or wrote a tombstone.`);
  } finally {
    if (aOpen) await rollback(a);
    if (bOpen) await rollback(b);
    await cleanup(observer, fixture);
  }
}

async function raceDeleteWins({ a, b, observer, pids }) {
  const raceName = 'delete-wins';
  const fixture = await createFixture(observer, `${raceName}-${randomUUID()}`);
  let aOpen = false; let bOpen = false;
  try {
    await a.query('begin'); aOpen = true;
    await a.query('set local role authenticated');
    await a.query("select set_config('request.jwt.claim.sub', $1, true)", [fixture.adminUserId]);
    await a.query('select * from public.delete_trader_organization($1, $2, $3, $4)', [fixture.membershipId, fixture.sellerOrganizationId, `seller delete race seller ${fixture.suffix}`, 'active']);
    await b.query('begin'); bOpen = true;
    const pendingDependency = b.query("insert into app_private.organization_memberships (user_id, organization_id, role, status) values ($1, $2, 'trader', 'inactive')", [fixture.dependentUserId, fixture.sellerOrganizationId]);
    pendingDependency.catch(() => {});
    await waitForBlocking(observer, pids.b, pids.a, raceName);
    await a.query('commit'); aOpen = false;
    const insertion = await outcome(pendingDependency);
    assert(!insertion.ok && insertion.error.code === '23503', `${raceName}: dependency insert succeeded after deletion instead of failing its FK.`);
    await b.query('rollback'); bOpen = false;
    const { rows } = await observer.query("select (select count(*)::int from app_private.organizations where id = $1) as seller_count, (select count(*)::int from app_private.trader_organization_admin_audit_events where trader_organization_id = $1 and event_type = 'deleted') as delete_audits", [fixture.sellerOrganizationId]);
    assert(rows[0].seller_count === 0 && rows[0].delete_audits === 1, `${raceName}: committed delete did not leave exactly one tombstone.`);
  } finally {
    if (aOpen) await rollback(a);
    if (bOpen) await rollback(b);
    await cleanup(observer, fixture);
  }
}

validateLocalDatabaseUrl(databaseUrl);
const clients = Object.fromEntries(['a', 'b', 'observer'].map((name) => [name, new Client({ connectionString: databaseUrl, connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs, application_name: `seller-admin-concurrency-${name}` })]));
try {
  await Promise.all(Object.values(clients).map((client) => client.connect()));
  await Promise.all(Object.values(clients).map(configure));
  const pids = Object.fromEntries(await Promise.all(Object.entries(clients).map(async ([name, client]) => [name, (await client.query('select pg_backend_pid() as pid')).rows[0].pid])));
  await raceDependencyWins({ ...clients, pids });
  await raceDeleteWins({ ...clients, pids });
  console.log('SELLER organization administration concurrency regression tests passed: 2 races.');
} catch (error) {
  console.error(`SELLER organization administration concurrency regression tests failed: ${error.stack ?? error.message}`);
  process.exitCode = 1;
} finally {
  await Promise.all(Object.values(clients).map(async (client) => { await rollback(client); await client.end().catch(() => {}); }));
}
