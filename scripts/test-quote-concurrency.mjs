import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const [databaseUrl] = process.argv.slice(2);
const timeoutMs = 10_000;
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1']);
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
async function rollback(client) { try { await client.query('rollback'); } catch { /* final cleanup continues */ } }
async function caller(client, userId, work) {
  await client.query('begin');
  try { await client.query('set local role authenticated'); await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]); const result = await work(); await client.query('commit'); return result; } catch (error) { await rollback(client); throw error; }
}
async function waitForLock(observer, waitingPid, blockingPid, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await observer.query('select wait_event_type, pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1', [waitingPid]);
    if (rows[0]?.wait_event_type === 'Lock' && rows[0].blockers.map(Number).includes(Number(blockingPid))) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${label}: waiting session did not block on the bid row.`);
}
async function result(promise) { try { await promise; return null; } catch (error) { return error; } }
async function assertFinalQuote(observer, { bidId, quoteId }, expected, label) {
  const { rows: [row] } = await observer.query(`
    select bid.status::text bid_status, bid.revision bid_revision, quote.revision quote_revision,
      response.response_status, response.revision response_revision,
      quote.barge_fee, (select item.unit_price from app_private.quote_items item where item.quote_id=quote.id and item.fuel_grade='vlsfo') unit_price,
      quote.barge_fee + (select coalesce(sum(item.unit_price * bid_item.quantity_mt),0) from app_private.quote_items item join app_private.bid_items bid_item on bid_item.bid_id=bid.id and bid_item.fuel_grade=item.fuel_grade where item.quote_id=quote.id) total_amount,
      (select count(*) from app_private.quote_items item where item.quote_id=quote.id) item_count,
      (select array_agg(item.fuel_grade order by item.display_order) from app_private.quote_items item where item.quote_id=quote.id) grades,
      (select count(*) from app_private.quote_audit_events audit where audit.quote_id=quote.id and audit.resulting_revision=quote.revision) final_revision_audits,
      (select count(*) from app_private.quote_audit_events audit where audit.quote_id=quote.id) audit_count,
      (select count(*) from app_private.bid_trader_organization_response_audit_events audit where audit.bid_id=bid.id and audit.trader_organization_id=quote.trader_organization_id) response_audit_count
    from app_private.bids bid
    join app_private.quotes quote on quote.id=$2
    join app_private.bid_trader_organization_responses response on response.bid_id=bid.id and response.trader_organization_id=quote.trader_organization_id
    where bid.id=$1`, [bidId, quoteId]);
  assert(row?.bid_status === expected.bidStatus && Number(row.bid_revision) === expected.bidRevision && Number(row.quote_revision) === expected.quoteRevision, `${label}: final revisions or bid status are wrong`);
  assert(row.response_status === expected.responseStatus && Number(row.response_revision) === expected.responseRevision && Number(row.response_audit_count) === expected.responseAuditCount, `${label}: final response state or audit count is wrong`);
  assert(Number(row.unit_price) === expected.unitPrice && Number(row.barge_fee) === 5 && Number(row.total_amount) === expected.total, `${label}: final commercial values were silently overwritten`);
  assert(Number(row.item_count) === 1 && JSON.stringify(row.grades) === JSON.stringify(['vlsfo']) && Number(row.final_revision_audits) === 1 && Number(row.audit_count) === expected.auditCount, `${label}: item or audit final invariant is wrong`);
}

async function fixture(client) {
  const ids = { buyer: randomUUID(), buyerOrg: randomUUID(), buyerMembership: randomUUID(), trader: randomUUID(), traderOrg: randomUUID(), traderMembership: randomUUID(), publishSellerOrg: randomUUID(), bids: [], quotes: [] };
  for (const [userId, email] of [[ids.buyer, 'buyer'], [ids.trader, 'trader']]) await client.query('insert into auth.users(id,email) values($1,$2)', [userId, `${email}-${userId}@quote-race.test`]);
  await client.query("update app_private.user_accounts set status='active' where user_id=any($1::uuid[])", [[ids.buyer, ids.trader]]);
  await client.query("insert into app_private.organizations(id,kind,name,status) values($1,'buyer',$2,'active'),($3,'trader',$4,'inactive'),($5,'trader',$6,'active')", [ids.buyerOrg, `buyer-${ids.buyerOrg}`, ids.traderOrg, `trader-${ids.traderOrg}`, ids.publishSellerOrg, `publish-seller-${ids.publishSellerOrg}`]);
  await client.query("insert into app_private.organization_memberships(id,user_id,organization_id,role,status) values($1,$2,$3,'buyer_admin','active'),($4,$5,$6,'trader','active')", [ids.buyerMembership, ids.buyer, ids.buyerOrg, ids.traderMembership, ids.trader, ids.traderOrg]);
  return ids;
}
async function bidWithQuote(observer, ids, label, deadline = "clock_timestamp() + interval '1 day'") {
  await observer.query("update app_private.organizations set status='inactive' where id=$1", [ids.traderOrg]);
  const { rows: bidRows } = await caller(observer, ids.buyer, () => observer.query(`select (public.create_bid($1,$2,'Busan','window',${deadline},null,array['vlsfo'],array[10]::numeric[],array[$3]::uuid[])).id id`, [ids.buyerMembership, label, ids.publishSellerOrg]));
  const bidId = bidRows[0].id; ids.bids.push(bidId);
  await observer.query("update app_private.organizations set status='active' where id=$1", [ids.traderOrg]);
  await caller(observer, ids.buyer, () => observer.query('select public.grant_bid_trader_access($1,$2,1,$3)', [ids.buyerMembership, bidId, ids.traderOrg]));
  const { rows: quoteRows } = await caller(observer, ids.trader, () => observer.query("select (public.submit_quote_response($1,$2,1,null,array['vlsfo'],array[100]::numeric[],5)).id id", [ids.traderMembership, bidId]));
  ids.quotes.push(quoteRows[0].id);
  return { bidId, quoteId: quoteRows[0].id, bidRevision: 2, quoteRevision: 1 };
}
async function beginAs(client, userId) { await client.query('begin'); await client.query('set local role authenticated'); await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]); }
async function cleanup(client, ids) {
  await client.query('begin');
  try {
    await client.query('alter table app_private.bid_trader_organization_response_audit_events disable trigger reject_response_audit_delete');
    for (const bidId of ids.bids) await client.query("update app_private.bids set status='closed', awarded_quote_id=null, awarded_at=null, closed_at=coalesce(closed_at,clock_timestamp()) where id=$1 and status='awarded'", [bidId]);
    for (const bidId of ids.bids) await client.query('delete from app_private.bid_trader_organization_response_audit_events where bid_id=$1', [bidId]);
    for (const quoteId of ids.quotes) { await client.query('delete from app_private.quote_audit_events where quote_id=$1', [quoteId]); await client.query('delete from app_private.quote_items where quote_id=$1', [quoteId]); }
    for (const bidId of ids.bids) { await client.query('delete from app_private.bid_trader_organization_access where bid_id=$1', [bidId]); await client.query('delete from app_private.quotes where bid_id=$1', [bidId]); await client.query('delete from app_private.bid_trader_organization_responses where bid_id=$1', [bidId]); await client.query('delete from app_private.bid_audit_events where bid_id=$1', [bidId]); await client.query('delete from app_private.bid_items where bid_id=$1', [bidId]); await client.query('delete from app_private.bids where id=$1', [bidId]); }
    await client.query('alter table app_private.bid_trader_organization_response_audit_events enable trigger reject_response_audit_delete');
    await client.query('commit');
  } catch (error) { await rollback(client); throw error; }
  await client.query('delete from app_private.organization_memberships where id=any($1::uuid[])', [[ids.buyerMembership, ids.traderMembership]]);
  await client.query('delete from app_private.organizations where id=any($1::uuid[])', [[ids.buyerOrg, ids.traderOrg, ids.publishSellerOrg]]);
  await client.query('delete from auth.users where id=any($1::uuid[])', [[ids.buyer, ids.trader]]);
}

validateUrl(databaseUrl);
const clients = Object.fromEntries(['a', 'b', 'observer'].map((name) => [name, new Client({ connectionString: databaseUrl, application_name: `quote-concurrency-${name}`, connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs })]));
let ids; let failure;
try {
  await Promise.all(Object.values(clients).map((client) => client.connect())); await Promise.all(Object.values(clients).map(configure));
  const pids = Object.fromEntries(await Promise.all(Object.entries(clients).map(async ([name, client]) => [name, (await client.query('select pg_backend_pid() pid')).rows[0].pid])));
  ids = await fixture(clients.observer);

  { // update vs update: only the first revision wins.
    const x = await bidWithQuote(clients.observer, ids, 'update-update');
    await beginAs(clients.a, ids.trader); await clients.a.query("select public.submit_quote_response($1,$2,2,1,array['vlsfo'],array[101]::numeric[],5)", [ids.traderMembership, x.bidId]);
    await beginAs(clients.b, ids.trader); const waiting = clients.b.query("select public.submit_quote_response($1,$2,2,1,array['vlsfo'],array[102]::numeric[],5)", [ids.traderMembership, x.bidId]); waiting.catch(() => {});
    await waitForLock(clients.observer, pids.b, pids.a, 'update vs update'); await clients.a.query('commit'); const error = await result(waiting); assert(error?.code === '40001', 'update vs update loser must receive 40001'); await rollback(clients.b);
    const { rows } = await clients.observer.query('select revision,(select count(*) from app_private.quote_audit_events where quote_id=$1) audits from app_private.quotes where id=$1', [x.quoteId]); assert(Number(rows[0].revision) === 2 && Number(rows[0].audits) === 2, 'update vs update must increment revision and audit exactly once');
    await assertFinalQuote(clients.observer, x, { bidStatus: 'open', bidRevision: 2, quoteRevision: 2, responseStatus: 'quoted', responseRevision: 3, responseAuditCount: 2, unitPrice: 101, total: 1015, auditCount: 2 }, 'update vs update');
  }
  { // give-up wins while a price update is blocked behind the same BID/response lock order.
    const x = await bidWithQuote(clients.observer, ids, 'give-up-update');
    await beginAs(clients.a, ids.trader); await clients.a.query('select public.give_up_quote_response($1,$2,2)', [ids.traderMembership, x.bidId]);
    await beginAs(clients.b, ids.trader); const waiting = clients.b.query("select public.submit_quote_response($1,$2,2,1,array['vlsfo'],array[101]::numeric[],5)", [ids.traderMembership, x.bidId]); waiting.catch(() => {});
    await waitForLock(clients.observer, pids.b, pids.a, 'give-up vs update'); await clients.a.query('commit'); const error = await result(waiting); assert(error?.code === '40001', 'give-up vs update loser must receive 40001'); await rollback(clients.b);
    await assertFinalQuote(clients.observer, x, { bidStatus: 'open', bidRevision: 2, quoteRevision: 1, responseStatus: 'gave_up', responseRevision: 3, responseAuditCount: 2, unitPrice: 100, total: 1005, auditCount: 1 }, 'give-up vs update');
  }
  { // close wins while a quote update is blocked behind the same bid lock.
    const x = await bidWithQuote(clients.observer, ids, 'close-update');
    await beginAs(clients.a, ids.buyer); await clients.a.query('select public.close_bid($1,$2,2)', [ids.buyerMembership, x.bidId]);
    await beginAs(clients.b, ids.trader); const waiting = clients.b.query("select public.submit_quote_response($1,$2,2,1,array['vlsfo'],array[101]::numeric[],5)", [ids.traderMembership, x.bidId]); waiting.catch(() => {});
    await waitForLock(clients.observer, pids.b, pids.a, 'close vs update'); await clients.a.query('commit'); const error = await result(waiting); assert(error?.code === '55000', 'blocked post-close quote update must receive 55000'); await rollback(clients.b);
    const { rows } = await clients.observer.query('select (select count(*) from app_private.quote_audit_events where quote_id=$1) audits from app_private.quotes where id=$1', [x.quoteId]); assert(Number(rows[0].audits) === 1, 'close vs update must not append a post-close quote audit');
    await assertFinalQuote(clients.observer, x, { bidStatus: 'closed', bidRevision: 3, quoteRevision: 1, responseStatus: 'quoted', responseRevision: 2, responseAuditCount: 1, unitPrice: 100, total: 1005, auditCount: 1 }, 'close vs update');
  }
  { // the server-time check runs after a wait, not only at call start.
    const x = await bidWithQuote(clients.observer, ids, 'deadline-wait', "clock_timestamp() + interval '1 second'");
    await clients.a.query('begin'); await clients.a.query('select 1 from app_private.bids where id=$1 for update', [x.bidId]);
    await beginAs(clients.b, ids.trader); const waiting = clients.b.query("select public.submit_quote_response($1,$2,2,1,array['vlsfo'],array[101]::numeric[],5)", [ids.traderMembership, x.bidId]); waiting.catch(() => {});
    await waitForLock(clients.observer, pids.b, pids.a, 'deadline expiry'); await new Promise((resolve) => setTimeout(resolve, 1200)); await clients.a.query('commit'); const error = await result(waiting); assert(error?.code === '55000', 'deadline-expired waiting update must receive 55000'); await rollback(clients.b);
    await assertFinalQuote(clients.observer, x, { bidStatus: 'open', bidRevision: 2, quoteRevision: 1, responseStatus: 'quoted', responseRevision: 2, responseAuditCount: 1, unitPrice: 100, total: 1005, auditCount: 1 }, 'deadline expiry');
  }
  { // award and reopen share the bid revision; award deterministically obtains the lock first.
    const x = await bidWithQuote(clients.observer, ids, 'award-reopen'); await caller(clients.observer, ids.buyer, () => clients.observer.query('select public.close_bid($1,$2,2)', [ids.buyerMembership, x.bidId]));
    await beginAs(clients.a, ids.buyer); await clients.a.query('select public.award_bid($1,$2,3,$3,1)', [ids.buyerMembership, x.bidId, x.quoteId]);
    await beginAs(clients.b, ids.buyer); const waiting = clients.b.query("select public.reopen_bid($1,$2,3,clock_timestamp()+interval '1 day')", [ids.buyerMembership, x.bidId]); waiting.catch(() => {});
    await waitForLock(clients.observer, pids.b, pids.a, 'award vs reopen'); await clients.a.query('commit'); const error = await result(waiting); assert(error?.code === '40001', 'award vs reopen loser must receive 40001'); await rollback(clients.b);
    const { rows } = await clients.observer.query("select status::text status,revision,(select count(*) from app_private.bid_audit_events where bid_id=$1 and event_type='awarded') awards from app_private.bids where id=$1", [x.bidId]); assert(rows[0].status === 'awarded' && Number(rows[0].revision) === 4 && Number(rows[0].awards) === 1, 'award vs reopen must leave one awarded final state and audit');
    await assertFinalQuote(clients.observer, x, { bidStatus: 'awarded', bidRevision: 4, quoteRevision: 1, responseStatus: 'quoted', responseRevision: 2, responseAuditCount: 1, unitPrice: 100, total: 1005, auditCount: 1 }, 'award vs reopen');
  }
  console.log('Quote-response concurrency tests passed: 5 deterministic races.');
} catch (error) { failure = error; }
finally {
  const cleanupErrors = []; if (ids) await cleanup(clients.observer, ids).catch((error) => cleanupErrors.push(error));
  await Promise.all(Object.values(clients).map(async (client) => { await rollback(client); await client.end().catch((error) => cleanupErrors.push(error)); }));
  if (failure || cleanupErrors.length) { console.error(`Quote concurrency tests failed: ${(failure ?? cleanupErrors[0]).stack ?? (failure ?? cleanupErrors[0]).message}`); if (cleanupErrors.length) console.error(`Cleanup errors: ${cleanupErrors.map((error) => error.message).join('; ')}`); process.exitCode = 1; }
}
