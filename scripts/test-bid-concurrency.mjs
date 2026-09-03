import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const [databaseUrl] = process.argv.slice(2);
const timeoutMs = 10_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

async function asBuyer(client, fixture, callback) {
  await client.query('begin');
  try {
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [fixture.userId]);
    const result = await callback();
    await client.query('commit');
    return result;
  } catch (error) {
    await rollback(client);
    throw error;
  }
}

async function createFixture(client, label) {
  const fixture = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    membershipId: randomUUID(),
    publishSellerOrganizationId: randomUUID(),
    deactivationFirstSellerOrganizationId: randomUUID(),
    bidIds: [],
  };
  await client.query('insert into auth.users (id, email) values ($1, $2)', [fixture.userId, `${fixture.userId}@bid-race.test`]);
  await client.query("update app_private.user_accounts set status = 'active' where user_id = $1", [fixture.userId]);
  await client.query(
    "insert into app_private.organizations (id, kind, name, status) values ($1, 'buyer', $2, 'active'), ($3, 'trader', $4, 'active'), ($5, 'trader', $6, 'active')",
    [fixture.organizationId, `Bid race ${label}`, fixture.publishSellerOrganizationId, `Bid race seller ${label}`, fixture.deactivationFirstSellerOrganizationId, `Bid race deactivation-first seller ${label}`],
  );
  await client.query("insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values ($1, $2, $3, 'buyer_admin', 'active')", [fixture.membershipId, fixture.userId, fixture.organizationId]);
  return fixture;
}

async function beginAsBuyer(client, fixture) {
  await client.query('begin');
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [fixture.userId]);
}

async function createBid(client, fixture, suffix) {
  const { rows } = await asBuyer(client, fixture, () => client.query(
    `select (public.create_bid($1, $2, 'Busan', 'window', clock_timestamp() + interval '1 day', null, array['vlsfo'], array[10]::numeric[], array[$3]::uuid[])).id as id`,
    [fixture.membershipId, `race-${suffix}`, fixture.publishSellerOrganizationId],
  ));
  fixture.bidIds.push(rows[0].id);
  return rows[0].id;
}

async function closeBid(client, fixture, bidId) {
  await asBuyer(client, fixture, () => client.query('select public.close_bid($1, $2, 1)', [fixture.membershipId, bidId]));
}

