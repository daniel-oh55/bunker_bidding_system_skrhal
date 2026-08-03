import { mapWorkflowError, parseActiveBuyer, parseArray, parseBid, parseBidAuditEvent, parseBidTraderAccess, parseQuote, parseTraderBid, parseTraderOrganization, protocolError, type ActiveBuyer, type Bid, type BidAuditEvent, type BidTraderAccess, type Quote, type TraderBid, type TraderOrganization, type WorkflowError } from './types';

export type BiddingResult<T> = { data: T | null; error: WorkflowError | null };
export type BidInput = { vesselVoyage: string; portName: string; deliveryWindow: string; deadlineAt: string | null; responsibleBuyerUserId: string | null; fuelGrades: string[]; quantities: number[] };
export type QuoteInput = { fuelGrades: string[]; unitPrices: number[]; bargeFee: number };
export interface BiddingClient {
  listActiveBuyers(membershipId: string): Promise<BiddingResult<ActiveBuyer[]>>;
  listBids(membershipId: string, view: 'all' | 'created_by_me' | 'responsible_buyer', responsibleBuyerUserId?: string): Promise<BiddingResult<Bid[]>>;
  listBidAudit(membershipId: string, bidId: string): Promise<BiddingResult<BidAuditEvent[]>>;
  createBid(membershipId: string, input: BidInput): Promise<BiddingResult<Bid>>;
  updateBid(membershipId: string, bidId: string, expectedRevision: number, input: Omit<BidInput, 'responsibleBuyerUserId'>): Promise<BiddingResult<Bid>>;
  reassignBid(membershipId: string, bidId: string, expectedRevision: number, userId: string): Promise<BiddingResult<Bid>>;
  closeBid(membershipId: string, bidId: string, expectedRevision: number): Promise<BiddingResult<Bid>>;
  reopenBid(membershipId: string, bidId: string, expectedRevision: number, deadlineAt: string | null): Promise<BiddingResult<Bid>>;
  cancelBid(membershipId: string, bidId: string, expectedRevision: number): Promise<BiddingResult<Bid>>;
  listActiveTraderOrganizations(membershipId: string): Promise<BiddingResult<TraderOrganization[]>>;
  listBidTraderAccess(membershipId: string, bidId: string): Promise<BiddingResult<BidTraderAccess[]>>;
  grantBidTraderAccess(membershipId: string, bidId: string, expectedRevision: number, organizationId: string): Promise<BiddingResult<Bid>>;
  revokeBidTraderAccess(membershipId: string, bidId: string, expectedRevision: number, organizationId: string): Promise<BiddingResult<Bid>>;
  listQuotesForBuyers(membershipId: string, bidId: string): Promise<BiddingResult<Quote[]>>;
  awardBid(membershipId: string, bidId: string, expectedRevision: number, quoteId: string, expectedQuoteRevision: number): Promise<BiddingResult<Bid>>;
  listTraderBids(membershipId: string): Promise<BiddingResult<TraderBid[]>>;
  listMyQuotes(membershipId: string): Promise<BiddingResult<Quote[]>>;
  createQuote(membershipId: string, bidId: string, input: QuoteInput): Promise<BiddingResult<Quote>>;
  updateQuote(membershipId: string, quoteId: string, expectedRevision: number, input: QuoteInput): Promise<BiddingResult<Quote>>;
}

