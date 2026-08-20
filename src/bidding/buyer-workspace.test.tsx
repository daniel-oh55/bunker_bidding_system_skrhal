import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BuyerWorkspace } from './buyer-workspace';
import type { BiddingClient, BiddingResult } from './bidding-client';
import type { ActiveBuyer, Bid, BidAuditEvent, BidTraderAccess, Quote, TraderBid, TraderOrganization } from './types';

const id = '10000000-0000-4000-8000-000000000001'; const target = '10000000-0000-4000-8000-000000000002'; const bidId = '10000000-0000-4000-8000-000000000003'; const now = '2026-08-03T03:00:00.000Z';
const ok = <T,>(data: T): BiddingResult<T> => ({ data, error: null });
const bid = (overrides: Partial<Bid> = {}): Bid => ({ id: bidId, vessel_voyage: 'MV Buyer', port_name: 'Busan', delivery_window: 'Tomorrow', deadline_at: now, raw_status: 'open', effective_status: 'open', revision: 3, created_by: id, created_by_label: 'Creator', responsible_buyer_user_id: target, responsible_buyer_label: 'Target buyer', fuel_items: [{ fuel_grade: 'vlsfo', quantity_mt: 10 }], created_at: now, updated_at: now, closed_at: null, cancelled_at: null, awarded_quote_id: null, awarded_trader_organization_id: null, awarded_trader_organization_label: null, awarded_total_amount: null, awarded_at: null, ...overrides });
const deferred = <T,>() => { let resolve!: (value: T) => void; return { promise: new Promise<T>((done) => { resolve = done; }), resolve }; };
function fakeClient(bids: Bid[] = [bid()]) {
  const listBids = vi.fn(() => Promise.resolve(ok(bids)));
  const listActiveBuyers = vi.fn(() => Promise.resolve(ok<ActiveBuyer[]>([{ user_id: target, display_label: 'Target buyer', active_buyer_membership_count: 1 }])));
  const listActiveTraderOrganizations = vi.fn(() => Promise.resolve(ok<TraderOrganization[]>([])));
  const client: BiddingClient = { listActiveBuyers, listBids, listBidAudit: () => Promise.resolve(ok<BidAuditEvent[]>([])), createBid: () => Promise.resolve(ok<Bid>(null as never)), updateBid: () => Promise.resolve(ok<Bid>(null as never)), reassignBid: () => Promise.resolve(ok<Bid>(null as never)), closeBid: () => Promise.resolve(ok<Bid>(null as never)), reopenBid: () => Promise.resolve(ok<Bid>(null as never)), cancelBid: () => Promise.resolve(ok<Bid>(null as never)), listActiveTraderOrganizations, listBidTraderAccess: () => Promise.resolve(ok<BidTraderAccess[]>([])), grantBidTraderAccess: () => Promise.resolve(ok<Bid>(null as never)), revokeBidTraderAccess: () => Promise.resolve(ok<Bid>(null as never)), listQuotesForBuyers: () => Promise.resolve(ok<Quote[]>([])), awardBid: () => Promise.resolve(ok<Bid>(null as never)), listTraderBids: () => Promise.resolve(ok<TraderBid[]>([])), listMyQuotes: () => Promise.resolve(ok<Quote[]>([])), createQuote: () => Promise.resolve(ok<Quote>(null as never)), updateQuote: () => Promise.resolve(ok<Quote>(null as never)) };
  return { client, listBids, listActiveBuyers, listActiveTraderOrganizations };
}

