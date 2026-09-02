import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const [databaseUrl] = process.argv.slice(2);
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1']);
const elevatedRole = ['service', 'role'].join('_');
const assert = (value, message) => { if (!value) throw new Error(message); };

function validateUrl(value) {
  assert(process.argv.length === 3, 'Expected exactly one local PostgreSQL URL.');
  const parsed = new URL(value);
  assert(['postgres:', 'postgresql:'].includes(parsed.protocol) && loopbackHosts.has(parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')), 'Refusing non-loopback database host.');
}
async function configure(client) {
  await client.query("set statement_timeout = '10s'");
  await client.query("set lock_timeout = '5s'");
  await client.query("set idle_in_transaction_session_timeout = '10s'");
}
async function rollback(client) { try { await client.query('rollback'); } catch { /* cleanup continues */ } }
async function asBuyer(client, fixture) {
  await client.query('begin');
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [fixture.buyerUserId]);
}
async function waitForLock(observer, waitingPid, blockingPid) {
  const until = Date.now() + 5_000;
  while (Date.now() < until) {
    const { rows } = await observer.query('select wait_event_type, pg_blocking_pids(pid) as blockers from pg_stat_activity where pid = $1', [waitingPid]);
    if (rows[0]?.wait_event_type === 'Lock' && rows[0].blockers.map(Number).includes(Number(blockingPid))) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Second publish was not observed waiting on the first intake row lock.');
}
async function createFixture(client) {
  const fixture = { buyerUserId: randomUUID(), buyerOrganizationId: randomUUID(), buyerMembershipId: randomUUID(), sellerOrganizationId: randomUUID(), intakeId: null, bidId: null };
  await client.query('insert into auth.users (id, email) values ($1, $2)', [fixture.buyerUserId, `${fixture.buyerUserId}@publish-race.test`]);
  await client.query("update app_private.user_accounts set status = 'active' where user_id = $1", [fixture.buyerUserId]);
  await client.query("insert into app_private.organizations (id, kind, name, status) values ($1, 'buyer', $2, 'active'), ($3, 'trader', $4, 'active')", [fixture.buyerOrganizationId, `Publish race buyer ${fixture.buyerUserId}`, fixture.sellerOrganizationId, `Publish race seller ${fixture.sellerOrganizationId}`]);
  await client.query("insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values ($1, $2, $3, 'buyer_operator', 'active')", [fixture.buyerMembershipId, fixture.buyerUserId, fixture.buyerOrganizationId]);
  await client.query('begin');
  await client.query(`set local role ${elevatedRole}`);
  const { rows } = await client.query("select public.ingest_mail_intake_item('race', $1, $2, clock_timestamp(), 'Race intake', 'Race vessel', 'Busan', 'Today', '[{\"grade\":\"vlsfo\",\"quantity\":10}]'::jsonb, '[]'::jsonb) as id", [fixture.buyerUserId, fixture.buyerMembershipId]);
  await client.query('commit');
  fixture.intakeId = rows[0].id;
  return fixture;
}
async function publish(client, fixture) {
  const { rows } = await client.query(
    "select result.id from public.publish_mail_intake_bid($1, $2, 1, 'Race vessel', 'Busan', 'Today', clock_timestamp() + interval '1 day', null, array['vlsfo'], array[10]::numeric[], array[$3]::uuid[]) as result",
    [fixture.buyerMembershipId, fixture.intakeId, fixture.sellerOrganizationId],
  );
  return rows[0]?.id;
}
async function cleanup(client, fixture) {
  if (!fixture) return;
  await client.query('delete from app_private.mail_intake_items where id = $1', [fixture.intakeId]);
  if (fixture.bidId) {
    await client.query('delete from app_private.bid_audit_events where bid_id = $1', [fixture.bidId]);
    await client.query('delete from app_private.bid_trader_organization_responses where bid_id = $1', [fixture.bidId]);
    await client.query('delete from app_private.bid_trader_organization_access where bid_id = $1', [fixture.bidId]);
    await client.query('delete from app_private.bid_items where bid_id = $1', [fixture.bidId]);
    await client.query('delete from app_private.bids where id = $1', [fixture.bidId]);
  }
  await client.query('delete from app_private.organization_memberships where id = $1', [fixture.buyerMembershipId]);
  await client.query('delete from app_private.organizations where id in ($1, $2)', [fixture.buyerOrganizationId, fixture.sellerOrganizationId]);
  await client.query('delete from auth.users where id = $1', [fixture.buyerUserId]);
}

validateUrl(databaseUrl);
const clients = Object.fromEntries(['a', 'b', 'observer'].map((name) => [name, new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000, query_timeout: 10_000, application_name: `mail-publish-race-${name}` })]));
let fixture; let failure;
try {
  await Promise.all(Object.values(clients).map((client) => client.connect()));
  await Promise.all(Object.values(clients).map(configure));
  const pids = Object.fromEntries(await Promise.all(Object.entries(clients).map(async ([name, client]) => [name, (await client.query('select pg_backend_pid() as pid')).rows[0].pid])));
  fixture = await createFixture(clients.observer);
  await asBuyer(clients.a, fixture);
  const firstPublish = await publish(clients.a, fixture);
  assert(firstPublish, 'First publish did not return a BID ID.');
  await asBuyer(clients.b, fixture);
  const secondPublish = publish(clients.b, fixture);
  secondPublish.catch(() => {});
  await waitForLock(clients.observer, pids.b, pids.a);
  await clients.a.query('commit');
  const repeatedBidId = await secondPublish;
  await clients.b.query('commit');
  assert(repeatedBidId === firstPublish, 'Concurrent publish did not return the first conversion BID.');
  fixture.bidId = firstPublish;
  const { rows } = await clients.observer.query(
    `select
      (select count(*)::int from app_private.bids where id = $1) as bids,
      (select count(*)::int from app_private.bid_trader_organization_access where bid_id = $1) as scope,
      (select count(*)::int from app_private.bid_trader_organization_responses where bid_id = $1 and response_status = 'awaiting') as responses,
      (select count(*)::int from app_private.bid_audit_events where bid_id = $1 and event_type = 'created') as audits,
      (select converted_bid_id from app_private.mail_intake_items where id = $2) as conversion_bid_id`,
    [fixture.bidId, fixture.intakeId],
  );
  assert(rows[0].bids === 1 && rows[0].scope === 1 && rows[0].responses === 1 && rows[0].audits === 1 && rows[0].conversion_bid_id === fixture.bidId, 'Concurrent publish did not preserve the one-BID conversion invariant.');
  console.log('Mail-intake publish concurrency passed: concurrent requests returned one BID with one selected scope, awaiting response, and created audit.');
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors = [];
  await Promise.all([clients.a, clients.b].map((client) => rollback(client)));
  if (clients.observer) await cleanup(clients.observer, fixture).catch((error) => cleanupErrors.push(error));
  await Promise.all(Object.values(clients).map((client) => client.end().catch((error) => cleanupErrors.push(error))));
  if (failure || cleanupErrors.length) {
    console.error(`Mail-intake publish concurrency failed: ${(failure ?? cleanupErrors[0]).message}`);
    if (cleanupErrors.length) console.error(`Cleanup errors: ${cleanupErrors.map((error) => error.message).join('; ')}`);
    process.exitCode = 1;
  }
}
