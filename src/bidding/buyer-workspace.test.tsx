import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BuyerWorkspace } from './buyer-workspace';
import type { BiddingClient, BiddingResult } from './bidding-client';
import type { ActiveBuyer, Bid, BidAuditEvent, BidTraderAccess, BuyerSellerComparison, Quote, TraderBid, TraderOrganization } from './types';

vi.mock('./datetime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./datetime')>()),
  currentSeoulDate: () => '2026-08-03',
}));

const id = '10000000-0000-4000-8000-000000000001'; const target = '10000000-0000-4000-8000-000000000002'; const bidId = '10000000-0000-4000-8000-000000000003'; const now = '2026-08-03T03:00:00.000Z';
const ok = <T,>(data: T): BiddingResult<T> => ({ data, error: null });
const bid = (overrides: Partial<Bid> = {}): Bid => ({ id: bidId, bid_date: '2026-08-03', vessel_voyage: 'MV Buyer', port_name: 'Busan', delivery_window: 'Tomorrow', deadline_at: now, raw_status: 'open', effective_status: 'open', revision: 3, created_by: id, created_by_label: 'Creator', responsible_buyer_user_id: target, responsible_buyer_label: 'Target buyer', fuel_items: [{ fuel_grade: 'vlsfo', quantity_mt: 10 }], created_at: now, updated_at: now, closed_at: null, cancelled_at: null, awarded_quote_id: null, awarded_trader_organization_id: null, awarded_trader_organization_label: null, awarded_total_amount: null, awarded_at: null, ...overrides });
const boardQuote = (targetBid: Bid, name: string, suffix: string, total = 1000, overrides: Partial<Quote> = {}): Quote => ({ id: `20000000-0000-4000-8000-${suffix.padStart(12, '0')}`, bid_id: targetBid.id, trader_organization_id: `30000000-0000-4000-8000-${suffix.padStart(12, '0')}`, trader_organization_label: name, revision: 1, created_by: id, fuel_prices: targetBid.fuel_items.map((item) => ({ fuel_grade: item.fuel_grade, unit_price: 100 })), barge_fee: 0, total_amount: total, created_at: now, updated_at: now, access_active: true, organization_active: true, eligible_for_award: true, is_awarded: false, ...overrides, response_status: overrides.response_status ?? 'quoted' });
const boardComparison = (currentQuote: Quote): BuyerSellerComparison => ({ bid_id: currentQuote.bid_id, trader_organization_id: currentQuote.trader_organization_id, trader_organization_label: currentQuote.trader_organization_label, access_active: currentQuote.access_active, organization_active: currentQuote.organization_active, response_status: currentQuote.response_status, quote: currentQuote });
const deferred = <T,>() => { let resolve!: (value: T) => void; return { promise: new Promise<T>((done) => { resolve = done; }), resolve }; };
function fakeClient(bids: Bid[] = [bid()]) {
  const listBids = vi.fn<BiddingClient['listBids']>(() => Promise.resolve(ok(bids)));
  const listActiveBuyers = vi.fn(() => Promise.resolve(ok<ActiveBuyer[]>([{ user_id: target, display_label: 'Target buyer', active_buyer_membership_count: 1 }])));
  const listActiveTraderOrganizations = vi.fn(() => Promise.resolve(ok<TraderOrganization[]>([])));
  const client: BiddingClient = { listMailIntakeItems: () => Promise.resolve(ok([])), dismissMailIntakeItem: () => Promise.resolve(ok(null as never)), listActiveBuyers, listBids, listBidAudit: () => Promise.resolve(ok<BidAuditEvent[]>([])), createBid: () => Promise.resolve(ok<Bid>(null as never)), updateBid: () => Promise.resolve(ok<Bid>(null as never)), reassignBid: () => Promise.resolve(ok<Bid>(null as never)), closeBid: () => Promise.resolve(ok<Bid>(null as never)), reopenBid: () => Promise.resolve(ok<Bid>(null as never)), cancelBid: () => Promise.resolve(ok<Bid>(null as never)), listActiveTraderOrganizations, listBidTraderAccess: () => Promise.resolve(ok<BidTraderAccess[]>([])), grantBidTraderAccess: () => Promise.resolve(ok<Bid>(null as never)), revokeBidTraderAccess: () => Promise.resolve(ok<Bid>(null as never)), listBidSellerComparisonForBuyers: () => Promise.resolve(ok<BuyerSellerComparison[]>([])), listQuotesForBuyers: () => Promise.resolve(ok<Quote[]>([])), awardBid: () => Promise.resolve(ok<Bid>(null as never)), listTraderBids: () => Promise.resolve(ok<TraderBid[]>([])), listMyQuotes: () => Promise.resolve(ok<Quote[]>([])), submitQuoteResponse: () => Promise.resolve(ok<Quote>(null as never)), giveUpQuoteResponse: () => Promise.resolve(ok(null as never)) };
  return { client, listBids, listActiveBuyers, listActiveTraderOrganizations };
}

