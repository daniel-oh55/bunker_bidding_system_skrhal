import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const args = process.argv.slice(2);
const timeoutMs = 10_000;
const observationTimeoutMs = 5_000;
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1']);
const elevatedRole = ['service', 'role'].join('_');

class HarnessError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HarnessError';
  }
}

const assert = (value, message) => { if (!value) throw new HarnessError(message); };

function safeError(error) {
  return error instanceof HarnessError
    ? error.message
    : `${error?.name ?? 'database/client error'} (${error?.code ?? 'no code'})`;
}

function validateUrl(values) {
  assert(values.length === 1, 'Expected exactly one local PostgreSQL URL.');
  let parsed;
  try {
    parsed = new URL(values[0]);
  } catch {
    throw new HarnessError('Expected a valid local PostgreSQL URL.');
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  assert(['postgres:', 'postgresql:'].includes(parsed.protocol) && loopbackHosts.has(host), 'Refusing non-loopback database host.');
  return values[0];
}

async function configure(client) {
  await client.query("set statement_timeout = '10s'");
  await client.query("set lock_timeout = '5s'");
  await client.query("set idle_in_transaction_session_timeout = '10s'");
}

async function rollback(client) {
  try { await client.query('rollback'); } catch { /* final cleanup continues */ }
}

async function beginAsConnector(client) {
  await client.query('begin isolation level read committed');
  await client.query(`set local role ${elevatedRole}`);
}

async function waitForUniqueIndexLock(observer, waitingPid, blockingPid, label) {
  const deadline = Date.now() + observationTimeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await observer.query(
      'select wait_event_type, pg_blocking_pids(pid) blockers from pg_stat_activity where pid = $1',
      [waitingPid],
    );
    if (rows[0]?.wait_event_type === 'Lock' && rows[0].blockers.map(Number).includes(Number(blockingPid))) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new HarnessError(`${label}: waiting ingest was not observed blocked by the first transaction.`);
}

async function ingest(client, identity, subject) {
  const { rows } = await client.query(
    `select public.ingest_mail_intake_item(
      $1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9::jsonb, $10::jsonb
    ) id`,
    [
      identity.provider,
      identity.mailboxKey,
      identity.messageId,
      '2026-08-21 03:00:00+00',
      subject,
      `${subject} vessel`,
      `${subject} port`,
      `${subject} window`,
      JSON.stringify([{
        grade: 'vlsfo',
        quantity: {
          'A commit winner': 101,
          'B commit loser': 202,
          'A rollback candidate': 303,
          'B rollback winner': 404,
        }[subject],
      }]),
      JSON.stringify([`${subject} warning`]),
    ],
  );
  return rows[0]?.id;
}

async function assertFinalRow(observer, identity, expected) {
  const { rows } = await observer.query(
    `select id, subject, vessel_voyage, port_name, delivery_window, fuel_items, warnings,
       status::text status, revision
     from app_private.mail_intake_items
     where source_provider = $1 and source_mailbox_key = $2 and source_message_id = $3`,
    [identity.provider, identity.mailboxKey, identity.messageId],
  );
  assert(rows.length === 1, `${expected.label}: source identity must have exactly one row.`);
  const row = rows[0];
  assert(row.id === expected.id, `${expected.label}: stored UUID does not match the returned UUID.`);
  assert(row.status === 'pending' && Number(row.revision) === 1, `${expected.label}: final status or revision is wrong.`);
  assert(row.subject === expected.subject, `${expected.label}: losing candidate overwrote the subject.`);
  assert(row.vessel_voyage === `${expected.subject} vessel`, `${expected.label}: losing candidate overwrote vessel/voyage.`);
  assert(row.port_name === `${expected.subject} port`, `${expected.label}: losing candidate overwrote port.`);
  assert(row.delivery_window === `${expected.subject} window`, `${expected.label}: losing candidate overwrote delivery window.`);
  assert(JSON.stringify(row.fuel_items) === JSON.stringify([{ grade: 'vlsfo', quantity: expected.quantity }]), `${expected.label}: losing candidate overwrote fuel items.`);
  assert(JSON.stringify(row.warnings) === JSON.stringify([`${expected.subject} warning`]), `${expected.label}: losing candidate overwrote warnings.`);
}

async function main() {
const databaseUrl = validateUrl(args);
const runId = randomUUID();
const provider = 'race';
const mailboxKey = `mail-intake-${runId}`;
const identities = {
  commit: { provider, mailboxKey, messageId: `commit-${runId}` },
  rollback: { provider, mailboxKey, messageId: `rollback-${runId}` },
};
const clients = Object.fromEntries(
  ['a', 'b', 'observer'].map((name) => [name, new Client({
    connectionString: databaseUrl,
    application_name: `mail-intake-concurrency-${name}`,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
  })]),
);
let failure;

try {
  await Promise.all(Object.values(clients).map((client) => client.connect()));
  await Promise.all(Object.values(clients).map(configure));
  const pids = Object.fromEntries(await Promise.all(
    Object.entries(clients).map(async ([name, client]) => [
      name,
      (await client.query('select pg_backend_pid() pid')).rows[0].pid,
    ]),
  ));

  // Race 1: B waits for A's unique-index entry, then returns A's committed UUID.
  await beginAsConnector(clients.a);
  const commitWinnerId = await ingest(clients.a, identities.commit, 'A commit winner');
  assert(commitWinnerId, 'commit winner: session A did not return a UUID.');
  await beginAsConnector(clients.b);
  const commitWaiter = ingest(clients.b, identities.commit, 'B commit loser');
  commitWaiter.catch(() => {});
  await waitForUniqueIndexLock(clients.observer, pids.b, pids.a, 'commit winner');
  await clients.a.query('commit');
  const commitWaiterId = await commitWaiter;
  assert(commitWaiterId === commitWinnerId, 'commit winner: duplicate ingest returned a different UUID.');
  await clients.b.query('commit');
  await assertFinalRow(clients.observer, identities.commit, {
    label: 'commit winner', id: commitWinnerId, subject: 'A commit winner', quantity: 101,
  });

  // Race 2: B waits for A's unique-index entry, then inserts after A rolls back.
  await beginAsConnector(clients.a);
  const rolledBackId = await ingest(clients.a, identities.rollback, 'A rollback candidate');
  assert(rolledBackId, 'rollback winner: session A did not return a provisional UUID.');
  await beginAsConnector(clients.b);
  const rollbackWaiter = ingest(clients.b, identities.rollback, 'B rollback winner');
  rollbackWaiter.catch(() => {});
  await waitForUniqueIndexLock(clients.observer, pids.b, pids.a, 'rollback winner');
  await clients.a.query('rollback');
  const rollbackWinnerId = await rollbackWaiter;
  assert(rollbackWinnerId, 'rollback winner: session B did not return a UUID.');
  assert(rollbackWinnerId !== rolledBackId, 'rollback winner: session B reused the rolled-back UUID.');
  await clients.b.query('commit');
  await assertFinalRow(clients.observer, identities.rollback, {
    label: 'rollback winner', id: rollbackWinnerId, subject: 'B rollback winner', quantity: 404,
  });

  console.log('Mail intake concurrency tests passed: commit winner returned one unchanged UUID; rollback winner inserted one pending revision-1 row.');
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors = [];
  await Promise.all([clients.a, clients.b].map((client) => rollback(client)));
  await clients.observer.query(
    'delete from app_private.mail_intake_items where source_provider = $1 and source_mailbox_key = $2',
    [provider, mailboxKey],
  ).catch((error) => cleanupErrors.push(error));
  await Promise.all(Object.values(clients).map((client) => client.end().catch((error) => cleanupErrors.push(error))));
  if (failure || cleanupErrors.length) {
    const primary = failure ?? cleanupErrors[0];
    console.error(`Mail intake concurrency tests failed: ${safeError(primary)}`);
    if (cleanupErrors.length) {
      console.error(`Cleanup errors: ${cleanupErrors.map(safeError).join('; ')}`);
    }
    process.exitCode = 1;
  }
}
}

main().catch((error) => {
  console.error(`Mail intake concurrency tests failed: ${safeError(error)}`);
  process.exitCode = 1;
});
