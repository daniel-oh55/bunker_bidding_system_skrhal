import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

const timeoutMs = 10_000;
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1']);
const assert = (value, message) => { if (!value) throw new Error(message); };
function localUrl(value, protocols, label) { const parsed = new URL(value); assert(protocols.has(parsed.protocol) && loopbackHosts.has(parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')), `Refusing non-loopback ${label}.`); return parsed; }
function client(url, key) { return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }); }
async function within(operation, label) { let timer; try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs); })]); } finally { clearTimeout(timer); } }

async function run() {
  const [apiUrl, publishableKey, fixtureKey, databaseUrl, ...rest] = process.argv.slice(2);
  assert(rest.length === 0 && apiUrl && publishableKey && fixtureKey && databaseUrl, 'Expected local API URL, publishable key, fixture key, and PostgreSQL URL.');
  localUrl(apiUrl, new Set(['http:', 'https:']), 'API URL'); localUrl(databaseUrl, new Set(['postgres:', 'postgresql:']), 'database URL'); assert(publishableKey !== fixtureKey, 'Caller and fixture credentials must differ.');
  const admin = client(apiUrl, fixtureKey); const database = new Client({ connectionString: databaseUrl, application_name: 'trader-quote-integration', connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs, statement_timeout: timeoutMs });
  const state = { users: [], orgs: [], memberships: [], bidId: null, quoteId: null }; const callers = []; const cleanupErrors = []; let failure;
  async function query(sql, values = []) { return within(database.query(sql, values), 'fixture database query'); }
  async function createUser(label) {
    const email = `${label}-${randomUUID()}@quote-integration.test`; const password = `Local-${randomUUID()}-9a!`;
    const { data, error } = await within(admin.auth.admin.createUser({ email, password, email_confirm: true }), `create ${label}`);
    assert(!error && data.user, `Could not create ${label} fixture user.`); state.users.push(data.user.id); await query("update app_private.user_accounts set status='active' where user_id=$1", [data.user.id]); return { id: data.user.id, email, password };
  }
  async function membership(user, kind, role, label, organizationStatus = 'active') {
    const organizationId = randomUUID(); const membershipId = randomUUID(); state.orgs.push(organizationId); state.memberships.push(membershipId);
    await query("insert into app_private.organizations(id,kind,name,status) values($1,$2,$3,$4)", [organizationId, kind, `${label}-${organizationId}`, organizationStatus]);
    await query("insert into app_private.organization_memberships(id,user_id,organization_id,role,status) values($1,$2,$3,$4,'active')", [membershipId, user.id, organizationId, role]);
    return { organizationId, membershipId };
  }
  async function signedIn(user, label) { const value = client(apiUrl, publishableKey); const { data, error } = await within(value.auth.signInWithPassword({ email: user.email, password: user.password }), `${label} sign in`); assert(!error && data.session, `${label} could not sign in.`); callers.push(value); return value; }
  async function rpc(caller, name, args, label) { return within(caller.rpc(name, args), label); }
  try {
    await within(database.connect(), 'connect local database');
    const buyerUser = await createUser('buyer'); const traderOneUser = await createUser('trader-one'); const traderTwoUser = await createUser('trader-two'); const traderOtherUser = await createUser('trader-other');
    const buyer = await membership(buyerUser, 'buyer', 'buyer_admin', 'buyer'); const traderOne = await membership(traderOneUser, 'trader', 'trader', 'trader-one', 'inactive');
    const traderTwo = { organizationId: traderOne.organizationId, membershipId: randomUUID() }; state.memberships.push(traderTwo.membershipId); await query("insert into app_private.organization_memberships(id,user_id,organization_id,role,status) values($1,$2,$3,'trader','active')", [traderTwo.membershipId, traderTwoUser.id, traderTwo.organizationId]);
    const traderOther = await membership(traderOtherUser, 'trader', 'trader', 'trader-other', 'inactive');
    const buyerCaller = await signedIn(buyerUser, 'buyer'); const traderOneCaller = await signedIn(traderOneUser, 'trader one'); const traderTwoCaller = await signedIn(traderTwoUser, 'trader two'); const otherCaller = await signedIn(traderOtherUser, 'other trader');

    const created = await rpc(buyerCaller, 'create_bid', { p_actor_membership_id: buyer.membershipId, p_vessel_voyage: 'REST vessel', p_port_name: 'Busan', p_delivery_window: 'window', p_deadline_at: new Date(Date.now() + 86_400_000).toISOString(), p_responsible_buyer_user_id: null, p_fuel_grades: ['vlsfo'], p_quantities: [10] }, 'buyer create bid');
    assert(!created.error && created.data?.id, 'BUYER could not create fixture bid.'); state.bidId = created.data.id;
    await query("update app_private.organizations set status='active' where id=$1", [traderOne.organizationId]);
    const granted = await rpc(buyerCaller, 'grant_bid_trader_access', { p_actor_membership_id: buyer.membershipId, p_bid_id: state.bidId, p_expected_revision: 1, p_trader_organization_id: traderOne.organizationId }, 'buyer grant scope');
    assert(!granted.error && granted.data.revision === 2, 'BUYER could not grant explicit TRADER scope.');
    const listedBids = await rpc(traderOneCaller, 'list_trader_bids', { p_actor_membership_id: traderOne.membershipId }, 'allowed trader lists bids');
    assert(!listedBids.error && listedBids.data.some((bid) => bid.id === state.bidId), 'Allowed TRADER cannot list explicitly scoped bid.');
    const quote = await rpc(traderOneCaller, 'submit_quote_response', { p_actor_membership_id: traderOne.membershipId, p_bid_id: state.bidId, p_expected_response_revision: 1, p_expected_quote_revision: null, p_fuel_grades: ['vlsfo'], p_unit_prices: [100], p_barge_fee: 5 }, 'allowed trader submits quote response');
    assert(!quote.error && quote.data?.total_amount === 1005 && quote.data?.response_status === 'quoted' && quote.data?.is_awarded === false, 'TRADER quote submission must include server-calculated total, quoted status, and boolean false is_awarded.'); state.quoteId = quote.data.id;
    const updated = await rpc(traderTwoCaller, 'submit_quote_response', { p_actor_membership_id: traderTwo.membershipId, p_bid_id: state.bidId, p_expected_response_revision: 2, p_expected_quote_revision: 1, p_fuel_grades: ['vlsfo'], p_unit_prices: [101], p_barge_fee: 5 }, 'same organization response update');
    assert(!updated.error && updated.data.revision === 2 && updated.data.created_by === traderOneUser.id && updated.data.is_awarded === false, 'Same-organization TRADER update must preserve creator, increment revision, and return boolean false is_awarded.');
    await query("update app_private.organizations set status='active' where id=$1", [traderOther.organizationId]);
    const otherQuotes = await rpc(otherCaller, 'list_my_quotes', { p_actor_membership_id: traderOther.membershipId }, 'other trader quote list');
    assert(!otherQuotes.error && !otherQuotes.data.some((value) => value.id === state.quoteId), 'Another TRADER organization can see a competing quote.');
    const otherUpdate = await rpc(otherCaller, 'submit_quote_response', { p_actor_membership_id: traderOther.membershipId, p_bid_id: state.bidId, p_expected_response_revision: 1, p_expected_quote_revision: null, p_fuel_grades: ['vlsfo'], p_unit_prices: [102], p_barge_fee: 5 }, 'other trader response update');
    assert(otherUpdate.error?.code === '42501', 'Another TRADER organization update must return 42501.');
    const buyerQuotes = await rpc(buyerCaller, 'list_quotes_for_buyers', { p_actor_membership_id: buyer.membershipId, p_bid_id: state.bidId }, 'buyer quote list');
    assert(!buyerQuotes.error && buyerQuotes.data.length === 1 && buyerQuotes.data[0].total_amount === 1015 && buyerQuotes.data[0].is_awarded === false, 'BUYER quote list must include the authoritative total and boolean false is_awarded before award.');
    const revoked = await rpc(buyerCaller, 'revoke_bid_trader_access', { p_actor_membership_id: buyer.membershipId, p_bid_id: state.bidId, p_expected_revision: 2, p_trader_organization_id: traderOne.organizationId }, 'buyer revokes scope');
    assert(!revoked.error && revoked.data.revision === 3, 'BUYER could not revoke current TRADER scope.');
    const revokedQuotes = await rpc(traderOneCaller, 'list_my_quotes', { p_actor_membership_id: traderOne.membershipId }, 'revoked trader quote list');
    assert(!revokedQuotes.error && !revokedQuotes.data.some((value) => value.id === state.quoteId), 'Revoked TRADER retains quote visibility.');
    const revokedUpdate = await rpc(traderOneCaller, 'submit_quote_response', { p_actor_membership_id: traderOne.membershipId, p_bid_id: state.bidId, p_expected_response_revision: 3, p_expected_quote_revision: 2, p_fuel_grades: ['vlsfo'], p_unit_prices: [102], p_barge_fee: 5 }, 'revoked trader response update');
    assert(revokedUpdate.error?.code === '42501', 'Revoked TRADER quote mutation must return 42501.');
    const regranted = await rpc(buyerCaller, 'grant_bid_trader_access', { p_actor_membership_id: buyer.membershipId, p_bid_id: state.bidId, p_expected_revision: 3, p_trader_organization_id: traderOne.organizationId }, 'buyer regrants scope');
    assert(!regranted.error && regranted.data.revision === 4, 'BUYER could not regrant scope while effective-open.');
    const closed = await rpc(buyerCaller, 'close_bid', { p_actor_membership_id: buyer.membershipId, p_bid_id: state.bidId, p_expected_revision: 4 }, 'buyer closes bid');
    assert(!closed.error && closed.data.raw_status === 'closed', 'BUYER could not close quote bid.');
    const afterClose = await rpc(traderOneCaller, 'submit_quote_response', { p_actor_membership_id: traderOne.membershipId, p_bid_id: state.bidId, p_expected_response_revision: 3, p_expected_quote_revision: 2, p_fuel_grades: ['vlsfo'], p_unit_prices: [102], p_barge_fee: 5 }, 'post-close response update');
    assert(afterClose.error?.code === '55000', 'Closed bid quote update must return 55000.');
    const awarded = await rpc(buyerCaller, 'award_bid', { p_actor_membership_id: buyer.membershipId, p_bid_id: state.bidId, p_expected_revision: 5, p_quote_id: state.quoteId, p_expected_quote_revision: 2 }, 'buyer awards quote');
    assert(!awarded.error && awarded.data.raw_status === 'awarded' && awarded.data.awarded_quote_id === state.quoteId && awarded.data.awarded_total_amount === 1015, 'BUYER did not receive authoritative final award result.');
    const awardedQuotes = await rpc(buyerCaller, 'list_quotes_for_buyers', { p_actor_membership_id: buyer.membershipId, p_bid_id: state.bidId }, 'buyer lists awarded quote');
    assert(!awardedQuotes.error && awardedQuotes.data.length === 1 && awardedQuotes.data[0].is_awarded === true, 'BUYER quote list must return boolean true is_awarded after award.');
    console.log('Trader quote REST integration tests passed: 9 boundary scenarios.');
  } catch (error) { failure = error; }
  finally {
    for (const caller of callers) await within(caller.auth.signOut({ scope: 'local' }), 'sign out').catch((error) => cleanupErrors.push(error));
    if (state.bidId) {
      try {
        await query('begin');
        await query('alter table app_private.bid_trader_organization_response_audit_events disable trigger reject_response_audit_delete');
        await query("update app_private.bids set status='closed', awarded_quote_id=null, awarded_at=null, closed_at=coalesce(closed_at,clock_timestamp()) where id=$1 and status='awarded'", [state.bidId]);
        await query('delete from app_private.bid_trader_organization_response_audit_events where bid_id=$1', [state.bidId]);
        await query('delete from app_private.quote_audit_events where bid_id=$1', [state.bidId]);
        await query('delete from app_private.quote_items where quote_id in (select id from app_private.quotes where bid_id=$1)', [state.bidId]);
        await query('delete from app_private.bid_trader_organization_access where bid_id=$1', [state.bidId]);
        await query('delete from app_private.quotes where bid_id=$1', [state.bidId]);
        await query('delete from app_private.bid_trader_organization_responses where bid_id=$1', [state.bidId]);
        await query('delete from app_private.bid_audit_events where bid_id=$1', [state.bidId]);
        await query('delete from app_private.bid_items where bid_id=$1', [state.bidId]);
        await query('delete from app_private.bids where id=$1', [state.bidId]);
        await query('alter table app_private.bid_trader_organization_response_audit_events enable trigger reject_response_audit_delete');
        await query('commit');
      } catch (error) {
        await query('rollback').catch(() => {});
        cleanupErrors.push(error);
      }
    }
    if (state.memberships.length) await query('delete from app_private.organization_memberships where id=any($1::uuid[])', [state.memberships]).catch((error) => cleanupErrors.push(error));
    if (state.orgs.length) await query('delete from app_private.organizations where id=any($1::uuid[])', [state.orgs]).catch((error) => cleanupErrors.push(error));
    for (const id of state.users.reverse()) await within(admin.auth.admin.deleteUser(id), 'delete fixture user').then(({ error }) => { if (error) throw error; }).catch((error) => cleanupErrors.push(error));
    await database.end().catch((error) => cleanupErrors.push(error));
    if (failure || cleanupErrors.length) throw new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], 'Trader quote integration failed.');
  }
}
run().catch((error) => { console.error(`Trader quote REST integration tests failed: ${error.message}`); process.exitCode = 1; });