type RpcResponse = { data: unknown; error: { code?: string | null } | null };
export type BiddingRpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResponse> };
export function createSupabaseBiddingClient(client: BiddingRpcClient): BiddingClient {
  async function rpc<T>(name: string, args: Record<string, unknown>, parser: (value: unknown) => T | null): Promise<BiddingResult<T>> {
    let response: RpcResponse;
    try { response = await client.rpc(name, args); } catch { return { data: null, error: mapWorkflowError(null) }; }
    if (response.error) return { data: null, error: mapWorkflowError(response.error) };
    const data = parser(response.data); return data === null ? { data: null, error: protocolError() } : { data, error: null };
  }
  const many = <T>(parser: (value: unknown) => T | null) => (value: unknown) => parseArray(value, parser);
  return {
    listActiveBuyers: (m) => rpc('list_active_buyers', { p_actor_membership_id: m }, many(parseActiveBuyer)),
    listBids: (m, view, user) => rpc('list_bids', { p_actor_membership_id: m, p_view: view, p_responsible_buyer_user_id: view === 'responsible_buyer' ? user ?? null : null }, many(parseBid)),
    listBidAudit: (m, b) => rpc('list_bid_audit', { p_actor_membership_id: m, p_bid_id: b }, many(parseBidAuditEvent)),
    createBid: (m, i) => rpc('create_bid', { p_actor_membership_id: m, p_vessel_voyage: i.vesselVoyage, p_port_name: i.portName, p_delivery_window: i.deliveryWindow, p_deadline_at: i.deadlineAt, p_responsible_buyer_user_id: i.responsibleBuyerUserId, p_fuel_grades: i.fuelGrades, p_quantities: i.quantities }, parseBid),
    updateBid: (m, b, r, i) => rpc('update_bid', { p_actor_membership_id: m, p_bid_id: b, p_expected_revision: r, p_vessel_voyage: i.vesselVoyage, p_port_name: i.portName, p_delivery_window: i.deliveryWindow, p_deadline_at: i.deadlineAt, p_fuel_grades: i.fuelGrades, p_quantities: i.quantities }, parseBid),
    reassignBid: (m, b, r, u) => rpc('reassign_bid', { p_actor_membership_id: m, p_bid_id: b, p_expected_revision: r, p_responsible_buyer_user_id: u }, parseBid),
    closeBid: (m, b, r) => rpc('close_bid', { p_actor_membership_id: m, p_bid_id: b, p_expected_revision: r }, parseBid),
    reopenBid: (m, b, r, d) => rpc('reopen_bid', { p_actor_membership_id: m, p_bid_id: b, p_expected_revision: r, p_deadline_at: d }, parseBid),
    cancelBid: (m, b, r) => rpc('cancel_bid', { p_actor_membership_id: m, p_bid_id: b, p_expected_revision: r }, parseBid),
    listActiveTraderOrganizations: (m) => rpc('list_active_trader_organizations', { p_actor_membership_id: m }, many(parseTraderOrganization)),
    listBidTraderAccess: (m, b) => rpc('list_bid_trader_access', { p_actor_membership_id: m, p_bid_id: b }, many(parseBidTraderAccess)),
    grantBidTraderAccess: (m, b, r, o) => rpc('grant_bid_trader_access', { p_actor_membership_id: m, p_bid_id: b, p_expected_revision: r, p_trader_organization_id: o }, parseBid),
    revokeBidTraderAccess: (m, b, r, o) => rpc('revoke_bid_trader_access', { p_actor_membership_id: m, p_bid_id: b, p_expected_revision: r, p_trader_organization_id: o }, parseBid),
    listQuotesForBuyers: (m, b) => rpc('list_quotes_for_buyers', { p_actor_membership_id: m, p_bid_id: b }, many(parseQuote)),
    awardBid: (m, b, r, q, qr) => rpc('award_bid', { p_actor_membership_id: m, p_bid_id: b, p_expected_revision: r, p_quote_id: q, p_expected_quote_revision: qr }, parseBid),
    listTraderBids: (m) => rpc('list_trader_bids', { p_actor_membership_id: m }, many(parseTraderBid)),
    listMyQuotes: (m) => rpc('list_my_quotes', { p_actor_membership_id: m }, many(parseQuote)),
    createQuote: (m, b, i) => rpc('create_quote', { p_actor_membership_id: m, p_bid_id: b, p_fuel_grades: i.fuelGrades, p_unit_prices: i.unitPrices, p_barge_fee: i.bargeFee }, parseQuote),
    updateQuote: (m, q, r, i) => rpc('update_quote', { p_actor_membership_id: m, p_quote_id: q, p_expected_revision: r, p_fuel_grades: i.fuelGrades, p_unit_prices: i.unitPrices, p_barge_fee: i.bargeFee }, parseQuote),
  };
}
