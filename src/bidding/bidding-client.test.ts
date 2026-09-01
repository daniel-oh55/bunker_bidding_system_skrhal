import { describe, expect, it, vi } from 'vitest';
import { createSupabaseBiddingClient, type BiddingRpcClient } from './bidding-client';

const id = '10000000-0000-4000-8000-000000000001'; const other = '10000000-0000-4000-8000-000000000002'; const now = '2026-08-03T03:00:00.000Z';
const bid = { id, bid_date: '2026-08-03', vessel_voyage: 'MV Test', port_name: 'Busan', delivery_window: 'Today', deadline_at: null, raw_status: 'open', effective_status: 'open', revision: 1, created_by: id, created_by_label: 'Creator', responsible_buyer_user_id: other, responsible_buyer_label: 'Buyer', fuel_items: [{ fuel_grade: 'vlsfo', quantity_mt: 10 }], created_at: now, updated_at: now, closed_at: null, cancelled_at: null, awarded_quote_id: null, awarded_trader_organization_id: null, awarded_trader_organization_label: null, awarded_total_amount: null, awarded_at: null };
const traderBid = { id, vessel_voyage: 'MV Test', port_name: 'Busan', delivery_window: 'Today', deadline_at: null, raw_status: 'open', effective_status: 'open', revision: 1, fuel_items: [{ fuel_grade: 'vlsfo', quantity_mt: 10 }], created_at: now, updated_at: now, closed_at: null, cancelled_at: null, response_status: 'quoted', response_revision: 2 };
const quote = { id, bid_id: other, trader_organization_id: id, trader_organization_label: 'Trader', revision: 1, created_by: other, fuel_prices: [{ fuel_grade: 'vlsfo', unit_price: 1 }], barge_fee: 0, total_amount: 1, created_at: now, updated_at: now, access_active: true, organization_active: true, eligible_for_award: true, is_awarded: false, response_status: 'quoted' };
const sellerComparison = { bid_id: other, trader_organization_id: id, trader_organization_label: 'Trader', access_active: true, organization_active: true, response_status: 'quoted', quote };
const pendingMail = { id, received_at: now, subject: 'Request', vessel_voyage: null, port_name: 'Busan', delivery_window: null, fuel_items: [{ grade: 'vlsfo', quantity: 10 }], warnings: [], status: 'pending', revision: 1, created_at: now, updated_at: now, dismissed_at: null };
const dismissedMail = { ...pendingMail, status: 'dismissed', revision: 2, dismissed_at: now };
const sellerOrganization = { organization_id: other, organization_label: 'Ocean Bunker', organization_status: 'active', active_trader_membership_count: 0, created_at: now, updated_at: now };
type Rpc = BiddingRpcClient['rpc'];
function harness(data: unknown = bid, error: { code?: string | null } | null = null) { const rpc = vi.fn<Rpc>(() => Promise.resolve({ data, error })); return { rpc, client: createSupabaseBiddingClient({ rpc }) }; }

