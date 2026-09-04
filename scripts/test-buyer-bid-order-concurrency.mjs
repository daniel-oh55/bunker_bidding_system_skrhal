import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const databaseUrl = process.argv[2];
const timeoutMs = 10_000;
const waitLimitMs = 5_000;
const ids = { user: randomUUID(), organization: randomUUID(), membership: randomUUID(), bidA: randomUUID(), bidB: randomUUID(), bidC: randomUUID() };

function assert(condition, message) { if (!condition) throw new Error(message); }
function validateLocalDatabaseUrl(value) {
  const parsed = new URL(value);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  assert(['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1'].includes(host), `Refusing non-local database host: ${parsed.hostname}`);
}
async function rollback(client) { await client.query('rollback').catch(() => {}); }
async function beginBuyer(client) {
  await client.query('begin');
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ids.user]);
}
async function outcome(promise) { try { return { ok: true, value: await promise }; } catch (error) { return { ok: false, error }; } }
async function waitForBlocked(observer, waiterPid, blockerPid, name) {
  const deadline = Date.now() + waitLimitMs;
  while (Date.now() < deadline) {
    const { rows } = await observer.query('select $2::integer = any(pg_blocking_pids($1::integer)) as blocked', [waiterPid, blockerPid]);
    if (rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${name}: second session was not blocked by the first session`);
}
async function save(client, expectedRevision, orderedIds) {
  return client.query('select * from public.save_my_bid_order($1, $2::date, $3, $4::uuid[])', [ids.membership, '2026-09-03', expectedRevision, orderedIds]);
}
async function fixture(observer) {
  await observer.query('begin');
  try {
    await observer.query('insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3::jsonb, $3::jsonb)', [ids.user, `order-race-${ids.user}@test.local`, '{}']);
    await observer.query("update app_private.user_accounts set status = 'active' where user_id = $1", [ids.user]);
    await observer.query("insert into app_private.organizations (id, kind, name, status) values ($1, 'buyer', $2, 'active')", [ids.organization, `Order race ${ids.organization}`]);
    await observer.query("insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values ($1, $2, $3, 'buyer_operator', 'active')", [ids.membership, ids.user, ids.organization]);
    for (const [index, bidId] of [ids.bidA, ids.bidB, ids.bidC].entries()) await observer.query(
      "insert into app_private.bids (id, vessel_voyage, port_name, delivery_window, status, created_by, responsible_buyer_user_id, bid_date) values ($1, $2, 'Busan', 'Window', 'open', $3, $3, '2026-09-03')",
      [bidId, `Order race ${index}`, ids.user],
    );
    await observer.query('commit');
  } catch (error) { await rollback(observer); throw error; }
}
async function cleanup(observer) {
  await observer.query('begin');
  try {
    await observer.query('delete from app_private.buyer_bid_preferences where user_id = $1', [ids.user]);
    await observer.query('delete from app_private.buyer_bid_order_states where user_id = $1', [ids.user]);
    await observer.query('delete from app_private.bids where id = any($1::uuid[])', [[ids.bidA, ids.bidB, ids.bidC]]);
    await observer.query('delete from app_private.organization_memberships where id = $1', [ids.membership]);
    await observer.query('delete from app_private.organizations where id = $1', [ids.organization]);
    await observer.query('delete from auth.users where id = $1', [ids.user]);
    await observer.query('commit');
  } catch (error) { await rollback(observer); throw error; }
}
async function assertFinal(observer, expectedRevision, expectedOrder, name) {
  const { rows } = await observer.query(
    `select state.revision, array_agg(preference.bid_id order by preference.display_order) as ids, count(preference.*)::integer as count
     from app_private.buyer_bid_order_states state
     left join app_private.buyer_bid_preferences preference on preference.user_id = state.user_id and preference.bid_date = state.bid_date
     where state.user_id = $1 and state.bid_date = '2026-09-03'
     group by state.revision`, [ids.user],
  );
  assert(rows.length === 1 && Number(rows[0].revision) === expectedRevision, `${name}: final preference revision is wrong`);
  assert(rows[0].count === expectedOrder.length && JSON.stringify(rows[0].ids) === JSON.stringify(expectedOrder), `${name}: final order is mixed or partial`);
}

validateLocalDatabaseUrl(databaseUrl);
const clients = Object.fromEntries(['a', 'b', 'observer'].map((name) => [name, new Client({ connectionString: databaseUrl, connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs, application_name: `buyer-bid-order-race-${name}` })]));
let created = false;
try {
  await Promise.all(Object.values(clients).map((client) => client.connect()));
  const pids = Object.fromEntries(await Promise.all(Object.entries(clients).map(async ([name, client]) => [name, (await client.query('select pg_backend_pid() as pid')).rows[0].pid])));
  await fixture(clients.observer); created = true;

  const orderA = [ids.bidA, ids.bidB, ids.bidC]; const orderB = [ids.bidC, ids.bidB, ids.bidA];
  await beginBuyer(clients.a); await save(clients.a, 0, orderA);
  await beginBuyer(clients.b); const firstLoser = save(clients.b, 0, orderB); firstLoser.catch(() => {});
  await waitForBlocked(clients.observer, pids.b, pids.a, 'concurrent-first-save');
  await clients.a.query('commit');
  const firstResult = await outcome(firstLoser); assert(!firstResult.ok && firstResult.error.code === '40001', 'concurrent-first-save: loser must fail stale revision');
  await rollback(clients.b); await assertFinal(clients.observer, 1, orderA, 'concurrent-first-save');

  await beginBuyer(clients.a); await save(clients.a, 1, orderB);
  await beginBuyer(clients.b); const existingLoser = save(clients.b, 1, orderA); existingLoser.catch(() => {});
  await waitForBlocked(clients.observer, pids.b, pids.a, 'concurrent-existing-save');
  await clients.a.query('commit');
  const existingResult = await outcome(existingLoser); assert(!existingResult.ok && existingResult.error.code === '40001', 'concurrent-existing-save: loser must fail stale revision');
  await rollback(clients.b); await assertFinal(clients.observer, 2, orderB, 'concurrent-existing-save');
  console.log('Buyer BID order concurrency tests passed: 2 deterministic races.');
} catch (error) {
  console.error(`Buyer BID order concurrency tests failed: ${error.stack ?? error.message}`);
  process.exitCode = 1;
} finally {
  await Promise.all([rollback(clients.a), rollback(clients.b)]);
  if (created) await cleanup(clients.observer).catch((error) => { console.error(`Buyer BID order concurrency cleanup failed: ${error.message}`); process.exitCode = 1; });
  await Promise.all(Object.values(clients).map((client) => client.end().catch(() => {})));
}
