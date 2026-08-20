import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TraderWorkspace } from './trader-workspace';
import type { BiddingClient, BiddingResult } from './bidding-client';
import type { Quote, TraderBid, WorkflowError } from './types';

const membership = '10000000-0000-4000-8000-000000000001';
const bidId = '10000000-0000-4000-8000-000000000002';
const quoteId = '10000000-0000-4000-8000-000000000003';
const organizationId = '20000000-0000-4000-8000-000000000001';
const now = '2026-08-03T03:00:00.000Z';
const ok = <T,>(data: T): BiddingResult<T> => ({ data, error: null });
const traderBid = (overrides: Partial<TraderBid> = {}): TraderBid => ({ id: bidId, vessel_voyage: 'MV Trader', port_name: 'Busan', delivery_window: 'Tomorrow', deadline_at: now, raw_status: 'open', effective_status: 'open', revision: 4, fuel_items: [{ fuel_grade: 'lsmgo', quantity_mt: 20 }, { fuel_grade: 'vlsfo', quantity_mt: 10 }], created_at: now, updated_at: now, closed_at: null, cancelled_at: null, ...overrides });
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
  it('shows a clear empty state after the accessible bid feed loads empty', async () => {
    const { client } = clientWith([]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);

    expect(await screen.findByText('No accessible bids')).toBeInTheDocument();
    expect(screen.getByText(/No bids are currently available to your organization/)).toBeInTheDocument();
  });

  it('initially loads only the two TRADER feeds', async () => {
    const { client, listTraderBids, listMyQuotes, unused } = clientWith();
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await waitFor(() => expect(listTraderBids).toHaveBeenCalledOnce());
    expect(listMyQuotes).toHaveBeenCalledOnce();
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
    expect(Object.keys(createQuote.mock.calls[0]![2])).toEqual(['fuelGrades', 'unitPrices', 'bargeFee']);
  });

  it('makes an open bid without an own quote explicit while retaining quote entry', async () => {
    const { client } = clientWith();
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);

    const ownQuoteState = await screen.findByRole('region', { name: 'Own quote state' });
    expect(ownQuoteState).toHaveTextContent('No own quote submitted');
    expect(ownQuoteState).toHaveTextContent('Your organization has not submitted a quote for this bid.');
    expect(screen.getByRole('heading', { name: 'Create quote' })).toBeInTheDocument();
  });

  it('shows requested fuel quantities beside their matching unit-price inputs', async () => {
    const { client } = clientWith();
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Create quote' });
    const lsmgoRow = screen.getByLabelText('lsmgo unit price').closest('.trader-fuel-price-row');
    const vlsfoRow = screen.getByLabelText('vlsfo unit price').closest('.trader-fuel-price-row');
    expect(lsmgoRow).toHaveTextContent('LSMGO20 MT requested');
    expect(vlsfoRow).toHaveTextContent('VLSFO10 MT requested');
  });

  it('presents the client estimate as non-authoritative and distinct from the existing server total', async () => {
    const { client } = clientWith([traderBid()], [quote()]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);

    await screen.findByDisplayValue('3');
    fireEvent.change(screen.getByLabelText('lsmgo unit price'), { target: { value: '4' } });
    const totals = await screen.findByLabelText('Quote totals');
    const estimate = within(totals).getByText('Client estimate').closest('div');
    const authoritative = within(totals).getByText('Authoritative server total').closest('div');
    expect(estimate).toHaveTextContent('105');
    expect(estimate).toHaveTextContent('Preview only. The server calculates the authoritative total after submission.');
    expect(authoritative).toHaveTextContent('85');
    expect(authoritative).toHaveTextContent('Current total returned by the server.');
    expect(estimate).not.toBe(authoritative);
  });

  it('resets collaborative quote drafts to the authoritative quote identity and revision', async () => {
    const initial = quote({ revision: 7, fuel_prices: [{ fuel_grade: 'lsmgo', unit_price: 3 }, { fuel_grade: 'vlsfo', unit_price: 2 }], barge_fee: 5 });
    const refreshed = quote({ revision: 8, fuel_prices: [{ fuel_grade: 'lsmgo', unit_price: 9 }, { fuel_grade: 'vlsfo', unit_price: 8 }], barge_fee: 7, total_amount: 267 });
    const { client, listTraderBids, listMyQuotes, updateQuote } = clientWith([traderBid()], [initial]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await screen.findByDisplayValue('3');
    listTraderBids.mockResolvedValueOnce(ok([traderBid()]));
    listMyQuotes.mockResolvedValueOnce(ok([refreshed]));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByDisplayValue('9');
    expect(screen.getByLabelText('vlsfo unit price')).toHaveValue(8);
    expect(screen.getByLabelText('Barge fee')).toHaveValue(7);
    expect(screen.queryByDisplayValue('3')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Update quote' }));
    await waitFor(() => expect(updateQuote).toHaveBeenCalledWith(membership, quoteId, 8, { fuelGrades: ['lsmgo', 'vlsfo'], unitPrices: [9, 8], bargeFee: 7 }));
    expect(updateQuote.mock.calls[0]).toEqual([membership, quoteId, 8, { fuelGrades: ['lsmgo', 'vlsfo'], unitPrices: [9, 8], bargeFee: 7 }]);
    expect(Object.keys(updateQuote.mock.calls[0]![3])).toEqual(['fuelGrades', 'unitPrices', 'bargeFee']);
  });

  it.each(['40001', '55000', 'P0002'])('does not retry a %s quote-state error and reloads both authoritative feeds once', async (code) => {
    const initial = quote({ revision: 7 }); const refreshed = quote({ revision: 8, fuel_prices: [{ fuel_grade: 'lsmgo', unit_price: 6 }, { fuel_grade: 'vlsfo', unit_price: 4 }], barge_fee: 9 });
    const { client, listTraderBids, listMyQuotes, updateQuote } = clientWith([traderBid()], [initial]);
    const error: WorkflowError = { kind: code === '40001' ? 'conflict' : code === '55000' ? 'lifecycle' : 'not_found', code, message: 'Safe state error' };
    updateQuote.mockResolvedValueOnce({ data: null, error });
    listTraderBids.mockResolvedValueOnce(ok([traderBid()])).mockResolvedValueOnce(ok([traderBid()]));
    listMyQuotes.mockResolvedValueOnce(ok([initial])).mockResolvedValueOnce(ok([refreshed]));
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await screen.findByRole('button', { name: 'Update quote' });
    fireEvent.click(screen.getByRole('button', { name: 'Update quote' }));
    await screen.findByRole('alert');
    expect(updateQuote).toHaveBeenCalledOnce();
    expect(listTraderBids).toHaveBeenCalledTimes(2);
    expect(listMyQuotes).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('lsmgo unit price')).toHaveValue(6);
    expect(screen.getByLabelText('Barge fee')).toHaveValue(9);
  });

  it('clears TRADER data and invalidates access on 42501 without an older reload repopulating it', async () => {
    const onAuthorizationFailure = vi.fn(); const { client, updateQuote } = clientWith([traderBid()], [quote()]);
    updateQuote.mockResolvedValueOnce({ data: null, error: { kind: 'authorization', code: '42501', message: 'changed' } });
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={onAuthorizationFailure} />);
    await screen.findByRole('button', { name: 'Update quote' });
    fireEvent.click(screen.getByRole('button', { name: 'Update quote' }));
    await waitFor(() => expect(onAuthorizationFailure).toHaveBeenCalledOnce());
    expect(screen.queryByText('MV Trader')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update quote' })).not.toBeInTheDocument();
  });

  it('fails closed on a TRADER primary protocol error', async () => {
    const { client, listTraderBids, listMyQuotes } = clientWith([traderBid()], [quote()]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await screen.findByText('MV Trader');
    listTraderBids.mockResolvedValueOnce({ data: null, error: { kind: 'protocol', code: null, message: 'Invalid protocol' } });
    listMyQuotes.mockResolvedValueOnce(ok([]));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('MV Trader')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update quote' })).not.toBeInTheDocument();
  });

  it('renders required TRADER operational data without competitor data', async () => {
    const { client } = clientWith([traderBid()], [quote()]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    const requirements = await screen.findByRole('region', { name: 'Bid requirements for MV Trader' });
    expect(screen.getByText('Effective status')).toBeInTheDocument();
    expect(screen.getByText('Own quote revision')).toBeInTheDocument();
    expect(within(requirements).getByText('Deadline')).toBeInTheDocument();
    expect(within(requirements).getByText('Delivery window')).toBeInTheDocument();
    expect(within(requirements).getByText('LSMGO')).toBeInTheDocument();
    expect(within(requirements).getByText('20 MT requested')).toBeInTheDocument();
    expect(within(requirements).getByText('VLSFO')).toBeInTheDocument();
    expect(within(requirements).getByText('10 MT requested')).toBeInTheDocument();
    expect(screen.queryByText('Competitor')).not.toBeInTheDocument();
  });

  it('renders a closed own quote as read-only with its authoritative values', async () => {
    const { client } = clientWith([traderBid({ raw_status: 'closed', effective_status: 'closed', closed_at: now })], [quote()]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await screen.findByText('Quote submission is closed.');
    expect(screen.getByRole('status')).toHaveTextContent('Quote submission is closed.');
    expect(screen.getByRole('region', { name: 'Your quote summary' })).toHaveTextContent('LSMGO unit price');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /quote/i })).not.toBeInTheDocument();
  });

  it('renders a cancelled own quote as a read-only authoritative summary', async () => {
    const { client } = clientWith(
      [traderBid({ raw_status: 'cancelled', effective_status: 'cancelled', cancelled_at: now })],
      [quote()],
    );
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await screen.findByText('This bid has been cancelled.');
    expect(screen.getByRole('status')).toHaveTextContent('This bid has been cancelled.');
    const summary = screen.getByRole('region', { name: 'Your quote summary' });
    expect(summary).toHaveTextContent('LSMGO unit price');
    expect(summary).toHaveTextContent('3');
    expect(summary).toHaveTextContent('VLSFO unit price');
    expect(summary).toHaveTextContent('2');
    expect(summary).toHaveTextContent('Barge fee');
    expect(summary).toHaveTextContent('5');
    expect(summary).toHaveTextContent('Authoritative server total');
    expect(summary).toHaveTextContent('85');
    expect(summary).toHaveTextContent('Own quote revision');
    expect(summary).toHaveTextContent('7');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save quote' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update quote' })).not.toBeInTheDocument();
  });

  it.each([[true, 'Selected. Your organization’s quote was selected.'], [false, 'Not selected. The award process is complete.']])('renders an awarded own quote as %s read-only', async (isAwarded, message) => {
    const { client } = clientWith([traderBid({ raw_status: 'awarded', effective_status: 'awarded', closed_at: now })], [quote({ is_awarded: isAwarded })]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await screen.findByText(message);
    expect(screen.getByRole('status')).toHaveTextContent(message);
    expect(screen.getByRole('region', { name: 'Your quote summary' })).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save quote' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update quote' })).not.toBeInTheDocument();
  });

  it('keeps a terminal bid without an own quote neutral and free of competitor data', async () => {
    const { client } = clientWith([traderBid({ raw_status: 'awarded', effective_status: 'awarded', closed_at: now })]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await screen.findByText('The award process is complete.');
    expect(screen.getByRole('status')).toHaveTextContent('The award process is complete.');
    expect(screen.getByRole('region', { name: 'Own quote state' })).toHaveTextContent('No own quote submitted');
    expect(screen.queryByRole('region', { name: 'Your quote summary' })).not.toBeInTheDocument();
    expect(screen.queryByText(/selected organization|competitor/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('distinguishes open, own-quoted, and accessible counts from the authoritative feeds', async () => {
    const { client } = clientWith([
      traderBid(),
      traderBid({ id: '10000000-0000-4000-8000-000000000004', vessel_voyage: 'MV Terminal', raw_status: 'awarded', effective_status: 'awarded', closed_at: now }),
      traderBid({ id: '10000000-0000-4000-8000-000000000005', vessel_voyage: 'MV Open' }),
    ], [quote()]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    const summary = (await screen.findByRole('heading', { name: 'Quote workspace' })).closest('section');
    expect(summary).toHaveTextContent('2 open for quoting');
    expect(summary).toHaveTextContent('1 own-organization quote');
    expect(summary).toHaveTextContent('3 accessible bids');
  });
});
