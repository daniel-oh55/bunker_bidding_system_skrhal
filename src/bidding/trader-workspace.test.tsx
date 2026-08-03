import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TraderWorkspace } from './trader-workspace';
import type { BiddingClient, BiddingResult } from './bidding-client';
import type { Quote, TraderBid } from './types';

const membership = '10000000-0000-4000-8000-000000000001';
const bidId = '10000000-0000-4000-8000-000000000002';
const quoteId = '10000000-0000-4000-8000-000000000003';
const organizationId = '20000000-0000-4000-8000-000000000001';
const now = '2026-08-03T03:00:00.000Z';
const ok = <T,>(data: T): BiddingResult<T> => ({ data, error: null });
const traderBid = (overrides: Partial<TraderBid> = {}): TraderBid => ({ id: bidId, vessel_voyage: 'MV Trader', port_name: 'Busan', delivery_window: 'Tomorrow', deadline_at: null, raw_status: 'open', effective_status: 'open', revision: 4, fuel_items: [{ fuel_grade: 'lsmgo', quantity_mt: 20 }, { fuel_grade: 'vlsfo', quantity_mt: 10 }], created_at: now, updated_at: now, closed_at: null, cancelled_at: null, ...overrides });
const quote = (overrides: Partial<Quote> = {}): Quote => ({ id: quoteId, bid_id: bidId, trader_organization_id: organizationId, trader_organization_label: 'Own organization', revision: 7, created_by: membership, fuel_prices: [{ fuel_grade: 'lsmgo', unit_price: 3 }, { fuel_grade: 'vlsfo', unit_price: 2 }], barge_fee: 5, total_amount: 85, created_at: now, updated_at: now, access_active: true, organization_active: true, eligible_for_award: true, is_awarded: false, ...overrides });

function clientWith(bids: TraderBid[] = [traderBid()], quotes: Quote[] = []) {
  const listTraderBids = vi.fn(() => Promise.resolve(ok(bids)));
  const listMyQuotes = vi.fn(() => Promise.resolve(ok(quotes)));
  const createQuote = vi.fn<BiddingClient['createQuote']>(() => Promise.resolve(ok(quote())));
  const updateQuote = vi.fn<BiddingClient['updateQuote']>(() => Promise.resolve(ok(quote())));
  const unused = vi.fn(() => Promise.resolve(ok([])));
  const client = { listActiveBuyers: unused, listBids: unused, listBidAudit: unused, createBid: unused, updateBid: unused, reassignBid: unused, closeBid: unused, reopenBid: unused, cancelBid: unused, listActiveTraderOrganizations: unused, listBidTraderAccess: unused, grantBidTraderAccess: unused, revokeBidTraderAccess: unused, listQuotesForBuyers: unused, awardBid: unused, listTraderBids, listMyQuotes, createQuote, updateQuote } as unknown as BiddingClient;
  return { client, listTraderBids, listMyQuotes, createQuote, updateQuote, unused };
}

describe('TRADER workspace', () => {
  it('initially loads only the two TRADER feeds', async () => {
    const { client, listTraderBids, listMyQuotes, unused } = clientWith();
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await waitFor(() => expect(listTraderBids).toHaveBeenCalledOnce());
    expect(listMyQuotes).toHaveBeenCalledOnce();
    expect(listTraderBids).toHaveBeenCalledWith(membership);
    expect(listMyQuotes).toHaveBeenCalledWith(membership);
    expect(unused).not.toHaveBeenCalled();
  });

  it('submits quote arrays in server fuel-item order and omits calculated and identity fields', async () => {
    const { client, createQuote } = clientWith();
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Create quote' });
    fireEvent.change(screen.getByLabelText('lsmgo unit price'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('vlsfo unit price'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Barge fee'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save quote' }));
    await waitFor(() => expect(createQuote).toHaveBeenCalledOnce());
    expect(createQuote).toHaveBeenCalledWith(membership, bidId, { fuelGrades: ['lsmgo', 'vlsfo'], unitPrices: [3, 2], bargeFee: 5 });
    expect(createQuote.mock.calls[0]![2]).not.toHaveProperty('totalAmount');
    expect(createQuote.mock.calls[0]![2]).not.toHaveProperty('createdBy');
    expect(createQuote.mock.calls[0]![2]).not.toHaveProperty('traderOrganizationId');
  });

  it('updates with the current quote revision and displays the server total after reload', async () => {
    const existing = quote({ total_amount: 91, revision: 9 }); const { client, updateQuote } = clientWith([traderBid()], [existing]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await screen.findByText(/Authoritative server total: 91/);
    fireEvent.click(screen.getByRole('button', { name: 'Update quote' }));
    await waitFor(() => expect(updateQuote).toHaveBeenCalledWith(membership, quoteId, 9, expect.any(Object)));
  });

  it.each([
    ['expired', traderBid({ raw_status: 'open', effective_status: 'closed' })],
    ['closed', traderBid({ raw_status: 'closed', effective_status: 'closed', closed_at: now })],
    ['cancelled', traderBid({ raw_status: 'cancelled', effective_status: 'cancelled', cancelled_at: now })],
    ['awarded', traderBid({ raw_status: 'awarded', effective_status: 'awarded', closed_at: now })],
  ])('does not save a %s bid', async (_, lockedBid) => {
    const { client } = clientWith([lockedBid]); render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Create quote' });
    expect(screen.getByRole('button', { name: 'Save quote' })).toBeDisabled();
  });

  it('shows only the own-winner message and clears stale protected data on 42501', async () => {
    const onAuthorizationFailure = vi.fn(); const { client, listTraderBids } = clientWith([traderBid({ raw_status: 'awarded', effective_status: 'awarded', closed_at: now })], [quote({ is_awarded: true, eligible_for_award: false })]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={onAuthorizationFailure} />);
    expect(await screen.findByText(/your organization.*selected/i)).toBeInTheDocument();
    expect(screen.queryByText('Own organization')).not.toBeInTheDocument();
    listTraderBids.mockResolvedValueOnce({ data: null, error: { kind: 'authorization', code: '42501', message: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(onAuthorizationFailure).toHaveBeenCalledOnce());
    expect(screen.queryByText('MV Trader')).not.toBeInTheDocument();
  });
});