describe('BiddingClient RPC adapter', () => {
  it('maps exact SELLER-admin RPC names and arguments and requires one mutation result row', async () => {
    const list = harness([sellerOrganization]);
    expect(await list.client.listTraderOrganizationsForAdmin!(id)).toMatchObject({ data: [sellerOrganization], error: null });
    expect(list.rpc).toHaveBeenCalledWith('list_trader_organizations_for_admin', { p_actor_membership_id: id });

    const create = harness([sellerOrganization]);
    expect(await create.client.createTraderOrganization!(id, 'Ocean Bunker')).toMatchObject({ data: sellerOrganization, error: null });
    expect(create.rpc).toHaveBeenCalledWith('create_trader_organization', { p_actor_membership_id: id, p_organization_name: 'Ocean Bunker' });

    const deactivate = harness([{ ...sellerOrganization, organization_status: 'inactive' }]);
    expect(await deactivate.client.deactivateTraderOrganization!(id, other)).toMatchObject({ data: { organization_status: 'inactive' }, error: null });
    expect(deactivate.rpc).toHaveBeenCalledWith('deactivate_trader_organization', { p_actor_membership_id: id, p_trader_organization_id: other });

    expect((await harness([]).client.createTraderOrganization!(id, 'Missing')).error?.kind).toBe('protocol');
    expect((await harness([sellerOrganization, sellerOrganization]).client.deactivateTraderOrganization!(id, other)).error?.kind).toBe('protocol');
  });

  it('rejects malformed SELLER-admin list and mutation results as protocol failures', async () => {
    expect((await harness([{ ...sellerOrganization, organization_status: 'deleted' }]).client.listTraderOrganizationsForAdmin!(id)).error?.kind).toBe('protocol');
    expect((await harness([{ ...sellerOrganization, active_trader_membership_count: '0' }]).client.createTraderOrganization!(id, 'Ocean Bunker')).error?.kind).toBe('protocol');
    expect((await harness([{ ...sellerOrganization, actor_user_id: id }]).client.deactivateTraderOrganization!(id, other)).error?.kind).toBe('protocol');
  });

  it('maps the exact mail-intake list and dismiss RPC names and arguments without an ingest surface', async () => {
    const list = harness([pendingMail]);
    expect(await list.client.listMailIntakeItems(id)).toMatchObject({ data: [pendingMail], error: null });
    expect(list.rpc).toHaveBeenCalledWith('list_mail_intake_items', { p_actor_membership_id: id });
    const dismiss = harness(dismissedMail);
    expect(await dismiss.client.dismissMailIntakeItem(id, other, 1)).toMatchObject({ data: dismissedMail, error: null });
    expect(dismiss.rpc).toHaveBeenCalledWith('dismiss_mail_intake_item', { p_actor_membership_id: id, p_item_id: other, p_expected_revision: 1 });
    expect(list.client).not.toHaveProperty('ingestMailIntakeItem');
    expect(Object.keys(list.client).filter((name) => name.toLowerCase().includes('ingest'))).toEqual([]);
  });

  it('maps malformed mail-intake list and dismiss responses to fixed protocol failures', async () => {
    const malformedList = harness([{ ...pendingMail, status: 'dismissed' }]);
    expect(await malformedList.client.listMailIntakeItems(id)).toMatchObject({ data: null, error: { kind: 'protocol', message: 'The server returned an invalid response. Protected data was not displayed.' } });
    const malformedDismiss = harness({ ...dismissedMail, dismissed_at: null });
    expect(await malformedDismiss.client.dismissMailIntakeItem(id, other, 1)).toMatchObject({ data: null, error: { kind: 'protocol' } });
  });

  it('maps all BUYER methods with the selected membership and only contract arguments', async () => {
    const { rpc, client } = harness();
    await client.listActiveBuyers(id); await client.listBids(id, '2026-08-03', 'responsible_buyer', other); await client.listBidAudit(id, other); await client.createBid(id, { vesselVoyage: 'V', portName: 'P', deliveryWindow: 'W', deadlineAt: null, responsibleBuyerUserId: other, fuelGrades: ['vlsfo'], quantities: [1] }); await client.updateBid(id, other, 2, { vesselVoyage: 'V', portName: 'P', deliveryWindow: 'W', deadlineAt: null, fuelGrades: ['vlsfo'], quantities: [1] }); await client.reassignBid(id, other, 2, id); await client.closeBid(id, other, 2); await client.reopenBid(id, other, 2, null); await client.cancelBid(id, other, 2); await client.listActiveTraderOrganizations(id); await client.listBidTraderAccess(id, other); await client.grantBidTraderAccess(id, other, 2, id); await client.revokeBidTraderAccess(id, other, 2, id); await client.listBidSellerComparisonForBuyers(id, other); await client.listQuotesForBuyers(id, other); await client.awardBid(id, other, 2, id, 3);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['list_active_buyers', 'list_bids', 'list_bid_audit', 'create_bid', 'update_bid', 'reassign_bid', 'close_bid', 'reopen_bid', 'cancel_bid', 'list_active_trader_organizations', 'list_bid_trader_access', 'grant_bid_trader_access', 'revoke_bid_trader_access', 'list_bid_seller_comparison_for_buyers', 'list_quotes_for_buyers', 'award_bid']);
    for (const [, args] of rpc.mock.calls) { expect(args).toMatchObject({ p_actor_membership_id: id }); expect(args).not.toHaveProperty('p_actor_user_id'); expect(args).not.toHaveProperty('p_actor_organization_id'); }
    expect(rpc).toHaveBeenCalledWith('list_bids', { p_actor_membership_id: id, p_bid_date: '2026-08-03', p_view: 'responsible_buyer', p_responsible_buyer_user_id: other });
    expect(rpc.mock.calls.map(([, args]) => args)).toEqual([
      { p_actor_membership_id: id },
      { p_actor_membership_id: id, p_bid_date: '2026-08-03', p_view: 'responsible_buyer', p_responsible_buyer_user_id: other },
      { p_actor_membership_id: id, p_bid_id: other },
      { p_actor_membership_id: id, p_vessel_voyage: 'V', p_port_name: 'P', p_delivery_window: 'W', p_deadline_at: null, p_responsible_buyer_user_id: other, p_fuel_grades: ['vlsfo'], p_quantities: [1] },
      { p_actor_membership_id: id, p_bid_id: other, p_expected_revision: 2, p_vessel_voyage: 'V', p_port_name: 'P', p_delivery_window: 'W', p_deadline_at: null, p_fuel_grades: ['vlsfo'], p_quantities: [1] },
      { p_actor_membership_id: id, p_bid_id: other, p_expected_revision: 2, p_responsible_buyer_user_id: id },
      { p_actor_membership_id: id, p_bid_id: other, p_expected_revision: 2 },
      { p_actor_membership_id: id, p_bid_id: other, p_expected_revision: 2, p_deadline_at: null },
      { p_actor_membership_id: id, p_bid_id: other, p_expected_revision: 2 },
      { p_actor_membership_id: id },
      { p_actor_membership_id: id, p_bid_id: other },
      { p_actor_membership_id: id, p_bid_id: other, p_expected_revision: 2, p_trader_organization_id: id },
      { p_actor_membership_id: id, p_bid_id: other, p_expected_revision: 2, p_trader_organization_id: id },
      { p_actor_membership_id: id, p_bid_id: other },
      { p_actor_membership_id: id, p_bid_id: other },
      { p_actor_membership_id: id, p_bid_id: other, p_expected_revision: 2, p_quote_id: id, p_expected_quote_revision: 3 },
    ]);
  });
  it('calls the exact BUYER SELLER-comparison RPC and strictly parses its rows', async () => {
    const valid = harness([sellerComparison]);
    expect(await valid.client.listBidSellerComparisonForBuyers(id, other)).toEqual({ data: [sellerComparison], error: null });
    expect(valid.rpc).toHaveBeenCalledWith('list_bid_seller_comparison_for_buyers', { p_actor_membership_id: id, p_bid_id: other });
    const malformed = harness([{ ...sellerComparison, quote: { ...quote, bid_id: id } }]);
    expect((await malformed.client.listBidSellerComparisonForBuyers(id, other)).error?.kind).toBe('protocol');
  });
  it('maps response-oriented TRADER calls and never sends calculated or identity fields', async () => {
    const { rpc, client } = harness(traderBid); await client.listTraderBids(id); const quotes = harness([quote]); await quotes.client.listMyQuotes(id); await quotes.client.submitQuoteResponse(id, other, 2, 1, { fuelGrades: ['vlsfo'], unitPrices: [3], bargeFee: 2 }); await quotes.client.giveUpQuoteResponse(id, other, 3);
    expect(rpc).toHaveBeenCalledWith('list_trader_bids', { p_actor_membership_id: id }); expect(quotes.rpc.mock.calls.map(([name]) => name)).toEqual(['list_my_quotes', 'submit_quote_response', 'give_up_quote_response']);
    for (const [, args] of quotes.rpc.mock.calls.slice(1)) { expect(args).not.toHaveProperty('p_total_amount'); expect(args).not.toHaveProperty('p_created_by'); expect(args).not.toHaveProperty('p_trader_organization_id'); expect(args).not.toHaveProperty('p_actor_user_id'); expect(args).not.toHaveProperty('p_role'); }
    expect(quotes.rpc.mock.calls.map(([, args]) => args)).toEqual([
      { p_actor_membership_id: id },
      { p_actor_membership_id: id, p_bid_id: other, p_expected_response_revision: 2, p_expected_quote_revision: 1, p_fuel_grades: ['vlsfo'], p_unit_prices: [3], p_barge_fee: 2 },
      { p_actor_membership_id: id, p_bid_id: other, p_expected_response_revision: 3 },
    ]);
  });
  it('maps RPC errors, malformed responses, and thrown transport failures without exposing data', async () => {
    const conflict = harness(null, { code: '40001' }); expect((await conflict.client.closeBid(id, other, 1)).error?.kind).toBe('conflict');
    const malformed = harness([{ bad: true }]); expect((await malformed.client.listBids(id, '2026-08-03', 'all')).error?.kind).toBe('protocol');
    const rpc: Rpc = vi.fn(() => { throw new Error('network'); }); const client = createSupabaseBiddingClient({ rpc }); expect((await client.listActiveBuyers(id)).error?.kind).toBe('unknown');
  });

  it('accepts false is_awarded but rejects null as a quote protocol error', async () => {
    const falseResult = await harness([quote]).client.listMyQuotes(id);
    expect(falseResult).toMatchObject({ data: [quote], error: null });
    const nullResult = await harness([{ ...quote, is_awarded: null }]).client.listMyQuotes(id);
    expect(nullResult).toMatchObject({ data: null, error: { kind: 'protocol' } });
  });

  it.each([
    ['42501', 'authorization'], ['40001', 'conflict'], ['55000', 'lifecycle'], ['22023', 'validation'], ['23514', 'validation'], ['P0002', 'not_found'], ['23505', 'duplicate'], ['unexpected', 'unknown'],
  ])('maps SQLSTATE %s to %s without data', async (code, kind) => {
    const { client } = harness(null, { code });
    const result = await client.listTraderBids(id);
    expect(result).toMatchObject({ data: null, error: { code, kind } });
  });
});