describe('BUYER workspace', () => {
  it('presents human-readable BUYER views while preserving the exact server view arguments', async () => {
    const { client, listBids } = fakeClient();
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);

    await screen.findByRole('button', { name: /MV Buyer/ });
    expect(screen.getByRole('radio', { name: 'All bids' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Created by me' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'By BUYER' })).not.toBeChecked();
    expect(listBids).toHaveBeenLastCalledWith(id, 'all', undefined);

    fireEvent.click(screen.getByRole('radio', { name: 'Created by me' }));
    await waitFor(() => expect(listBids).toHaveBeenCalledTimes(2));
    expect(listBids).toHaveBeenLastCalledWith(id, 'created_by_me', undefined);
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
    expect(listBids).toHaveBeenLastCalledWith(id, 'responsible_buyer', target);
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
    await screen.findByRole('button', { name: /MV Buyer/ });
    fireEvent.click(screen.getByRole('button', { name: /MV Buyer/ }));
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

  it('keeps the current detail when a prior bid detail request resolves late', async () => {
    const bidA = bid({ id: '10000000-0000-4000-8000-000000000004', vessel_voyage: 'MV Bid A' });
    const bidB = bid({ id: '10000000-0000-4000-8000-000000000005', vessel_voyage: 'MV Bid B' });
    const staleAccess = deferred<BiddingResult<BidTraderAccess[]>>(); const staleQuotes = deferred<BiddingResult<Quote[]>>(); const staleAudit = deferred<BiddingResult<BidAuditEvent[]>>();
    const currentQuote: Quote = { id: '10000000-0000-4000-8000-000000000006', bid_id: bidB.id, trader_organization_id: '20000000-0000-4000-8000-000000000007', trader_organization_label: 'Current Trader B', revision: 1, created_by: id, fuel_prices: [{ fuel_grade: 'vlsfo', unit_price: 100 }], barge_fee: 0, total_amount: 1000, created_at: now, updated_at: now, access_active: true, organization_active: true, eligible_for_award: true, is_awarded: false };
    const staleQuote: Quote = { ...currentQuote, id: '10000000-0000-4000-8000-000000000008', bid_id: bidA.id, trader_organization_id: '20000000-0000-4000-8000-000000000009', trader_organization_label: 'Stale Trader A' };
    const { client } = fakeClient([bidA, bidB]);
    client.listBidTraderAccess = vi.fn((_membershipId, requestedBidId) => requestedBidId === bidA.id ? staleAccess.promise : Promise.resolve(ok<BidTraderAccess[]>([])));
    client.listQuotesForBuyers = vi.fn((_membershipId, requestedBidId) => requestedBidId === bidA.id ? staleQuotes.promise : Promise.resolve(ok([currentQuote])));
    client.listBidAudit = vi.fn((_membershipId, requestedBidId) => requestedBidId === bidA.id ? staleAudit.promise : Promise.resolve(ok<BidAuditEvent[]>([])));
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
    await screen.findByRole('button', { name: /MV Bid A/ });
    fireEvent.click(screen.getByRole('button', { name: /MV Bid A/ }));
    await screen.findByText('Loading bid detail');
    fireEvent.click(screen.getByRole('button', { name: /MV Bid B/ }));
    await screen.findByText('Current Trader B');
    expect(screen.getByRole('heading', { name: 'MV Bid B' })).toBeInTheDocument();
    await act(async () => {
      staleAccess.resolve(ok([])); staleQuotes.resolve(ok([staleQuote])); staleAudit.resolve(ok([]));
      await Promise.all([staleAccess.promise, staleQuotes.promise, staleAudit.promise]);
    });
    expect(screen.getByRole('heading', { name: 'MV Bid B' })).toBeInTheDocument();
    expect(screen.getByText('Current Trader B')).toBeInTheDocument();
    expect(screen.queryByText('Stale Trader A')).not.toBeInTheDocument();
  });

  it('invalidates award confirmation when any quote revision changes before confirmation', async () => {
    const closedBid = bid({ raw_status: 'closed', effective_status: 'closed', revision: 4, closed_at: now });
    const quoteA: Quote = { id: '10000000-0000-4000-8000-000000000004', bid_id: bidId, trader_organization_id: '20000000-0000-4000-8000-000000000003', trader_organization_label: 'Trader A', revision: 1, created_by: id, fuel_prices: [{ fuel_grade: 'vlsfo', unit_price: 100 }], barge_fee: 0, total_amount: 1000, created_at: now, updated_at: now, access_active: true, organization_active: true, eligible_for_award: true, is_awarded: false };
    const quoteB: Quote = { ...quoteA, id: '10000000-0000-4000-8000-000000000005', trader_organization_id: '20000000-0000-4000-8000-000000000006', trader_organization_label: 'Trader B', total_amount: 2000 };
    const { client } = fakeClient([closedBid]); const awardBid = vi.fn<BiddingClient['awardBid']>();
    client.listBidTraderAccess = vi.fn(() => Promise.resolve(ok<BidTraderAccess[]>([])));
    client.listBidAudit = vi.fn(() => Promise.resolve(ok<BidAuditEvent[]>([])));
    client.listQuotesForBuyers = vi.fn().mockResolvedValueOnce(ok([quoteA, quoteB])).mockResolvedValueOnce(ok([quoteA, { ...quoteB, revision: 2, updated_at: '2026-08-03T04:00:00.000Z' }]));
    client.awardBid = awardBid;
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
    await screen.findByRole('button', { name: /MV Buyer/ });
    fireEvent.click(screen.getByRole('button', { name: /MV Buyer/ }));
    const quoteAItem = (await screen.findByText('Trader A')).closest('li');
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
    const card = await screen.findByRole('button', { name: /MV Buyer/ });
    expect(within(card).getByText('Busan')).toBeInTheDocument();
    expect(within(card).getByText('Effective status: awarded')).toBeInTheDocument();
    expect(within(card).getByText('Raw status: awarded')).toBeInTheDocument();
    expect(within(card).getByText('Creator: Creator')).toBeInTheDocument();
    expect(within(card).getByText('Target buyer')).toBeInTheDocument();
    expect(within(card).getByText('VLSFO 10')).toBeInTheDocument();
    expect(within(card).getByText('Revision 3')).toBeInTheDocument();
    expect(within(card).getByText('Awarded to Awarded Trader; total 100')).toBeInTheDocument();
  });

  it('exposes the active bid as an accessible selected state', async () => {
    const bidA = bid({ id: '10000000-0000-4000-8000-000000000004', vessel_voyage: 'MV Bid A' });
    const bidB = bid({ id: '10000000-0000-4000-8000-000000000005', vessel_voyage: 'MV Bid B' });
    const { client } = fakeClient([bidA, bidB]);
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);

    const first = await screen.findByRole('button', { name: /MV Bid A/ });
    const second = screen.getByRole('button', { name: /MV Bid B/ });
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(second).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(second);
    await waitFor(() => expect(screen.queryByText('Loading bid detail')).not.toBeInTheDocument());
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(second).toHaveClass('is-selected');
    expect(first).toHaveAttribute('aria-pressed', 'false');
  });

  it.each(['40001', '55000', 'P0002'])('does not retry a %s BUYER state error and retains it after the authoritative reload', async (code) => {
    const initial = bid({ vessel_voyage: 'MV Stale', revision: 3 });
    const refreshed = bid({ vessel_voyage: 'MV Fresh', raw_status: 'closed', effective_status: 'closed', revision: 4, closed_at: now });
    const { client, listBids } = fakeClient([initial]);
    const listBidTraderAccess = vi.fn(() => Promise.resolve(ok<BidTraderAccess[]>([])));
    const listQuotesForBuyers = vi.fn(() => Promise.resolve(ok<Quote[]>([])));
    const listBidAudit = vi.fn(() => Promise.resolve(ok<BidAuditEvent[]>([])));
    const closeBid = vi.fn<BiddingClient['closeBid']>();
    const error = { kind: code === '40001' ? 'conflict' : code === '55000' ? 'lifecycle' : 'not_found', code, message: 'Safe BUYER state error' } as const;
    client.listBidTraderAccess = listBidTraderAccess;
    client.listQuotesForBuyers = listQuotesForBuyers;
    client.listBidAudit = listBidAudit;
    client.closeBid = closeBid;
    closeBid.mockResolvedValueOnce({ data: null, error });
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
    await screen.findByRole('button', { name: /MV Stale/ });
    fireEvent.click(screen.getByRole('button', { name: /MV Stale/ }));
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
      expect(listBidAudit).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Safe BUYER state error');
    expect(screen.getByText('Revision 4')).toBeInTheDocument();
    expect(screen.queryByText('Revision 3')).not.toBeInTheDocument();
    expect(screen.queryByText('MV Stale')).not.toBeInTheDocument();
  });
});
