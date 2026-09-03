import { mapWorkflowError, parseActiveBuyer, parseArray, parseBid, parseBidAuditEvent, parseBidTraderAccess, parseBuyerBidOrder, parseBuyerSellerComparison, parseDismissedMailIntakeItem, parsePendingMailIntakeItem, parseQuote, parseQuoteResponse, parseSellerOrganizationAdmin, parseTraderBid, parseTraderOrganization, protocolError, type ActiveBuyer, type Bid, type BidAuditEvent, type BidTraderAccess, type BuyerBidOrder, type BuyerSellerComparison, type MailIntakeItem, type Quote, type QuoteResponse, type SellerOrganizationAdmin, type TraderBid, type TraderOrganization, type WorkflowError } from './types';

export type BiddingResult<T> = { data: T | null; error: WorkflowError | null };
type BidTermsInput = { vesselVoyage: string; portName: string; deliveryWindow: string; fuelGrades: string[]; quantities: number[] };
export type BidInput = BidTermsInput & { deadlineAt: string; responsibleBuyerUserId: string | null; selectedTraderOrganizationIds: string[] };
export type PreparedMailIntakeBidInput = BidInput & { intakeItemId: string; expectedIntakeRevision: number };
export type BidUpdateInput = BidTermsInput & { deadlineAt: string | null };
export type QuoteInput = { fuelGrades: string[]; unitPrices: number[]; bargeFee: number };
export interface BiddingClient {
  listMailIntakeItems(membershipId: string): Promise<BiddingResult<MailIntakeItem[]>>;
  dismissMailIntakeItem(membershipId: string, itemId: string, expectedRevision: number): Promise<BiddingResult<MailIntakeItem>>;
  listActiveBuyers(membershipId: string): Promise<BiddingResult<ActiveBuyer[]>>;
  listBids(membershipId: string, bidDate: string, view: 'all' | 'created_by_me' | 'responsible_buyer', responsibleBuyerUserId?: string): Promise<BiddingResult<Bid[]>>;
  getMyBidOrder(membershipId: string, bidDate: string): Promise<BiddingResult<BuyerBidOrder>>;
  saveMyBidOrder(membershipId: string, bidDate: string, expectedRevision: number, orderedBidIds: string[]): Promise<BiddingResult<BuyerBidOrder>>;
  listBidAudit(membershipId: string, bidId: string): Promise<BiddingResult<BidAuditEvent[]>>;
  createBid(membershipId: string, input: BidInput): Promise<BiddingResult<Bid>>;
  publishMailIntakeBid(membershipId: string, input: PreparedMailIntakeBidInput): Promise<BiddingResult<Bid>>;
  updateBid(membershipId: string, bidId: string, expectedRevision: number, input: BidUpdateInput): Promise<BiddingResult<Bid>>;
  reassignBid(membershipId: string, bidId: string, expectedRevision: number, userId: string): Promise<BiddingResult<Bid>>;
  closeBid(membershipId: string, bidId: string, expectedRevision: number): Promise<BiddingResult<Bid>>;
  reopenBid(membershipId: string, bidId: string, expectedRevision: number, deadlineAt: string | null): Promise<BiddingResult<Bid>>;
  cancelBid(membershipId: string, bidId: string, expectedRevision: number): Promise<BiddingResult<Bid>>;
  listActiveTraderOrganizations(membershipId: string): Promise<BiddingResult<TraderOrganization[]>>;
  listTraderOrganizationsForAdmin?(membershipId: string): Promise<BiddingResult<SellerOrganizationAdmin[]>>;
  createTraderOrganization?(membershipId: string, organizationName: string): Promise<BiddingResult<SellerOrganizationAdmin>>;
  deactivateTraderOrganization?(membershipId: string, organizationId: string): Promise<BiddingResult<SellerOrganizationAdmin>>;
  listBidTraderAccess(membershipId: string, bidId: string): Promise<BiddingResult<BidTraderAccess[]>>;
  grantBidTraderAccess(membershipId: string, bidId: string, expectedRevision: number, organizationId: string): Promise<BiddingResult<Bid>>;
  revokeBidTraderAccess(membershipId: string, bidId: string, expectedRevision: number, organizationId: string): Promise<BiddingResult<Bid>>;
  listBidSellerComparisonForBuyers(membershipId: string, bidId: string): Promise<BiddingResult<BuyerSellerComparison[]>>;
  listQuotesForBuyers(membershipId: string, bidId: string): Promise<BiddingResult<Quote[]>>;
  awardBid(membershipId: string, bidId: string, expectedRevision: number, quoteId: string, expectedQuoteRevision: number): Promise<BiddingResult<Bid>>;
  listTraderBids(membershipId: string): Promise<BiddingResult<TraderBid[]>>;
  listMyQuotes(membershipId: string): Promise<BiddingResult<Quote[]>>;
  submitQuoteResponse(membershipId: string, bidId: string, expectedResponseRevision: number, expectedQuoteRevision: number | null, input: QuoteInput): Promise<BiddingResult<Quote>>;
  giveUpQuoteResponse(membershipId: string, bidId: string, expectedResponseRevision: number): Promise<BiddingResult<QuoteResponse>>;
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
  const oneRow = <T>(parser: (value: unknown) => T | null) => (value: unknown) => {
    const rows = parseArray(value, parser);
    return rows?.length === 1 ? rows[0]! : null;
  };
  return {
    listMailIntakeItems: (m) => rpc('list_mail_intake_items', { p_actor_membership_id: m }, many(parsePendingMailIntakeItem)),
    dismissMailIntakeItem: (m, i, r) => rpc('dismiss_mail_intake_item', { p_actor_membership_id: m, p_item_id: i, p_expected_revision: r }, parseDismissedMailIntakeItem),
    listActiveBuyers: (m) => rpc('list_active_buyers', { p_actor_membership_id: m }, many(parseActiveBuyer)),
    listBids: (m, bidDate, view, user) => rpc('list_bids', { p_actor_membership_id: m, p_bid_date: bidDate, p_view: view, p_responsible_buyer_user_id: view === 'responsible_buyer' ? user ?? null : null }, many(parseBid)),
    getMyBidOrder: (m, bidDate) => rpc('get_my_bid_order', { p_actor_membership_id: m, p_bid_date: bidDate }, oneRow(parseBuyerBidOrder)),
    saveMyBidOrder: (m, bidDate, revision, orderedBidIds) => rpc('save_my_bid_order', { p_actor_membership_id: m, p_bid_date: bidDate, p_expected_revision: revision, p_ordered_bid_ids: orderedBidIds }, oneRow(parseBuyerBidOrder)),
    listBidAudit: (m, b) => rpc('list_bid_audit', { p_actor_membership_id: m, p_bid_id: b }, many(parseBidAuditEvent)),
    createBid: (m, i) => rpc('create_bid', { p_actor_membership_id: m, p_vessel_voyage: i.vesselVoyage, p_port_name: i.portName, p_delivery_window: i.deliveryWindow, p_deadline_at: i.deadlineAt, p_responsible_buyer_user_id: i.responsibleBuyerUserId, p_fuel_grades: i.fuelGrades, p_quantities: i.quantities, p_selected_trader_organization_ids: i.selectedTraderOrganizationIds }, parseBid),
    publishMailIntakeBid: (m, i) => rpc('publish_mail_intake_bid', { p_actor_membership_id: m, p_item_id: i.intakeItemId, p_expected_revision: i.expectedIntakeRevision, p_vessel_voyage: i.vesselVoyage, p_port_name: i.portName, p_delivery_window: i.deliveryWindow, p_deadline_at: i.deadlineAt, p_responsible_buyer_user_id: i.responsibleBuyerUserId, p_fuel_grades: i.fuelGrades, p_quantities: i.quantities, p_selected_trader_organization_ids: i.selectedTraderOrganizationIds }, parseBid),
    updateBid: (m, b, r, i) => rpc('update_bid', { p_actor_membership_id: m, p_bid_id: b, p_expected_revision: r, p_vessel_voyage: i.vesselVoyage, p_port_name: i.portName, p_delivery_window: i.deliveryWindow, p_deadline_at: i.deadlineAt, p_fuel_grades: i.fuelGrades, p_quantities: i.quantities }, parseBid),
    reassignBid: (m, b, r, u) => rpc('reassign_bid', { p_actor_membership_id: m, p_bid_id: b, p_expected_revision: r, p_responsible_buyer_user_id: u }, parseBid),
    closeBid: (m, b, r) => rpc('close_bid', { p_actor_membership_id: m, p_bid_id: b, p_expected_revision: r }, parseBid),
    reopenBid: (m, b, r, d) => rpc('reopen_bid', { p_actor_membership_id: m, p_bid_id: b, p_expected_revision: r, p_deadline_at: d }, parseBid),
    cancelBid: (m, b, r) => rpc('cancel_bid', { p_actor_membership_id: m, p_bid_id: b, p_expected_revision: r }, parseBid),
    listActiveTraderOrganizations: (m) => rpc('list_active_trader_organizations', { p_actor_membership_id: m }, many(parseTraderOrganization)),
    listTraderOrganizationsForAdmin: (m) => rpc('list_trader_organizations_for_admin', { p_actor_membership_id: m }, many(parseSellerOrganizationAdmin)),
    createTraderOrganization: (m, n) => rpc('create_trader_organization', { p_actor_membership_id: m, p_organization_name: n }, oneRow(parseSellerOrganizationAdmin)),
    deactivateTraderOrganization: (m, o) => rpc('deactivate_trader_organization', { p_actor_membership_id: m, p_trader_organization_id: o }, oneRow(parseSellerOrganizationAdmin)),
    listBidTraderAccess: (m, b) => rpc('list_bid_trader_access', { p_actor_membership_id: m, p_bid_id: b }, many(parseBidTraderAccess)),
    grantBidTraderAccess: (m, b, r, o) => rpc('grant_bid_trader_access', { p_actor_membership_id: m, p_bid_id: b, p_expected_revision: r, p_trader_organization_id: o }, parseBid),
    revokeBidTraderAccess: (m, b, r, o) => rpc('revoke_bid_trader_access', { p_actor_membership_id: m, p_bid_id: b, p_expected_revision: r, p_trader_organization_id: o }, parseBid),
    listBidSellerComparisonForBuyers: (m, b) => rpc('list_bid_seller_comparison_for_buyers', { p_actor_membership_id: m, p_bid_id: b }, many(parseBuyerSellerComparison)),
    listQuotesForBuyers: (m, b) => rpc('list_quotes_for_buyers', { p_actor_membership_id: m, p_bid_id: b }, many(parseQuote)),
    awardBid: (m, b, r, q, qr) => rpc('award_bid', { p_actor_membership_id: m, p_bid_id: b, p_expected_revision: r, p_quote_id: q, p_expected_quote_revision: qr }, parseBid),
    listTraderBids: (m) => rpc('list_trader_bids', { p_actor_membership_id: m }, many(parseTraderBid)),
    listMyQuotes: (m) => rpc('list_my_quotes', { p_actor_membership_id: m }, many(parseQuote)),
    submitQuoteResponse: (m, b, rr, qr, i) => rpc('submit_quote_response', { p_actor_membership_id: m, p_bid_id: b, p_expected_response_revision: rr, p_expected_quote_revision: qr, p_fuel_grades: i.fuelGrades, p_unit_prices: i.unitPrices, p_barge_fee: i.bargeFee }, parseQuote),
    giveUpQuoteResponse: (m, b, r) => rpc('give_up_quote_response', { p_actor_membership_id: m, p_bid_id: b, p_expected_response_revision: r }, parseQuoteResponse),
  };
}
