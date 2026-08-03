import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BuyerWorkspace } from './buyer-workspace';
import type { BiddingClient, BiddingResult } from './bidding-client';
import type { ActiveBuyer, Bid, BidAuditEvent, BidTraderAccess, Quote, TraderBid, TraderOrganization } from './types';

const id = '10000000-0000-4000-8000-000000000001'; const target = '10000000-0000-4000-8000-000000000002'; const bidId = '10000000-0000-4000-8000-000000000003'; const now = '2026-08-03T03:00:00.000Z';
const ok = <T,>(data: T): BiddingResult<T> => ({ data, error: null });
const bid = (overrides: Partial<Bid> = {}): Bid => ({ id: bidId, vessel_voyage: 'MV Buyer', port_name: 'Busan', delivery_window: 'Tomorrow', deadline_at: now, raw_status: 'open', effective_status: 'open', revision: 3, created_by: id, created_by_label: 'Creator', responsible_buyer_user_id: target, responsible_buyer_label: 'Target buyer', fuel_items: [{ fuel_grade: 'vlsfo', quantity_mt: 10 }], created_at: now, updated_at: now, closed_at: null, cancelled_at: null, awarded_quote_id: null, awarded_trader_organization_id: null, awarded_trader_organization_label: null, awarded_total_amount: null, awarded_at: null, ...overrides });
function fakeClient(bids: Bid[] = [bid()]) {
  const listBids = vi.fn(() => Promise.resolve(ok(bids)));
  const listActiveBuyers = vi.fn(() => Promise.resolve(ok<ActiveBuyer[]>([{ user_id: target, display_label: 'Target buyer', active_buyer_membership_count: 1 }])));
  const listActiveTraderOrganizations = vi.fn(() => Promise.resolve(ok<TraderOrganization[]>([])));
  const client: BiddingClient = { listActiveBuyers, listBids, listBidAudit: () => Promise.resolve(ok<BidAuditEvent[]>([])), createBid: () => Promise.resolve(ok<Bid>(null as never)), updateBid: () => Promise.resolve(ok<Bid>(null as never)), reassignBid: () => Promise.resolve(ok<Bid>(null as never)), closeBid: () => Promise.resolve(ok<Bid>(null as never)), reopenBid: () => Promise.resolve(ok<Bid>(null as never)), cancelBid: () => Promise.resolve(ok<Bid>(null as never)), listActiveTraderOrganizations, listBidTraderAccess: () => Promise.resolve(ok<BidTraderAccess[]>([])), grantBidTraderAccess: () => Promise.resolve(ok<Bid>(null as never)), revokeBidTraderAccess: () => Promise.resolve(ok<Bid>(null as never)), listQuotesForBuyers: () => Promise.resolve(ok<Quote[]>([])), awardBid: () => Promise.resolve(ok<Bid>(null as never)), listTraderBids: () => Promise.resolve(ok<TraderBid[]>([])), listMyQuotes: () => Promise.resolve(ok<Quote[]>([])), createQuote: () => Promise.resolve(ok<Quote>(null as never)), updateQuote: () => Promise.resolve(ok<Quote>(null as never)) };
  return { client, listBids, listActiveBuyers, listActiveTraderOrganizations };
}

describe('BUYER workspace', () => {
  it('clears the prior list and gates responsible-BUYER requests until a server-returned target is selected', async () => {
    const { client, listBids } = fakeClient(); render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
    await screen.findByText('MV Buyer');
    expect(listBids).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText(/responsible buyer/i, { selector: 'input' }));
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

  it('renders the required BUYER bid list information', async () => {
    const { client } = fakeClient([bid({ raw_status: 'awarded', effective_status: 'awarded', closed_at: now, awarded_quote_id: '10000000-0000-4000-8000-000000000004', awarded_trader_organization_id: '20000000-0000-4000-8000-000000000001', awarded_trader_organization_label: 'Awarded Trader', awarded_total_amount: 100, awarded_at: now })]);
    render(<BuyerWorkspace client={client} membershipId={id} onAuthorizationFailure={vi.fn()} />);
    await screen.findByText(/Raw status: awarded/);
    expect(screen.getByText(/effective status: awarded/)).toBeInTheDocument();
    expect(screen.getByText(/Creator: Creator; responsible BUYER: Target buyer/)).toBeInTheDocument();
    expect(screen.getByText(/Fuel: VLSFO 10/)).toBeInTheDocument();
    expect(screen.getByText(/awarded to Awarded Trader; total 100/)).toBeInTheDocument();
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
