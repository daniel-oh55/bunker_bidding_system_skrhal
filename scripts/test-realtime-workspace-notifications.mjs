import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

const operationTimeoutMs = 10_000;
const quietTimeoutMs = 1_200;
const deniedSubscriptionTimeoutMs = 2_000;
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1']);

function assert(value, message) {
  if (!value) throw new Error(message);
}

function parseLoopbackUrl(value, protocols, label) {
  assert(value, `${label} is required.`);
  const parsed = new URL(value);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  assert(protocols.has(parsed.protocol) && loopbackHosts.has(host), `Refusing to use a non-loopback ${label}.`);
  return parsed;
}

async function within(operation, label, timeout = operationTimeoutMs) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded the ${timeout}ms timeout.`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function appClient(apiUrl, key) {
  return createClient(apiUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function notificationChannel(caller, topic, received) {
  return caller
    .channel(topic, { config: { private: true, broadcast: { self: false, ack: true } } })
    .on('broadcast', { event: 'workspace_changed' }, (message) => received.push(message))
    .on('broadcast', { event: 'access_changed' }, (message) => received.push(message));
}

async function subscribe(channel, label) {
  return await within(new Promise((resolve, reject) => {
    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') resolve();
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        reject(new Error(`${label} did not subscribe (${status}${error ? `: ${error.message ?? error}` : ''}).`));
      }
    });
  }), `${label} subscription`);
}

async function expectDeniedSubscription(caller, topic, label) {
  const channel = notificationChannel(caller, topic, []);
  let timer;
  try {
    const status = await new Promise((resolve, reject) => {
      timer = setTimeout(() => resolve('TIMED_OUT'), deniedSubscriptionTimeoutMs);
      channel.subscribe((nextStatus) => {
        if (nextStatus === 'SUBSCRIBED') resolve('SUBSCRIBED');
        if (nextStatus === 'CHANNEL_ERROR' || nextStatus === 'TIMED_OUT' || nextStatus === 'CLOSED') resolve(nextStatus);
      });
    });
    assert(status !== 'SUBSCRIBED', `${label} unexpectedly subscribed.`);
  } finally {
    clearTimeout(timer);
    await within(caller.removeChannel(channel), `${label} channel cleanup`, 1_000).catch(() => undefined);
  }
}

async function expectWorkspaceChanged(received, action, label) {
  const before = received.length;
  await action();
  await within(new Promise((resolve) => {
    const poll = () => {
      const message = received.slice(before).find((value) => value.payload?.kind === 'workspace_changed');
      if (message) resolve(message);
      else setTimeout(poll, 25);
    };
    poll();
  }), label);
}

async function expectNoWorkspaceChanged(received, action, label) {
  const before = received.length;
  await action();
  await new Promise((resolve) => setTimeout(resolve, quietTimeoutMs));
  assert(
    !received.slice(before).some((message) => message.payload?.kind === 'workspace_changed'),
    `${label} unexpectedly produced a workspace_changed notification.`,
  );
}

async function run() {
  const [apiUrl, publishableKey, fixtureKey, databaseUrl, ...unexpected] = process.argv.slice(2);
  assert(unexpected.length === 0, 'Expected local API URL, publishable key, elevated fixture key, and PostgreSQL URL.');
  parseLoopbackUrl(apiUrl, new Set(['http:', 'https:']), 'API URL');
  parseLoopbackUrl(databaseUrl, new Set(['postgres:', 'postgresql:']), 'database URL');
  assert(publishableKey && fixtureKey && publishableKey !== fixtureKey, 'Distinct publishable and elevated fixture keys are required.');

  const fixtureClient = appClient(apiUrl, fixtureKey);
  const database = new Client({
    connectionString: databaseUrl,
    application_name: 'realtime-workspace-notifications-integration',
    connectionTimeoutMillis: operationTimeoutMs,
    query_timeout: operationTimeoutMs,
    statement_timeout: operationTimeoutMs,
  });
  const state = { users: [], organizations: [], memberships: [], bidIds: [] };
  const callers = [];
  const channels = [];
  const cleanupErrors = [];
  let primaryError;

  async function query(sql, values = [], label = 'fixture database query') {
    return await within(database.query(sql, values), label);
  }

  async function createUser(label, accountStatus = 'active') {
    const email = `${label}-${randomUUID()}@realtime-integration.test`;
    const password = `Local-${randomUUID()}-9a!`;
    const { data, error } = await within(
      fixtureClient.auth.admin.createUser({ email, password, email_confirm: true }),
      `create ${label} fixture user`,
    );
    assert(!error && data.user, `Could not create ${label} fixture user.`);
    state.users.push(data.user.id);
    await query(`update app_private.user_accounts set status = $2 where user_id = $1`, [data.user.id, accountStatus], `set ${label} account status`);
    return { id: data.user.id, email, password };
  }

  async function createMembership(user, kind, role, label, { organizationStatus = 'active', membershipStatus = 'active' } = {}) {
    const organizationId = randomUUID();
    const membershipId = randomUUID();
    state.organizations.push(organizationId);
    state.memberships.push(membershipId);
    await query(
      `insert into app_private.organizations (id, kind, name, status) values ($1, $2, $3, $4)`,
      [organizationId, kind, `${label}-${organizationId}`, organizationStatus],
      `create ${label} organization`,
    );
    await query(
      `insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values ($1, $2, $3, $4, $5)`,
      [membershipId, user.id, organizationId, role, membershipStatus],
      `create ${label} membership`,
    );
    return { organizationId, membershipId };
  }

  async function addMembership(user, organizationId, label) {
    const membershipId = randomUUID();
    state.memberships.push(membershipId);
    await query(
      `insert into app_private.organization_memberships (id, user_id, organization_id, role, status) values ($1, $2, $3, 'trader', 'active')`,
      [membershipId, user.id, organizationId],
      `create ${label} membership`,
    );
    return { organizationId, membershipId };
  }

  async function signIn(user, label) {
    const caller = appClient(apiUrl, publishableKey);
    const { data, error } = await within(caller.auth.signInWithPassword({ email: user.email, password: user.password }), `${label} sign-in`);
    assert(!error && data.session, `${label} sign-in failed unexpectedly.`);
    callers.push(caller);
    return caller;
  }

  async function rpc(caller, name, args, label) {
    return await within(caller.rpc(name, args), label);
  }

  async function createScopedBid(buyerCaller, buyer, traderOrganizationId, suffix) {
    await query(
      `update app_private.organizations set status = 'inactive' where id = $1`,
      [traderOrganizationId],
      `deactivate TRADER organization before Bid ${suffix}`,
    );
    const create = await rpc(buyerCaller, 'create_bid', {
      p_actor_membership_id: buyer.membershipId,
      p_vessel_voyage: `Realtime Vessel ${suffix}`,
      p_port_name: 'Busan',
      p_delivery_window: 'Realtime window',
      p_deadline_at: new Date(Date.now() + 86_400_000).toISOString(),
      p_responsible_buyer_user_id: null,
      p_fuel_grades: ['vlsfo'],
      p_quantities: [10],
    }, `create Bid ${suffix}`);
    assert(!create.error && create.data?.id && create.data.revision === 1, `Could not create Bid ${suffix}${create.error ? ` (${create.error.code}: ${create.error.message})` : ''}.`);
    state.bidIds.push(create.data.id);
    await query(
      `update app_private.organizations set status = 'active' where id = $1`,
      [traderOrganizationId],
      `reactivate TRADER organization before Bid ${suffix} grant`,
    );
    const grant = await rpc(buyerCaller, 'grant_bid_trader_access', {
      p_actor_membership_id: buyer.membershipId,
      p_bid_id: create.data.id,
      p_expected_revision: create.data.revision,
      p_trader_organization_id: traderOrganizationId,
    }, `grant Bid ${suffix} scope`);
    assert(!grant.error && grant.data?.revision === 2, `Could not grant Bid ${suffix} scope.`);
    return { id: create.data.id, revision: grant.data.revision, vesselVoyage: `Realtime Vessel ${suffix}` };
  }

  async function updateBid(buyerCaller, buyer, bid, portName, label) {
    const result = await rpc(buyerCaller, 'update_bid', {
      p_actor_membership_id: buyer.membershipId,
      p_bid_id: bid.id,
      p_expected_revision: bid.revision,
      p_vessel_voyage: bid.vesselVoyage,
      p_port_name: portName,
      p_delivery_window: 'Realtime window',
      p_deadline_at: new Date(Date.now() + 86_400_000).toISOString(),
      p_fuel_grades: ['vlsfo'],
      p_quantities: [10],
    }, label);
    assert(!result.error && result.data?.revision === bid.revision + 1, `${label} failed.`);
    bid.revision = result.data.revision;
  }

  try {
    await within(database.connect(), 'connect to local database');
    const buyerUser = await createUser('buyer');
    const traderAUser = await createUser('trader-a');
    const traderACollaboratorUser = await createUser('trader-a-collaborator');
    const traderBUser = await createUser('trader-b');
    const noContextUser = await createUser('no-context');
    const suspendedAccountUser = await createUser('suspended-account', 'suspended');
    const suspendedMembershipUser = await createUser('suspended-membership');
    const suspendedOrganizationUser = await createUser('suspended-organization');

    const buyer = await createMembership(buyerUser, 'buyer', 'buyer_admin', 'buyer');
    const traderA = await createMembership(traderAUser, 'trader', 'trader', 'trader-a');
    const traderACollaborator = await addMembership(traderACollaboratorUser, traderA.organizationId, 'trader-a-collaborator');
    const traderB = await createMembership(traderBUser, 'trader', 'trader', 'trader-b', { organizationStatus: 'inactive' });
    await createMembership(suspendedAccountUser, 'buyer', 'buyer_admin', 'suspended-account');
    const suspendedMembership = await createMembership(suspendedMembershipUser, 'trader', 'trader', 'suspended-membership', { membershipStatus: 'suspended' });
    const suspendedOrganization = await createMembership(suspendedOrganizationUser, 'trader', 'trader', 'suspended-organization', { organizationStatus: 'suspended' });

    const buyerCaller = await signIn(buyerUser, 'BUYER');
    const traderACaller = await signIn(traderAUser, 'TRADER A');
    const traderACollaboratorCaller = await signIn(traderACollaboratorUser, 'TRADER A collaborator');
    const traderBCaller = await signIn(traderBUser, 'TRADER B');
    const noContextCaller = await signIn(noContextUser, 'no-context user');
    const suspendedAccountCaller = await signIn(suspendedAccountUser, 'suspended-account user');
    const suspendedMembershipCaller = await signIn(suspendedMembershipUser, 'suspended-membership user');
    const suspendedOrganizationCaller = await signIn(suspendedOrganizationUser, 'suspended-organization user');
    const anonymousCaller = appClient(apiUrl, publishableKey);
    callers.push(anonymousCaller);

    const bidX = await createScopedBid(buyerCaller, buyer, traderA.organizationId, 'X');
    const bidY = await createScopedBid(buyerCaller, buyer, traderA.organizationId, 'Y');
    await query(
      `update app_private.organizations set status = 'active' where id = $1`,
      [traderB.organizationId],
      'reactivate TRADER B after scoped Bid creation',
    );

    const buyerMessages = [];
    const traderAMessages = [];
    const collaboratorMessages = [];
    const buyerChannel = notificationChannel(buyerCaller, 'workspace:buyer', buyerMessages);
    const traderAChannel = notificationChannel(traderACaller, `workspace:trader:${traderA.organizationId}`, traderAMessages);
    const collaboratorChannel = notificationChannel(traderACollaboratorCaller, `workspace:trader:${traderA.organizationId}`, collaboratorMessages);
    const accessChannel = notificationChannel(buyerCaller, `workspace:access:${buyerUser.id}`, []);
    channels.push(buyerChannel, traderAChannel, collaboratorChannel, accessChannel);
    await subscribe(buyerChannel, 'active BUYER buyer topic');
    await subscribe(traderAChannel, 'TRADER A organization topic');
    await subscribe(collaboratorChannel, 'TRADER A collaborator organization topic');
    await subscribe(accessChannel, 'authenticated user own access topic');

    await expectDeniedSubscription(buyerCaller, `workspace:trader:${traderA.organizationId}`, 'BUYER to TRADER topic');
    await expectDeniedSubscription(traderACaller, `workspace:trader:${traderB.organizationId}`, 'TRADER A to TRADER B topic');
    await expectDeniedSubscription(traderBCaller, 'workspace:buyer', 'TRADER to BUYER topic');
    await expectDeniedSubscription(buyerCaller, `workspace:access:${traderAUser.id}`, 'user to another user access topic');
    await expectDeniedSubscription(anonymousCaller, 'workspace:buyer', 'anonymous private application topic');
    await expectDeniedSubscription(noContextCaller, 'workspace:buyer', 'no-context buyer topic');
    await expectDeniedSubscription(suspendedAccountCaller, 'workspace:buyer', 'suspended account buyer topic');
    await expectDeniedSubscription(suspendedMembershipCaller, `workspace:trader:${suspendedMembership.organizationId}`, 'suspended membership own organization topic');
    await expectDeniedSubscription(suspendedOrganizationCaller, `workspace:trader:${suspendedOrganization.organizationId}`, 'suspended organization own organization topic');

    const beforePublish = collaboratorMessages.length;
    const publishResult = await within(traderAChannel.send({ type: 'broadcast', event: 'workspace_changed', payload: { kind: 'workspace_changed' } }), 'browser Broadcast publish attempt');
    assert(publishResult !== 'ok', 'Browser client unexpectedly published an application Broadcast message.');
    await new Promise((resolve) => setTimeout(resolve, quietTimeoutMs));
    assert(collaboratorMessages.length === beforePublish, 'Browser Broadcast publish reached another organization member.');

    await expectWorkspaceChanged(
      traderAMessages,
      async () => await updateBid(buyerCaller, buyer, bidX, 'Incheon', 'mutate Bid X before revoke'),
      'Bid X business invalidation',
    );

    const beforeRevoke = traderAMessages.length;
    const revoke = await rpc(buyerCaller, 'revoke_bid_trader_access', {
      p_actor_membership_id: buyer.membershipId,
      p_bid_id: bidX.id,
      p_expected_revision: bidX.revision,
      p_trader_organization_id: traderA.organizationId,
    }, 'revoke Bid X scope');
    assert(!revoke.error && revoke.data?.revision === bidX.revision + 1, 'BUYER could not revoke Bid X scope.');
    bidX.revision = revoke.data.revision;
    await within(new Promise((resolve) => {
      const poll = () => {
        if (traderAMessages.slice(beforeRevoke).filter((message) => message.payload?.kind === 'workspace_changed').length >= 1) resolve();
        else setTimeout(poll, 25);
      };
      poll();
    }), 'final Bid X revoke invalidation');
    await new Promise((resolve) => setTimeout(resolve, quietTimeoutMs));
    assert(
      traderAMessages.slice(beforeRevoke).filter((message) => message.payload?.kind === 'workspace_changed').length === 1,
      'Bid X revoke emitted more than one final invalidation to the removed organization.',
    );

    const refetch = await rpc(traderACaller, 'list_trader_bids', { p_actor_membership_id: traderA.membershipId }, 'TRADER A authoritative Bid X refetch');
    assert(!refetch.error && !refetch.data.some((bid) => bid.id === bidX.id) && refetch.data.some((bid) => bid.id === bidY.id), 'Authoritative TRADER refetch did not hide revoked Bid X while retaining Bid Y.');
    const deniedMutation = await rpc(traderACaller, 'create_quote', {
      p_actor_membership_id: traderA.membershipId,
      p_bid_id: bidX.id,
      p_fuel_grades: ['vlsfo'],
      p_unit_prices: [100],
      p_barge_fee: 1,
    }, 'revoked TRADER Bid X mutation');
    assert(deniedMutation.error?.code === '42501', 'Revoked TRADER Bid X mutation was not rejected by existing server authorization.');

    await traderACaller.removeChannel(traderAChannel);
    channels.splice(channels.indexOf(traderAChannel), 1);
    const rejoinedMessages = [];
    const rejoinedTraderAChannel = notificationChannel(traderACaller, `workspace:trader:${traderA.organizationId}`, rejoinedMessages);
    channels.push(rejoinedTraderAChannel);
    await subscribe(rejoinedTraderAChannel, 'revoked active TRADER organization-topic rejoin');

    await expectNoWorkspaceChanged(
      rejoinedMessages,
      async () => await updateBid(buyerCaller, buyer, bidX, 'Ulsan', 'mutate revoked Bid X in isolation'),
      'later revoked Bid X mutation',
    );
    await expectWorkspaceChanged(
      rejoinedMessages,
      async () => await updateBid(buyerCaller, buyer, bidY, 'Yeosu', 'mutate still-scoped Bid Y'),
      'still-scoped Bid Y business invalidation',
    );

    assert(
      buyerMessages.every((message) => message.payload?.kind === 'workspace_changed' && Object.keys(message.payload).every((key) => key === 'id' || key === 'kind')),
      'BUYER received data beyond the Realtime transport identity and workspace_changed marker.',
    );
    assert(
      rejoinedMessages.every((message) => message.payload?.kind === 'workspace_changed' && Object.keys(message.payload).every((key) => key === 'id' || key === 'kind')),
      'TRADER received data beyond the Realtime transport identity and workspace_changed marker.',
    );
    console.log('Realtime workspace notification integration tests passed: suspended membership own organization topic DENIED; suspended organization own suspended organization topic DENIED; authorization matrix and corrected bid-revoke lifecycle.');
  } catch (error) {
    primaryError = error;
  } finally {
    for (const channel of channels.reverse()) {
      try { await within(channel.unsubscribe(), 'unsubscribe Realtime channel', 1_000); } catch (error) { cleanupErrors.push(error); }
    }
    for (const caller of callers.reverse()) {
      try { await within(caller.auth.signOut({ scope: 'local' }), 'sign out caller', 1_000); } catch (error) { cleanupErrors.push(error); }
      caller.realtime.disconnect();
    }
    for (const bidId of state.bidIds.reverse()) {
      await query(`update app_private.bids set status = 'closed', awarded_quote_id = null, awarded_at = null, closed_at = coalesce(closed_at, clock_timestamp()) where id = $1 and status = 'awarded'`, [bidId], 'prepare bid fixture cleanup').catch((error) => cleanupErrors.push(error));
      await query('delete from app_private.quote_audit_events where bid_id = $1', [bidId], 'delete quote audit fixture').catch((error) => cleanupErrors.push(error));
      await query('delete from app_private.quote_items where quote_id in (select id from app_private.quotes where bid_id = $1)', [bidId], 'delete quote item fixture').catch((error) => cleanupErrors.push(error));
      await query('delete from app_private.bid_trader_organization_access where bid_id = $1', [bidId], 'delete bid scope fixture').catch((error) => cleanupErrors.push(error));
      await query('delete from app_private.quotes where bid_id = $1', [bidId], 'delete quote fixture').catch((error) => cleanupErrors.push(error));
      await query('delete from app_private.bid_audit_events where bid_id = $1', [bidId], 'delete bid audit fixture').catch((error) => cleanupErrors.push(error));
      await query('delete from app_private.bid_items where bid_id = $1', [bidId], 'delete bid item fixture').catch((error) => cleanupErrors.push(error));
      await query('delete from app_private.bids where id = $1', [bidId], 'delete bid fixture').catch((error) => cleanupErrors.push(error));
    }
    if (state.memberships.length) await query('delete from app_private.organization_memberships where id = any($1::uuid[])', [state.memberships], 'delete membership fixtures').catch((error) => cleanupErrors.push(error));
    if (state.organizations.length) await query('delete from app_private.organizations where id = any($1::uuid[])', [state.organizations], 'delete organization fixtures').catch((error) => cleanupErrors.push(error));
    for (const userId of state.users.reverse()) {
      try {
        const { error } = await within(fixtureClient.auth.admin.deleteUser(userId), 'delete fixture user');
        if (error) throw error;
      } catch (error) { cleanupErrors.push(error); }
    }
    try { await within(database.end(), 'close local database'); } catch (error) { cleanupErrors.push(error); }
  }

  if (primaryError || cleanupErrors.length) {
    throw new AggregateError([...(primaryError ? [primaryError] : []), ...cleanupErrors], 'Realtime workspace notification integration failed.');
  }
}

run().catch((error) => {
  const details = error instanceof AggregateError
    ? error.errors.map((item) => item.message).join(' | ')
    : error.message;
  console.error(`Realtime workspace notification integration tests failed: ${details}`);
  process.exitCode = 1;
});