describe('BUYER workspace', () => {
  it('defaults to Seoul today and retains the selected date across view, Refresh, and Realtime reloads', async () => {
    const { client, listBids } = fakeClient();
    const view = render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
    const dateInput = screen.getByLabelText('Operational date');
    expect(dateInput).toHaveValue('2026-08-03');
    fireEvent.change(dateInput, { target: { value: '2026-08-02' } });
    await waitFor(() => expect(listBids).toHaveBeenLastCalledWith(id, '2026-08-02', 'all', undefined));
    fireEvent.click(screen.getByRole('radio', { name: 'Created by me' }));
    await waitFor(() => expect(listBids).toHaveBeenLastCalledWith(id, '2026-08-02', 'created_by_me', undefined));
    fireEvent.change(dateInput, { target: { value: '2026-08-03' } });
    await waitFor(() => expect(listBids).toHaveBeenLastCalledWith(id, '2026-08-03', 'created_by_me', undefined));
    fireEvent.change(dateInput, { target: { value: '2026-08-02' } });
    await waitFor(() => expect(listBids).toHaveBeenLastCalledWith(id, '2026-08-02', 'created_by_me', undefined));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(listBids.mock.calls.at(-1)?.[1]).toBe('2026-08-02'));
    view.rerender(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} reloadVersion={1} />);
    await waitFor(() => expect(listBids.mock.calls.at(-1)?.[1]).toBe('2026-08-02'));
    expect(dateInput).toHaveValue('2026-08-02');
  });

  it('retains the responsible BUYER target when the operational date changes', async () => {
    const { client, listBids } = fakeClient();
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
    await screen.findByRole('article', { name: 'MV Buyer' });
    fireEvent.click(screen.getByRole('radio', { name: 'By BUYER' }));
    fireEvent.change(screen.getByLabelText('Responsible BUYER filter'), { target: { value: target } });
    await waitFor(() => expect(listBids).toHaveBeenLastCalledWith(id, '2026-08-03', 'responsible_buyer', target));
    fireEvent.change(screen.getByLabelText('Operational date'), { target: { value: '2026-08-02' } });
    await waitFor(() => expect(listBids).toHaveBeenLastCalledWith(id, '2026-08-02', 'responsible_buyer', target));
    expect(screen.getByLabelText('Responsible BUYER filter')).toHaveValue(target);
  });

  it('shows only BIDs matching the selected date and disables historical creation with an explanation', async () => {
    const { client } = fakeClient([
      bid({ id: bidId, bid_date: '2026-08-03', vessel_voyage: 'MV Today' }),
      bid({ id: target, bid_date: '2026-08-02', vessel_voyage: 'MV Historical' }),
    ]);
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
    expect(await screen.findByRole('article', { name: 'MV Today' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'MV Historical' })).not.toBeInTheDocument();
    expect(screen.getByText('Create new bid')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Operational date'), { target: { value: '2026-08-02' } });
    expect(await screen.findByRole('article', { name: 'MV Historical' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'MV Today' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create new bid unavailable' })).toBeInTheDocument();
    expect(screen.getByText(/created only for today’s Seoul operational date/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create bid' })).not.toBeInTheDocument();
  });

  it('places today’s Create new bid ahead of SELLER management and Mail Intake', async () => {
    const { client } = fakeClient();
    render(<BuyerWorkspace client={client} membershipId={id} membershipRole="buyer_admin" onAuthorizationFailure={vi.fn()} />);

    await screen.findByRole('article', { name: 'MV Buyer' });
    const createBid = screen.getByText('Create new bid');
    const sellerManagement = screen.getByRole('region', { name: 'SELLER management' });
    const mailIntake = screen.getByRole('heading', { name: 'Mail intake' });
    expect(createBid.compareDocumentPosition(sellerManagement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(createBid.compareDocumentPosition(mailIntake) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('scrolls and focuses the selected detail only after an explicit Manage bid load succeeds', async () => {
    const { client } = fakeClient();
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    try {
      render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
      const card = await screen.findByRole('article', { name: 'MV Buyer' });
      fireEvent.click(within(card).getByRole('button', { name: 'Manage bid' }));
      const detail = await screen.findByRole('region', { name: 'Selected bid detail' });
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
      expect(document.activeElement).toBe(detail);
    } finally {
      if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
      else delete (HTMLElement.prototype as { scrollIntoView?: () => void }).scrollIntoView;
    }
  });

  it('does not steal focus when manual Refresh retains selected detail', async () => {
    const { client } = fakeClient();
    const listBidTraderAccess = vi.fn(() => Promise.resolve(ok<BidTraderAccess[]>([])));
    client.listBidTraderAccess = listBidTraderAccess;
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    try {
      render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
      const card = await screen.findByRole('article', { name: 'MV Buyer' });
      fireEvent.click(within(card).getByRole('button', { name: 'Manage bid' }));
      await screen.findByRole('region', { name: 'Selected bid detail' });
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
      scrollIntoView.mockClear();
      const refresh = screen.getByRole('button', { name: 'Refresh' });
      refresh.focus();

      fireEvent.click(refresh);
      await waitFor(() => expect(listBidTraderAccess).toHaveBeenCalledTimes(2));
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(refresh);
    } finally {
      if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
      else delete (HTMLElement.prototype as { scrollIntoView?: () => void }).scrollIntoView;
    }
  });

  it('keeps normal bid operations available when the isolated mail queue has a non-authorization failure', async () => {
    const { client, listBids } = fakeClient();
    client.listMailIntakeItems = vi.fn<BiddingClient['listMailIntakeItems']>(() => Promise.resolve({ data: null, error: { kind: 'unknown', code: null, message: 'raw queue failure' } }));
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);

    expect(await screen.findByRole('article', { name: 'MV Buyer' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The mail intake request could not be completed. Please try again.');
    expect(screen.getByText('Create new bid')).toBeInTheDocument();
    expect(listBids).toHaveBeenCalledWith(id, '2026-08-03', 'all', undefined);
    expect(screen.queryByText('No bid selected')).not.toBeInTheDocument();
  });

  it('presents human-readable BUYER views while preserving the exact server view arguments', async () => {
    const { client, listBids } = fakeClient();
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);

    await screen.findByRole('article', { name: 'MV Buyer' });
    expect(screen.getByRole('radio', { name: 'All bids' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Created by me' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'By BUYER' })).not.toBeChecked();
    expect(screen.getByText('Grouped by creator')).toBeInTheDocument();
    expect(screen.getByText('Filter by responsibility')).toBeInTheDocument();
    expect(listBids).toHaveBeenLastCalledWith(id, '2026-08-03', 'all', undefined);

    fireEvent.click(screen.getByRole('radio', { name: 'Created by me' }));
    await waitFor(() => expect(listBids).toHaveBeenCalledTimes(2));
    expect(listBids).toHaveBeenLastCalledWith(id, '2026-08-03', 'created_by_me', undefined);
    expect(screen.queryByRole('region', { name: 'Bids created by Creator' })).not.toBeInTheDocument();
  });

  it('groups All bids by immutable creator while preserving first-seen group and within-group server order', async () => {
    const creatorA = '10000000-0000-4000-8000-000000000010';
    const creatorB = '10000000-0000-4000-8000-000000000011';
    const bids = [
      bid({ id: '10000000-0000-4000-8000-000000000012', vessel_voyage: 'MV Alpha First', created_by: creatorA, created_by_label: 'Creator Alpha' }),
      bid({ id: '10000000-0000-4000-8000-000000000013', vessel_voyage: 'MV Beta Only', created_by: creatorB, created_by_label: 'Creator Beta' }),
      bid({ id: '10000000-0000-4000-8000-000000000014', vessel_voyage: 'MV Alpha Second', created_by: creatorA, created_by_label: 'Creator Alpha', raw_status: 'closed', effective_status: 'closed', closed_at: now }),
    ];
    const { client } = fakeClient(bids);
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);

    const groups = await screen.findAllByRole('region', { name: /^Bids created by/ });
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Bids created by Creator Alpha', 'Bids created by Creator Beta']);
    const alphaGroup = groups[0]!;
    const betaGroup = groups[1]!;
    expect(within(alphaGroup).getByRole('heading', { name: 'Creator Alpha' })).toBeInTheDocument();
    expect(within(alphaGroup).getByText((_content, element) => element?.textContent === '2 total bids')).toBeInTheDocument();
    expect(within(alphaGroup).getByText((_content, element) => element?.textContent === '1 effective open')).toBeInTheDocument();
    expect(within(alphaGroup).getAllByRole('article').map((card) => card.textContent)).toEqual([
      expect.stringContaining('MV Alpha First'),
      expect.stringContaining('MV Alpha Second'),
    ]);
    expect(within(betaGroup).getByRole('article', { name: 'MV Beta Only' })).toBeInTheDocument();
    expect(within(alphaGroup).getByRole('button', { name: 'Collapse bids created by Creator Alpha' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(betaGroup).getByRole('button', { name: 'Collapse bids created by Creator Beta' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(alphaGroup).getAllByText('Target buyer')).toHaveLength(2);
    expect(within(betaGroup).getByText('Target buyer')).toBeInTheDocument();
  });

  it('independently collapses creator cards without issuing another list request', async () => {
    const creatorA = '10000000-0000-4000-8000-000000000010';
    const creatorB = '10000000-0000-4000-8000-000000000011';
    const { client, listBids } = fakeClient([
      bid({ id: '10000000-0000-4000-8000-000000000012', vessel_voyage: 'MV Alpha', created_by: creatorA, created_by_label: 'Creator Alpha' }),
      bid({ id: '10000000-0000-4000-8000-000000000013', vessel_voyage: 'MV Beta', created_by: creatorB, created_by_label: 'Creator Beta' }),
    ]);
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);

    const alphaGroup = await screen.findByRole('region', { name: 'Bids created by Creator Alpha' });
    const betaGroup = screen.getByRole('region', { name: 'Bids created by Creator Beta' });
    fireEvent.click(within(alphaGroup).getByRole('button', { name: 'Collapse bids created by Creator Alpha' }));
    expect(within(alphaGroup).queryByRole('article', { name: 'MV Alpha' })).not.toBeInTheDocument();
    expect(within(betaGroup).getByRole('article', { name: 'MV Beta' })).toBeInTheDocument();
    expect(within(alphaGroup).getByRole('button', { name: 'Expand bids created by Creator Alpha' })).toHaveAttribute('aria-expanded', 'false');
    expect(listBids).toHaveBeenCalledOnce();

    fireEvent.click(within(alphaGroup).getByRole('button', { name: 'Expand bids created by Creator Alpha' }));
    expect(within(alphaGroup).getByRole('article', { name: 'MV Alpha' })).toBeInTheDocument();
    expect(listBids).toHaveBeenCalledOnce();
  });

  it('keeps selected detail intact when its creator group collapses and causes no detail RPC', async () => {
    const selectedBid = bid({ vessel_voyage: 'MV Selected', created_by_label: 'Creator Alpha' });
    const { client, listBids } = fakeClient([selectedBid]);
    const listBidTraderAccess = vi.fn(() => Promise.resolve(ok<BidTraderAccess[]>([])));
    const listQuotesForBuyers = vi.fn(() => Promise.resolve(ok<Quote[]>([])));
    const listBidAudit = vi.fn(() => Promise.resolve(ok<BidAuditEvent[]>([])));
    const listBidSellerComparisonForBuyers = vi.fn(() => Promise.resolve(ok<BuyerSellerComparison[]>([])));
    client.listBidTraderAccess = listBidTraderAccess;
    client.listQuotesForBuyers = listQuotesForBuyers;
    client.listBidAudit = listBidAudit;
    client.listBidSellerComparisonForBuyers = listBidSellerComparisonForBuyers;
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);

    const selectedCard = await screen.findByRole('article', { name: 'MV Selected' });
    fireEvent.click(within(selectedCard).getByRole('button', { name: 'Manage bid' }));
    await waitFor(() => expect(listBidTraderAccess).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByText('Loading bid detail')).not.toBeInTheDocument());
    expect(screen.getAllByRole('heading', { name: 'MV Selected' })).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse bids created by Creator Alpha' }));
    expect(screen.getByRole('heading', { name: 'MV Selected' })).toBeInTheDocument();
    expect(listBids).toHaveBeenCalledOnce();
    expect(listBidTraderAccess).toHaveBeenCalledOnce();
    expect(listQuotesForBuyers).toHaveBeenCalledOnce();
    expect(listBidSellerComparisonForBuyers).toHaveBeenCalledOnce();
    expect(listBidAudit).toHaveBeenCalledOnce();
  });

  it('shows a clear empty state after a loaded bid view has no results', async () => {
    const { client } = fakeClient([]);
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);

    expect(await screen.findByText('No bids in this view')).toBeInTheDocument();
    expect(screen.getByText('Try another view or refresh the current bid list.')).toBeInTheDocument();
  });

  it('clears the prior list and gates responsible-BUYER requests until a server-returned target is selected', async () => {
    const { client, listBids } = fakeClient(); render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
    await screen.findByText('MV Buyer');
    expect(listBids).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('radio', { name: 'By BUYER' }));
    await screen.findByText('Select a BUYER to load responsible bids.');
    expect(screen.queryByText('MV Buyer')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /responsible buyer filter/i })).toHaveTextContent('Target buyer');
    expect(listBids).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole('combobox', { name: /responsible buyer filter/i }), { target: { value: target } });
    await waitFor(() => expect(listBids).toHaveBeenCalledTimes(2));
    expect(listBids).toHaveBeenLastCalledWith(id, '2026-08-03', 'responsible_buyer', target);
    expect(screen.queryByRole('region', { name: 'Bids created by Creator' })).not.toBeInTheDocument();
  });

  it('fails closed on a BUYER primary protocol error and removes stale actions', async () => {
    const { client, listBids, listActiveBuyers, listActiveTraderOrganizations } = fakeClient();
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
    await screen.findByText('MV Buyer');
    listActiveBuyers.mockResolvedValueOnce(ok([{ user_id: target, display_label: 'Target buyer', active_buyer_membership_count: 1 }]));
    listActiveTraderOrganizations.mockResolvedValueOnce(ok([]));
    listBids.mockResolvedValueOnce({ data: null, error: { kind: 'protocol', code: null, message: 'Invalid protocol' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('MV Buyer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('fails closed on a BUYER 42501 response and revalidates authorization', async () => {
    const { client, listBids } = fakeClient(); const onAuthorizationFailure = vi.fn();
    const listBidTraderAccess = vi.fn(() => Promise.resolve(ok<BidTraderAccess[]>([])));
    client.listBidTraderAccess = listBidTraderAccess;
    client.listActiveTraderOrganizations = vi.fn(() => Promise.resolve(ok([{ organization_id: '20000000-0000-4000-8000-000000000001', organization_label: 'Trader A' }])));
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={onAuthorizationFailure} />);
    const card = await screen.findByRole('article', { name: 'MV Buyer' });
    fireEvent.click(within(card).getByRole('button', { name: 'Manage bid' }));
    await waitFor(() => expect(listBidTraderAccess).toHaveBeenCalledOnce());
    expect(screen.getAllByRole('option', { name: 'Target buyer' })).toHaveLength(2);
    expect(screen.getByRole('option', { name: 'Trader A' })).toBeInTheDocument();
    listBids.mockResolvedValueOnce({ data: null, error: { kind: 'authorization', code: '42501', message: 'Authorization changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('alert');
    expect(onAuthorizationFailure).toHaveBeenCalledOnce();
    expect(screen.queryByText('MV Buyer')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('option', { name: 'Target buyer' })).toHaveLength(0);
    expect(screen.queryByRole('option', { name: 'Trader A' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Assign responsible BUYER')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Grant TRADER organization')).not.toBeInTheDocument();
  });

  it('isolates a per-bid non-authorization SELLER-comparison failure and removes stale participant data', async () => {
    const bidA = bid({ id: '10000000-0000-4000-8000-000000000010', vessel_voyage: 'MV Quote A' });
    const bidB = bid({ id: '10000000-0000-4000-8000-000000000011', vessel_voyage: 'MV Quote B' });
    const { client } = fakeClient([bidA, bidB]);
    let refreshed = false;
    client.listBidSellerComparisonForBuyers = vi.fn((_membershipId, requestedBidId) => {
      if (!refreshed) return Promise.resolve(ok([boardComparison(boardQuote(requestedBidId === bidA.id ? bidA : bidB, requestedBidId === bidA.id ? 'Stale Seller A' : 'Stable Seller B', requestedBidId === bidA.id ? '10' : '11'))]));
      if (requestedBidId === bidA.id) return Promise.resolve({ data: null, error: { kind: 'unknown' as const, code: null, message: 'isolated failure' } });
      return Promise.resolve(ok([boardComparison(boardQuote(bidB, 'Fresh Seller B', '12'))]));
    });
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);

    await screen.findByText('Stale Seller A');
    refreshed = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    const cardA = await screen.findByRole('article', { name: 'MV Quote A' });
    const cardB = screen.getByRole('article', { name: 'MV Quote B' });
    expect(await within(cardA).findByText('SELLER comparison temporarily unavailable. Refresh to try again.')).toBeInTheDocument();
    expect(within(cardA).queryByText('Stale Seller A')).not.toBeInTheDocument();
    expect(await within(cardB).findByText('Fresh Seller B')).toBeInTheDocument();
  });

  it('fails closed when any board SELLER-comparison request returns an authorization failure', async () => {
    const { client } = fakeClient();
    const onAuthorizationFailure = vi.fn();
    client.listBidSellerComparisonForBuyers = vi.fn(() => Promise.resolve({ data: null, error: { kind: 'authorization' as const, code: '42501', message: 'SELLER comparison authorization changed' } }));
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={onAuthorizationFailure} />);

    await waitFor(() => expect(onAuthorizationFailure).toHaveBeenCalledOnce());
    expect(screen.getByRole('alert')).toHaveTextContent('SELLER comparison authorization changed');
    expect(screen.queryByRole('article', { name: 'MV Buyer' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('option', { name: 'Target buyer' })).toHaveLength(0);
  });

  it('keeps protected BUYER state cleared when late board quote successes follow a multi-bid authorization failure', async () => {
    const bidA = bid({ id: '10000000-0000-4000-8000-000000000013', vessel_voyage: 'MV Authorization Race A' });
    const bidB = bid({ id: '10000000-0000-4000-8000-000000000014', vessel_voyage: 'MV Authorization Race B' });
    const bidC = bid({ id: '10000000-0000-4000-8000-000000000015', vessel_voyage: 'MV Authorization Race C' });
    const { client } = fakeClient([bidA, bidB, bidC]);
    const onAuthorizationFailure = vi.fn();
    const pending = new Map<string, { promise: Promise<BiddingResult<BuyerSellerComparison[]>>; resolve: (value: BiddingResult<BuyerSellerComparison[]>) => void }>();
    const listBidSellerComparisonForBuyers = vi.fn<BiddingClient['listBidSellerComparisonForBuyers']>((_membershipId, requestedBidId) => {
      const request = deferred<BiddingResult<BuyerSellerComparison[]>>();
      pending.set(requestedBidId, request);
      return request.promise;
    });
    client.listBidSellerComparisonForBuyers = listBidSellerComparisonForBuyers;
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={onAuthorizationFailure} />);

    await waitFor(() => expect(listBidSellerComparisonForBuyers).toHaveBeenCalledTimes(3));
    const denied = pending.get(bidB.id)!;
    await act(async () => {
      denied.resolve({ data: null, error: { kind: 'authorization', code: '42501', message: 'Quote authorization changed during board load' } });
      await denied.promise;
    });
    await waitFor(() => expect(onAuthorizationFailure).toHaveBeenCalledOnce());
    expect(screen.getByRole('alert')).toHaveTextContent('Quote authorization changed during board load');
    expect(screen.queryByRole('article', { name: 'MV Authorization Race A' })).not.toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'MV Authorization Race B' })).not.toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'MV Authorization Race C' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('option', { name: 'Target buyer' })).toHaveLength(0);

    const lateA = pending.get(bidA.id)!;
    const lateC = pending.get(bidC.id)!;
    await act(async () => {
      lateA.resolve(ok([boardComparison(boardQuote(bidA, 'Late Authorized Seller A', '13'))]));
      lateC.resolve(ok([boardComparison(boardQuote(bidC, 'Late Authorized Seller C', '15'))]));
      await Promise.all([lateA.promise, lateC.promise]);
    });
    expect(screen.queryByText('Late Authorized Seller A')).not.toBeInTheDocument();
    expect(screen.queryByText('Late Authorized Seller C')).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(onAuthorizationFailure).toHaveBeenCalledOnce();
  });

  it('ignores a late board quote result from a superseded view generation', async () => {
    const currentBid = bid({ vessel_voyage: 'MV Generation Guard' });
    const stale = deferred<BiddingResult<BuyerSellerComparison[]>>();
    const { client } = fakeClient([currentBid]);
    client.listBidSellerComparisonForBuyers = vi.fn()
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValue(ok([boardComparison(boardQuote(currentBid, 'Current View Seller', '20'))]));
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);

    await screen.findByRole('article', { name: 'MV Generation Guard' });
    fireEvent.click(screen.getByRole('radio', { name: 'Created by me' }));
    await screen.findByText('Current View Seller');
    await act(async () => { stale.resolve(ok([boardComparison(boardQuote(currentBid, 'Stale All View Seller', '21'))])); await stale.promise; });
    expect(screen.getByText('Current View Seller')).toBeInTheDocument();
    expect(screen.queryByText('Stale All View Seller')).not.toBeInTheDocument();
  });

  it('bounds board SELLER-comparison loading to four concurrent requests', async () => {
    const bids = Array.from({ length: 6 }, (_, index) => bid({ id: `10000000-0000-4000-8000-${String(index + 30).padStart(12, '0')}`, vessel_voyage: `MV Concurrency ${index + 1}` }));
    const { client } = fakeClient(bids);
    const pending: ((value: BiddingResult<BuyerSellerComparison[]>) => void)[] = [];
    let active = 0; let maximumActive = 0;
    const listBidSellerComparisonForBuyers = vi.fn<BiddingClient['listBidSellerComparisonForBuyers']>(() => new Promise<BiddingResult<BuyerSellerComparison[]>>((resolve) => {
      active += 1; maximumActive = Math.max(maximumActive, active);
      pending.push((value) => { active -= 1; resolve(value); });
    }));
    client.listBidSellerComparisonForBuyers = listBidSellerComparisonForBuyers;
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);

    await waitFor(() => expect(listBidSellerComparisonForBuyers).toHaveBeenCalledTimes(4));
    expect(maximumActive).toBe(4);
    await act(async () => { pending.shift()!(ok([])); await Promise.resolve(); });
    await waitFor(() => expect(listBidSellerComparisonForBuyers).toHaveBeenCalledTimes(5));
    expect(maximumActive).toBe(4);
    await act(async () => { while (pending.length > 0) pending.shift()!(ok([])); await Promise.resolve(); });
    await waitFor(() => expect(listBidSellerComparisonForBuyers).toHaveBeenCalledTimes(6));
    await act(async () => { while (pending.length > 0) pending.shift()!(ok([])); await Promise.resolve(); });
  });

  it('reloadVersion refreshes both the authoritative bid list and board SELLER comparison', async () => {
    const { client, listBids } = fakeClient();
    const listBidSellerComparisonForBuyers = vi.fn(() => Promise.resolve(ok<BuyerSellerComparison[]>([])));
    client.listBidSellerComparisonForBuyers = listBidSellerComparisonForBuyers;
    const onAuthorizationFailure = vi.fn();
    const { rerender } = render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={onAuthorizationFailure} reloadVersion={0} />);
    await waitFor(() => expect(listBidSellerComparisonForBuyers).toHaveBeenCalledOnce());

    rerender(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={onAuthorizationFailure} reloadVersion={1} />);
    await waitFor(() => expect(listBids).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listBidSellerComparisonForBuyers).toHaveBeenCalledTimes(2));
  });

  it('keeps Manage bid detail on existing access/quote RPCs and refreshes one board comparison after mutation', async () => {
    const initial = bid({ vessel_voyage: 'MV Mutation' });
    const closed = bid({ vessel_voyage: 'MV Mutation', raw_status: 'closed', effective_status: 'closed', revision: 4, closed_at: now });
    const { client, listBids } = fakeClient([initial]);
    const mutationQuote = boardQuote(initial, 'Mutation Seller', '40');
    const listBidSellerComparisonForBuyers = vi.fn(() => Promise.resolve(ok([boardComparison(mutationQuote)])));
    const listQuotesForBuyers = vi.fn(() => Promise.resolve(ok([mutationQuote])));
    const awardBid = vi.fn<BiddingClient['awardBid']>();
    client.listQuotesForBuyers = listQuotesForBuyers;
    client.listBidSellerComparisonForBuyers = listBidSellerComparisonForBuyers;
    client.listBidTraderAccess = vi.fn(() => Promise.resolve(ok<BidTraderAccess[]>([])));
    client.listBidAudit = vi.fn(() => Promise.resolve(ok<BidAuditEvent[]>([])));
    client.closeBid = vi.fn(() => Promise.resolve(ok(closed)));
    client.awardBid = awardBid;
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);

    const card = await screen.findByRole('article', { name: 'MV Mutation' });
    fireEvent.click(within(card).getByRole('button', { name: 'Manage bid' }));
    await waitFor(() => expect(screen.queryByText('Loading bid detail')).not.toBeInTheDocument());
    expect(awardBid).not.toHaveBeenCalled();
    listBids.mockResolvedValueOnce(ok([closed]));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(listBids).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listQuotesForBuyers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listBidSellerComparisonForBuyers).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('article', { name: 'MV Mutation' })).toHaveClass('status-closed');
    expect(awardBid).not.toHaveBeenCalled();
  });

  it('keeps the current detail when a prior bid detail request resolves late', async () => {
    const bidA = bid({ id: '10000000-0000-4000-8000-000000000004', vessel_voyage: 'MV Bid A' });
    const bidB = bid({ id: '10000000-0000-4000-8000-000000000005', vessel_voyage: 'MV Bid B' });
    const staleAccess = deferred<BiddingResult<BidTraderAccess[]>>(); const staleQuotes = deferred<BiddingResult<Quote[]>>(); const staleAudit = deferred<BiddingResult<BidAuditEvent[]>>();
    const currentQuote: Quote = { id: '10000000-0000-4000-8000-000000000006', bid_id: bidB.id, trader_organization_id: '20000000-0000-4000-8000-000000000007', trader_organization_label: 'Current Trader B', revision: 1, created_by: id, fuel_prices: [{ fuel_grade: 'vlsfo', unit_price: 100 }], barge_fee: 0, total_amount: 1000, created_at: now, updated_at: now, access_active: true, organization_active: true, eligible_for_award: true, is_awarded: false, response_status: 'quoted' };
    const staleQuote: Quote = { ...currentQuote, id: '10000000-0000-4000-8000-000000000008', bid_id: bidA.id, trader_organization_id: '20000000-0000-4000-8000-000000000009', trader_organization_label: 'Stale Trader A' };
    const { client } = fakeClient([bidA, bidB]);
    client.listBidTraderAccess = vi.fn((_membershipId, requestedBidId) => requestedBidId === bidA.id ? staleAccess.promise : Promise.resolve(ok<BidTraderAccess[]>([])));
    client.listQuotesForBuyers = vi.fn((_membershipId, requestedBidId) => requestedBidId === bidA.id ? staleQuotes.promise : Promise.resolve(ok([currentQuote])));
    client.listBidAudit = vi.fn((_membershipId, requestedBidId) => requestedBidId === bidA.id ? staleAudit.promise : Promise.resolve(ok<BidAuditEvent[]>([])));
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
    const cardA = await screen.findByRole('article', { name: 'MV Bid A' });
    fireEvent.click(within(cardA).getByRole('button', { name: 'Manage bid' }));
    await screen.findByText('Loading bid detail');
    fireEvent.click(within(screen.getByRole('article', { name: 'MV Bid B' })).getByRole('button', { name: 'Manage bid' }));
    const detailBoard = await screen.findByRole('region', { name: 'Buyer quote comparison' });
    expect(within(detailBoard).getByText('Current Trader B')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'MV Bid B' })).toHaveLength(2);
    await act(async () => {
      staleAccess.resolve(ok([])); staleQuotes.resolve(ok([staleQuote])); staleAudit.resolve(ok([]));
      await Promise.all([staleAccess.promise, staleQuotes.promise, staleAudit.promise]);
    });
    expect(screen.getAllByRole('heading', { name: 'MV Bid B' })).toHaveLength(2);
    expect(within(detailBoard).getByText('Current Trader B')).toBeInTheDocument();
    expect(within(detailBoard).queryByText('Stale Trader A')).not.toBeInTheDocument();
  });

  it('invalidates award confirmation when any quote revision changes before confirmation', async () => {
    const closedBid = bid({ raw_status: 'closed', effective_status: 'closed', revision: 4, closed_at: now });
    const quoteA: Quote = { id: '10000000-0000-4000-8000-000000000004', bid_id: bidId, trader_organization_id: '20000000-0000-4000-8000-000000000003', trader_organization_label: 'Trader A', revision: 1, created_by: id, fuel_prices: [{ fuel_grade: 'vlsfo', unit_price: 100 }], barge_fee: 0, total_amount: 1000, created_at: now, updated_at: now, access_active: true, organization_active: true, eligible_for_award: true, is_awarded: false, response_status: 'quoted' };
    const quoteB: Quote = { ...quoteA, id: '10000000-0000-4000-8000-000000000005', trader_organization_id: '20000000-0000-4000-8000-000000000006', trader_organization_label: 'Trader B', total_amount: 2000 };
    const { client } = fakeClient([closedBid]); const awardBid = vi.fn<BiddingClient['awardBid']>();
    client.listBidTraderAccess = vi.fn(() => Promise.resolve(ok<BidTraderAccess[]>([])));
    client.listBidAudit = vi.fn(() => Promise.resolve(ok<BidAuditEvent[]>([])));
    client.listQuotesForBuyers = vi.fn()
      .mockResolvedValueOnce(ok([quoteA, quoteB]))
      .mockResolvedValueOnce(ok([quoteA, quoteB]))
      .mockResolvedValueOnce(ok([quoteA, { ...quoteB, revision: 2, updated_at: '2026-08-03T04:00:00.000Z' }]));
    client.awardBid = awardBid;
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
    const card = await screen.findByRole('article', { name: 'MV Buyer' });
    fireEvent.click(within(card).getByRole('button', { name: 'Manage bid' }));
    const quoteBoard = await screen.findByRole('region', { name: 'Buyer quote comparison' });
    const quoteAItem = within(quoteBoard).getByText('Trader A').closest('tr');
    expect(quoteAItem).not.toBeNull();
    fireEvent.click(within(quoteAItem!).getByRole('button', { name: 'Award' }));
    expect(screen.getByRole('button', { name: 'Confirm award' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh detail' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm award' })).not.toBeInTheDocument());
    expect(awardBid).not.toHaveBeenCalled();
  });

  it('renders the required BUYER bid list information', async () => {
    const { client } = fakeClient([bid({ raw_status: 'awarded', effective_status: 'awarded', closed_at: now, awarded_quote_id: '10000000-0000-4000-8000-000000000004', awarded_trader_organization_id: '20000000-0000-4000-8000-000000000001', awarded_trader_organization_label: 'Awarded Trader', awarded_total_amount: 100, awarded_at: now })]);
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
    const card = await screen.findByRole('article', { name: 'MV Buyer' });
    expect(within(card).getByText('Busan')).toBeInTheDocument();
    expect(within(card).getByText('Effective status')).toBeInTheDocument();
    expect(within(card).getByText('awarded', { selector: '.status-badge' })).toBeInTheDocument();
    expect(within(card).getByText('Remaining time')).toBeInTheDocument();
    expect(within(card).getByText('Expired')).toBeInTheDocument();
    expect(within(card).getByText((_content, element) => element?.textContent === 'Creator: Creator · Revision 3')).toBeInTheDocument();
    expect(within(card).getByText('Target buyer')).toBeInTheDocument();
    expect(within(card).getAllByText((_content, element) => element?.textContent === 'VLSFO 10 MT').length).toBeGreaterThan(0);
    expect(within(card).getByText(/Revision 3/)).toBeInTheDocument();
    expect(within(card).getByText('Awarded result · authoritative')).toBeInTheDocument();
    expect(within(card).getByText('Awarded Trader · $100')).toBeInTheDocument();
  });

  it('renders advisory BUYER remaining time when a deadline exists', async () => {
    const { client } = fakeClient([bid({ deadline_at: '2099-08-03T03:00:00.000Z' })]);
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
    const card = await screen.findByRole('article', { name: 'MV Buyer' });
    expect(within(card).getByText('Remaining time')).toBeInTheDocument();
    expect(within(card).getByText(/remaining$/)).toBeInTheDocument();
  });

  it('preserves the existing awarded-first then authoritative-total quote ordering in the comparison board', async () => {
    const selectedQuoteId = '10000000-0000-4000-8000-000000000004';
    const awardedBid = bid({
      raw_status: 'awarded', effective_status: 'awarded', closed_at: now,
      awarded_quote_id: selectedQuoteId,
      awarded_trader_organization_id: '20000000-0000-4000-8000-000000000001',
      awarded_trader_organization_label: 'Selected Trader', awarded_total_amount: 300, awarded_at: now,
    });
    const quoteBase: Quote = {
      id: selectedQuoteId, bid_id: bidId, trader_organization_id: '20000000-0000-4000-8000-000000000001', trader_organization_label: 'Selected Trader',
      revision: 2, created_by: id, fuel_prices: [{ fuel_grade: 'vlsfo', unit_price: 30 }], barge_fee: 0, total_amount: 300,
      created_at: now, updated_at: now, access_active: true, organization_active: true, eligible_for_award: false, is_awarded: true, response_status: 'quoted',
    };
    const cheap = { ...quoteBase, id: '10000000-0000-4000-8000-000000000005', trader_organization_id: '20000000-0000-4000-8000-000000000002', trader_organization_label: 'Low Total Trader', total_amount: 100, is_awarded: false };
    const middle = { ...quoteBase, id: '10000000-0000-4000-8000-000000000006', trader_organization_id: '20000000-0000-4000-8000-000000000003', trader_organization_label: 'Middle Total Trader', total_amount: 200, is_awarded: false };
    const { client } = fakeClient([awardedBid]);
    client.listQuotesForBuyers = vi.fn(() => Promise.resolve(ok([middle, quoteBase, cheap])));
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
    const card = await screen.findByRole('article', { name: 'MV Buyer' });
    fireEvent.click(within(card).getByRole('button', { name: 'Manage bid' }));

    const board = await screen.findByRole('region', { name: 'Buyer quote comparison' });
    expect(within(board).getAllByRole('rowheader').map((header) => header.textContent)).toEqual([
      'Selected TraderAccess active · Organization active',
      'Low Total TraderAccess active · Organization active',
      'Middle Total TraderAccess active · Organization active',
    ]);
    expect(within(board).getAllByText(/Selected \/ awarded|Not selected/).map((marker) => marker.textContent)).toEqual(['Selected / awarded', 'Not selected', 'Not selected']);
  });

  it('exposes the active bid as an accessible selected state', async () => {
    const bidA = bid({ id: '10000000-0000-4000-8000-000000000004', vessel_voyage: 'MV Bid A' });
    const bidB = bid({ id: '10000000-0000-4000-8000-000000000005', vessel_voyage: 'MV Bid B' });
    const { client } = fakeClient([bidA, bidB]);
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);

    const first = await screen.findByRole('article', { name: 'MV Bid A' });
    const second = screen.getByRole('article', { name: 'MV Bid B' });
    const firstAction = within(first).getByRole('button', { name: 'Manage bid' });
    const secondAction = within(second).getByRole('button', { name: 'Manage bid' });
    expect(firstAction).toHaveAttribute('aria-pressed', 'false');
    expect(secondAction).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(secondAction);
    await waitFor(() => expect(screen.queryByText('Loading bid detail')).not.toBeInTheDocument());
    expect(within(second).getByRole('button', { name: 'Managing bid' })).toHaveAttribute('aria-pressed', 'true');
    expect(second).toHaveClass('is-selected');
    expect(firstAction).toHaveAttribute('aria-pressed', 'false');
  });

  it.each(['40001', '55000', 'P0002'])('does not retry a %s BUYER state error and retains it after the authoritative reload', async (code) => {
    const initial = bid({ vessel_voyage: 'MV Stale', revision: 3 });
    const refreshed = bid({ vessel_voyage: 'MV Fresh', raw_status: 'closed', effective_status: 'closed', revision: 4, closed_at: now });
    const { client, listBids } = fakeClient([initial]);
    const listBidTraderAccess = vi.fn(() => Promise.resolve(ok<BidTraderAccess[]>([])));
    const listQuotesForBuyers = vi.fn(() => Promise.resolve(ok<Quote[]>([])));
    const listBidSellerComparisonForBuyers = vi.fn(() => Promise.resolve(ok<BuyerSellerComparison[]>([])));
    const listBidAudit = vi.fn(() => Promise.resolve(ok<BidAuditEvent[]>([])));
    const closeBid = vi.fn<BiddingClient['closeBid']>();
    const error = { kind: code === '40001' ? 'conflict' : code === '55000' ? 'lifecycle' : 'not_found', code, message: 'Safe BUYER state error' } as const;
    client.listBidTraderAccess = listBidTraderAccess;
    client.listQuotesForBuyers = listQuotesForBuyers;
    client.listBidSellerComparisonForBuyers = listBidSellerComparisonForBuyers;
    client.listBidAudit = listBidAudit;
    client.closeBid = closeBid;
    closeBid.mockResolvedValueOnce({ data: null, error });
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
    const staleCard = await screen.findByRole('article', { name: 'MV Stale' });
    fireEvent.click(within(staleCard).getByRole('button', { name: 'Manage bid' }));
    await waitFor(() => expect(listBidTraderAccess).toHaveBeenCalledTimes(1));
    listBids.mockResolvedValueOnce(ok([refreshed]));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await screen.findByRole('alert');
    await screen.findAllByText('MV Fresh');
    await waitFor(() => {
      expect(closeBid).toHaveBeenCalledOnce();
      expect(listBids).toHaveBeenCalledTimes(2);
      expect(listBidTraderAccess).toHaveBeenCalledTimes(2);
      expect(listQuotesForBuyers).toHaveBeenCalledTimes(2);
      expect(listBidSellerComparisonForBuyers).toHaveBeenCalledTimes(2);
      expect(listBidAudit).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Safe BUYER state error');
    expect(screen.getAllByText(/Revision 4/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Revision 3/)).not.toBeInTheDocument();
    expect(screen.queryByText('MV Stale')).not.toBeInTheDocument();
  });
});