async function waitForLock(observer, waitingPid, blockingPid, raceName) {
  const until = Date.now() + 5_000;
  while (Date.now() < until) {
    const { rows } = await observer.query('select wait_event_type, pg_blocking_pids(pid) as blockers from pg_stat_activity where pid = $1', [waitingPid]);
    if (rows[0]?.wait_event_type === 'Lock' && rows[0].blockers.map(Number).includes(Number(blockingPid))) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${raceName}: session B did not block on session A.`);
}

async function outcome(promise) {
  try { return { ok: true, value: await promise }; } catch (error) { return { ok: false, error }; }
}

async function publishWinsDeactivationRace({ fixture, clients, pids }) {
  const name = 'publish-vs-deactivation-publish-wins';
  const vessel = `${name}-${randomUUID()}`;
  let bidId;
  let firstOpen = false;
  let secondOpen = false;
  try {
    await beginAsBuyer(clients.a, fixture); firstOpen = true;
    const { rows } = await clients.a.query(
      `select (public.create_bid($1, $2, 'Busan', 'window', clock_timestamp() + interval '1 day', null, array['vlsfo'], array[10]::numeric[], array[$3]::uuid[])).id as id`,
      [fixture.membershipId, vessel, fixture.publishSellerOrganizationId],
    );
    bidId = rows[0].id;
    fixture.bidIds.push(bidId);

    await beginAsBuyer(clients.b, fixture); secondOpen = true;
    const pendingDeactivation = clients.b.query(
      'select organization_status from public.deactivate_trader_organization($1, $2)',
      [fixture.membershipId, fixture.publishSellerOrganizationId],
    );
    pendingDeactivation.catch(() => {});
    await waitForLock(clients.observer, pids.b, pids.a, name);

    const { rows: blockedRows } = await clients.observer.query(
      `select organization.status::text as status,
              (select count(*)::int from app_private.trader_organization_admin_audit_events as event where event.trader_organization_id = organization.id and event.event_type = 'deactivated') as deactivation_audits
       from app_private.organizations as organization
       where organization.id = $1`,
      [fixture.publishSellerOrganizationId],
    );
    assert(blockedRows[0]?.status === 'active' && blockedRows[0].deactivation_audits === 0, `${name}: deactivation became visible before Publish committed.`);

    await clients.a.query('commit'); firstOpen = false;
    const deactivation = await outcome(pendingDeactivation);
    assert(deactivation.ok && deactivation.value.rows[0]?.organization_status === 'inactive', `${name}: deactivation did not resume successfully after Publish commit.`);
    await clients.b.query('commit'); secondOpen = false;

    const { rows: resultRows } = await clients.observer.query(
      `select organization.status::text as organization_status,
              (select count(*)::int from app_private.bid_trader_organization_access as access where access.bid_id = $1 and access.trader_organization_id = $2) as access_count,
              (select count(*)::int from app_private.bid_trader_organization_responses as response where response.bid_id = $1 and response.trader_organization_id = $2 and response.response_status = 'awaiting') as awaiting_count,
              (select count(*)::int from app_private.bid_audit_events as event where event.bid_id = $1 and event.event_type = 'created') as created_audit_count,
              (select count(*)::int from app_private.trader_organization_admin_audit_events as event where event.trader_organization_id = $2 and event.event_type = 'deactivated') as deactivation_audit_count
       from app_private.organizations as organization
       where organization.id = $2`,
      [bidId, fixture.publishSellerOrganizationId],
    );
    const result = resultRows[0];
    assert(result?.organization_status === 'inactive', `${name}: SELLER was not deactivated after Publish committed.`);
    assert(result.access_count === 1 && result.awaiting_count === 1, `${name}: published BID lost selected access or its awaiting response.`);
    assert(result.created_audit_count === 1, `${name}: published BID must have exactly one created audit.`);
    assert(result.deactivation_audit_count === 1, `${name}: SELLER deactivation must have exactly one audit.`);
  } finally {
    if (firstOpen) await rollback(clients.a);
    if (secondOpen) await rollback(clients.b);
  }
}

async function deactivationWinsPublishRace({ fixture, clients, pids }) {
  const name = 'publish-vs-deactivation-deactivation-wins';
  const vessel = `${name}-${randomUUID()}`;
  let firstOpen = false;
  let secondOpen = false;
  try {
    await beginAsBuyer(clients.a, fixture); firstOpen = true;
    const { rows } = await clients.a.query(
      'select organization_status from public.deactivate_trader_organization($1, $2)',
      [fixture.membershipId, fixture.deactivationFirstSellerOrganizationId],
    );
    assert(rows[0]?.organization_status === 'inactive', `${name}: first transaction did not stage deactivation.`);

    await beginAsBuyer(clients.b, fixture); secondOpen = true;
    const pendingPublish = clients.b.query(
      `select (public.create_bid($1, $2, 'Busan', 'window', clock_timestamp() + interval '1 day', null, array['vlsfo'], array[10]::numeric[], array[$3]::uuid[])).id as id`,
      [fixture.membershipId, vessel, fixture.deactivationFirstSellerOrganizationId],
    );
    pendingPublish.catch(() => {});
    await waitForLock(clients.observer, pids.b, pids.a, name);

    const { rows: blockedRows } = await clients.observer.query(
      `select organization.status::text as status,
              (select count(*)::int from app_private.bids as bid where bid.created_by = $2 and bid.vessel_voyage = $3) as bid_count
       from app_private.organizations as organization
       where organization.id = $1`,
      [fixture.deactivationFirstSellerOrganizationId, fixture.userId, vessel],
    );
    assert(blockedRows[0]?.status === 'active' && blockedRows[0].bid_count === 0, `${name}: uncommitted deactivation or blocked Publish became visible.`);

    await clients.a.query('commit'); firstOpen = false;
    const publish = await outcome(pendingPublish);
    assert(!publish.ok && publish.error.code === '22023' && publish.error.message === 'Selected SELLER organizations must be active', `${name}: Publish must fail with the selected-active-SELLER validation error.`);
    await clients.b.query('rollback'); secondOpen = false;

    const { rows: resultRows } = await clients.observer.query(
      `select
         (select count(*)::int from app_private.bids as bid where bid.created_by = $1 and bid.vessel_voyage = $2) as bid_count,
         (select count(*)::int from app_private.bid_trader_organization_access as access join app_private.bids as bid on bid.id = access.bid_id where bid.created_by = $1 and bid.vessel_voyage = $2) as access_count,
         (select count(*)::int from app_private.bid_trader_organization_responses as response join app_private.bids as bid on bid.id = response.bid_id where bid.created_by = $1 and bid.vessel_voyage = $2) as response_count,
         (select count(*)::int from app_private.bid_audit_events as event join app_private.bids as bid on bid.id = event.bid_id where bid.created_by = $1 and bid.vessel_voyage = $2 and event.event_type = 'created') as created_audit_count`,
      [fixture.userId, vessel],
    );
    const result = resultRows[0];
    assert(result.bid_count === 0 && result.access_count === 0 && result.response_count === 0 && result.created_audit_count === 0, `${name}: failed Publish left BID, access, response, or created-audit residue.`);
  } finally {
    if (firstOpen) await rollback(clients.a);
    if (secondOpen) await rollback(clients.b);
  }
}

async function race({ name, fixture, clients, pids, firstQuery, secondQuery, expectedEvent, expectedStatus, expectedVessel, expectedQuantity }) {
  const bidId = await createBid(clients.observer, fixture, name);
  if (name === 'reopen-vs-cancel') await closeBid(clients.observer, fixture, bidId);
  const expectedRevision = name === 'reopen-vs-cancel' ? 2 : 1;
  let firstOpen = false;
  let secondOpen = false;
  try {
    await clients.a.query('begin'); firstOpen = true;
    await clients.a.query('set local role authenticated');
    await clients.a.query("select set_config('request.jwt.claim.sub', $1, true)", [fixture.userId]);
    await firstQuery(bidId, expectedRevision);
    await clients.b.query('begin'); secondOpen = true;
    await clients.b.query('set local role authenticated');
    await clients.b.query("select set_config('request.jwt.claim.sub', $1, true)", [fixture.userId]);
    const pendingSecond = secondQuery(bidId, expectedRevision);
    pendingSecond.catch(() => {});
    await waitForLock(clients.observer, pids.b, pids.a, name);
    await clients.a.query('commit'); firstOpen = false;
    const loser = await outcome(pendingSecond);
    assert(!loser.ok && loser.error.code === '40001', `${name}: loser must receive 40001, got ${loser.ok ? 'success' : loser.error.code}`);
    await clients.b.query('rollback'); secondOpen = false;
    const { rows } = await clients.observer.query(
      `select bid.revision, bid.status::text as status, bid.vessel_voyage,
              (select count(*)::int from app_private.bid_items as item where item.bid_id = bid.id) as item_count,
              (select quantity_mt from app_private.bid_items as item where item.bid_id = bid.id and item.fuel_grade = 'vlsfo') as vlsfo_quantity,
              (select count(*)::int from app_private.bid_audit_events as event where event.bid_id = bid.id and event.resulting_revision = bid.revision) as final_revision_events,
              (select count(*)::int from app_private.bid_audit_events as event where event.bid_id = bid.id and event.event_type = $2 and event.resulting_revision = bid.revision) as expected_events
       from app_private.bids as bid
       where bid.id = $1`,
      [bidId, expectedEvent],
    );
    assert(rows.length === 1 && Number(rows[0].revision) === expectedRevision + 1, `${name}: final revision did not increase exactly once.`);
    assert(rows[0].status === expectedStatus, `${name}: final raw status is not ${expectedStatus}.`);
    assert(rows[0].vessel_voyage === expectedVessel, `${name}: winner data was silently overwritten.`);
    assert(rows[0].item_count === 1 && Number(rows[0].vlsfo_quantity) === expectedQuantity, `${name}: final fuel items are inconsistent.`);
    assert(rows[0].final_revision_events === 1 && rows[0].expected_events === 1, `${name}: final revision must have exactly one expected audit event.`);
  } finally {
    if (firstOpen) await rollback(clients.a);
    if (secondOpen) await rollback(clients.b);
  }
}

async function cleanup(client, fixture) {
  await client.query('begin');
  try {
    await client.query("set local session_replication_role = 'replica'");
    await client.query(
      'delete from app_private.trader_organization_admin_audit_events where trader_organization_id = any($1::uuid[])',
      [[fixture.publishSellerOrganizationId, fixture.deactivationFirstSellerOrganizationId]],
    );
    await client.query("set local session_replication_role = 'origin'");
    for (const bidId of fixture.bidIds) {
      await client.query('delete from app_private.bid_trader_organization_responses where bid_id = $1', [bidId]);
      await client.query('delete from app_private.bid_trader_organization_access where bid_id = $1', [bidId]);
      await client.query('delete from app_private.bid_audit_events where bid_id = $1', [bidId]);
      await client.query('delete from app_private.bid_items where bid_id = $1', [bidId]);
      await client.query('delete from app_private.bids where id = $1', [bidId]);
    }
    await client.query('delete from app_private.organization_memberships where id = $1', [fixture.membershipId]);
    await client.query('delete from app_private.organizations where id = any($1::uuid[])', [[fixture.organizationId, fixture.publishSellerOrganizationId, fixture.deactivationFirstSellerOrganizationId]]);
    await client.query('delete from auth.users where id = $1', [fixture.userId]);
    await client.query('commit');
  } catch (error) {
    await rollback(client);
    throw error;
  }
}

validateLocalDatabaseUrl(databaseUrl);
const clients = Object.fromEntries(['a', 'b', 'observer'].map((name) => [name, new Client({ connectionString: databaseUrl, connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs, application_name: `bid-concurrency-${name}` })]));
let fixture;
let primaryError;
try {
  await Promise.all(Object.values(clients).map((client) => client.connect()));
  await Promise.all(Object.values(clients).map(configure));
  const pids = Object.fromEntries(await Promise.all(Object.entries(clients).map(async ([name, client]) => [name, (await client.query('select pg_backend_pid() as pid')).rows[0].pid])));
  fixture = await createFixture(clients.observer, randomUUID());
  await race({ name: 'update-vs-update', fixture, clients, pids, expectedEvent: 'details_updated', expectedStatus: 'open', expectedVessel: 'A', expectedQuantity: 11, firstQuery: (id, rev) => clients.a.query("select public.update_bid($1, $2, $3, 'A', 'Busan', 'window', clock_timestamp() + interval '2 days', array['vlsfo'], array[11]::numeric[])", [fixture.membershipId, id, rev]), secondQuery: (id, rev) => clients.b.query("select public.update_bid($1, $2, $3, 'B', 'Busan', 'window', clock_timestamp() + interval '2 days', array['vlsfo'], array[12]::numeric[])", [fixture.membershipId, id, rev]) });
  await race({ name: 'update-vs-close', fixture, clients, pids, expectedEvent: 'details_updated', expectedStatus: 'open', expectedVessel: 'A', expectedQuantity: 11, firstQuery: (id, rev) => clients.a.query("select public.update_bid($1, $2, $3, 'A', 'Busan', 'window', clock_timestamp() + interval '2 days', array['vlsfo'], array[11]::numeric[])", [fixture.membershipId, id, rev]), secondQuery: (id, rev) => clients.b.query('select public.close_bid($1, $2, $3)', [fixture.membershipId, id, rev]) });
  await race({ name: 'reopen-vs-cancel', fixture, clients, pids, expectedEvent: 'reopened', expectedStatus: 'open', expectedVessel: `race-reopen-vs-cancel`, expectedQuantity: 10, firstQuery: (id, rev) => clients.a.query("select public.reopen_bid($1, $2, $3, clock_timestamp() + interval '2 days')", [fixture.membershipId, id, rev]), secondQuery: (id, rev) => clients.b.query('select public.cancel_bid($1, $2, $3)', [fixture.membershipId, id, rev]) });
  await publishWinsDeactivationRace({ fixture, clients, pids });
  await deactivationWinsPublishRace({ fixture, clients, pids });
  console.log('Bid concurrency tests passed: 5 deterministic races.');
} catch (error) {
  primaryError = error;
} finally {
  const cleanupErrors = [];
  if (fixture) await cleanup(clients.observer, fixture).catch((error) => cleanupErrors.push(error));
  await Promise.all(Object.values(clients).map(async (client) => { await rollback(client); await client.end().catch((error) => cleanupErrors.push(error)); }));
  if (primaryError || cleanupErrors.length) {
    console.error(`Bid concurrency tests failed: ${(primaryError ?? cleanupErrors[0]).stack ?? (primaryError ?? cleanupErrors[0]).message}`);
    if (cleanupErrors.length) console.error(`Cleanup errors: ${cleanupErrors.map((error) => error.message).join('; ')}`);
    process.exitCode = 1;
  }
}
