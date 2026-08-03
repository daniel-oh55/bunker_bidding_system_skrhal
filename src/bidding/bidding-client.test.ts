import { describe, expect, it, vi } from 'vitest';
import { createSupabaseBiddingClient, type BiddingRpcClient } from './bidding-client';

const id = '10000000-0000-4000-8000-000000000001'; const other = '10000000-0000-4000-8000-000000000002'; const now = '2026-08-03T03:00:00.000Z';
const bid = { id, vessel_voyage: 'MV Test', port_name: 'Busan', delivery_window: 'Today', deadline_at: null, raw_status: 'open', effective_status: 'open', revision: 1, created_by: id, created_by_label: 'Creator', responsible_buyer_user_id: other, responsible_buyer_label: 'Buyer', fuel_items: [{ fuel_grade: 'vlsfo', quantity_mt: 10 }], created_at: now, updated_at: now, closed_at: null, cancelled_at: null, awarded_quote_id: null, awarded_trader_organization_id: null, awarded_trader_organization_label: null, awarded_total_amount: null, awarded_at: null };
const traderBid = { id, vessel_voyage: 'MV Test', port_name: 'Busan', delivery_window: 'Today', deadline_at: null, raw_status: 'open', effective_status: 'open', revision: 1, fuel_items: [{ fuel_grade: 'vlsfo', quantity_mt: 10 }], created_at: now, updated_at: now, closed_at: null, cancelled_at: null };
const quote = { id, bid_id: other, trader_organization_id: id, trader_organization_label: 'Trader', revision: 1, created_by: other, fuel_prices: [{ fuel_grade: 'vlsfo', unit_price: 1 }], barge_fee: 0, total_amount: 1, created_at: now, updated_at: now, access_active: true, organization_active: true, eligible_for_award: true, is_awarded: false };
type Rpc = BiddingRpcClient['rpc'];
function harness(data: unknown = bid, error: { code?: string | null } | null = null) { const rpc = vi.fn<Rpc>(() => Promise.resolve({ data, error })); return { rpc, client: createSupabaseBiddingClient({ rpc }) }; }

describe('BiddingClient RPC adapter', () => {
  it('maps all BUYER methods with the selected membership and only contract arguments', async () => {
    const { rpc, client } = harness();
    await client.listActiveBuyers(id); await client.listBids(id, 'responsible_buyer', other); await client.listBidAudit(id, other); await client.createBid(id, { vesselVoyage: 'V', portName: 'P', deliveryWindow: 'W', deadlineAt: null, responsibleBuyerUserId: other, fuelGrades: ['vlsfo'], quantities: [1] }); await client.updateBid(id, other, 2, { vesselVoyage: 'V', portName: 'P', deliveryWindow: 'W', deadlineAt: null, fuelGrades: ['vlsfo'], quantities: [1] }); await client.reassignBid(id, other, 2, id); await client.closeBid(id, other, 2); await client.reopenBid(id, other, 2, null); await client.cancelBid(id, other, 2); await client.listActiveTraderOrganizations(id); await client.listBidTraderAccess(id, other); await client.grantBidTraderAccess(id, other, 2, id); await client.revokeBidTraderAccess(id, other, 2, id); await client.listQuotesForBuyers(id, other); await client.awardBid(id, other, 2, id, 3);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['list_active_buyers', 'list_bids', 'list_bid_audit', 'create_bid', 'update_bid', 'reassign_bid', 'close_bid', 'reopen_bid', 'cancel_bid', 'list_active_trader_organizations', 'list_bid_trader_access', 'grant_bid_trader_access', 'revoke_bid_trader_access', 'list_quotes_for_buyers', 'award_bid']);
    for (const [, args] of rpc.mock.calls) { expect(args).toMatchObject({ p_actor_membership_id: id }); expect(args).not.toHaveProperty('p_actor_user_id'); expect(args).not.toHaveProperty('p_actor_organization_id'); }
    expect(rpc).toHaveBeenCalledWith('list_bids', { p_actor_membership_id: id, p_view: 'responsible_buyer', p_responsible_buyer_user_id: other });
    expect(rpc.mock.calls.map(([, args]) => args)).toEqual([
      { p_actor_membership_id: id },
      { p_actor_membership_id: id, p_view: 'responsible_buyer', p_responsible_buyer_user_id: other },
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
      { p_actor_membership_id: id, p_bid_id: other, p_expected_revision: 2, p_quote_id: id, p_expected_quote_revision: 3 },
    ]);
  });
  it('maps TRADER calls and never sends calculated or identity fields with quote mutations', async () => {
    const { rpc, client } = harness(traderBid); await client.listTraderBids(id); const quotes = harness([quote]); await quotes.client.listMyQuotes(id); await quotes.client.createQuote(id, other, { fuelGrades: ['vlsfo'], unitPrices: [3], bargeFee: 2 }); await quotes.client.updateQuote(id, other, 2, { fuelGrades: ['vlsfo'], unitPrices: [3], bargeFee: 2 });
    expect(rpc).toHaveBeenCalledWith('list_trader_bids', { p_actor_membership_id: id }); expect(quotes.rpc.mock.calls.map(([name]) => name)).toEqual(['list_my_quotes', 'create_quote', 'update_quote']);
    for (const [, args] of quotes.rpc.mock.calls.slice(1)) { expect(args).not.toHaveProperty('p_total_amount'); expect(args).not.toHaveProperty('p_created_by'); expect(args).not.toHaveProperty('p_trader_organization_id'); expect(args).not.toHaveProperty('p_actor_user_id'); expect(args).not.toHaveProperty('p_role'); }
    expect(quotes.rpc.mock.calls.map(([, args]) => args)).toEqual([
      { p_actor_membership_id: id },
      { p_actor_membership_id: id, p_bid_id: other, p_fuel_grades: ['vlsfo'], p_unit_prices: [3], p_barge_fee: 2 },
      { p_actor_membership_id: id, p_quote_id: other, p_expected_revision: 2, p_fuel_grades: ['vlsfo'], p_unit_prices: [3], p_barge_fee: 2 },
    ]);
  });
  it('maps RPC errors, malformed responses, and thrown transport failures without exposing data', async () => {
    const conflict = harness(null, { code: '40001' }); expect((await conflict.client.closeBid(id, other, 1)).error?.kind).toBe('conflict');
    const malformed = harness([{ bad: true }]); expect((await malformed.client.listBids(id, 'all')).error?.kind).toBe('protocol');
    const rpc: Rpc = vi.fn(() => { throw new Error('network'); }); const client = createSupabaseBiddingClient({ rpc }); expect((await client.listActiveBuyers(id)).error?.kind).toBe('unknown');
  });

  it.each([
    ['42501', 'authorization'], ['40001', 'conflict'], ['55000', 'lifecycle'], ['22023', 'validation'], ['23514', 'validation'], ['P0002', 'not_found'], ['23505', 'duplicate'], ['unexpected', 'unknown'],
  ])('maps SQLSTATE %s to %s without data', async (code, kind) => {
    const { client } = harness(null, { code });
    const result = await client.listTraderBids(id);
    expect(result).toMatchObject({ data: null, error: { code, kind } });
  });
});
