import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const traderBid = (overrides: Partial<TraderBid> = {}): TraderBid => ({ id: bidId, vessel_voyage: 'MV Trader', port_name: 'Busan', delivery_window: 'Tomorrow', deadline_at: now, raw_status: 'open', effective_status: 'open', revision: 4, fuel_items: [{ fuel_grade: 'lsmgo', quantity_mt: 20 }, { fuel_grade: 'vlsfo', quantity_mt: 10 }], created_at: now, updated_at: now, closed_at: null, cancelled_at: null, ...overrides, response_status: overrides.response_status ?? 'awaiting', response_revision: overrides.response_revision ?? 1 });
const quote = (overrides: Partial<Quote> = {}): Quote => ({ id: quoteId, bid_id: bidId, trader_organization_id: organizationId, trader_organization_label: 'Own organization', revision: 7, created_by: membership, fuel_prices: [{ fuel_grade: 'lsmgo', unit_price: 3 }, { fuel_grade: 'vlsfo', unit_price: 2 }], barge_fee: 5, total_amount: 85, created_at: now, updated_at: now, access_active: true, organization_active: true, eligible_for_award: true, is_awarded: false, ...overrides, response_status: overrides.response_status ?? 'quoted' });

function clientWith(bids: TraderBid[] = [traderBid()], quotes: Quote[] = []) {
  const listTraderBids = vi.fn(() => Promise.resolve(ok(bids)));
  const listMyQuotes = vi.fn(() => Promise.resolve(ok(quotes)));
  const submitQuoteResponse = vi.fn<BiddingClient['submitQuoteResponse']>(() => Promise.resolve(ok(quote())));
  const giveUpQuoteResponse = vi.fn<BiddingClient['giveUpQuoteResponse']>(() => Promise.resolve(ok({ bid_id: bidId, trader_organization_id: organizationId, response_status: 'gave_up', revision: 2, quote_id: null, quote_revision: null })));
  const unused = vi.fn(() => Promise.resolve(ok([])));
  const client = { listActiveBuyers: unused, listBids: unused, listBidAudit: unused, createBid: unused, updateBid: unused, reassignBid: unused, closeBid: unused, reopenBid: unused, cancelBid: unused, listActiveTraderOrganizations: unused, listBidTraderAccess: unused, grantBidTraderAccess: unused, revokeBidTraderAccess: unused, listQuotesForBuyers: unused, awardBid: unused, listTraderBids, listMyQuotes, submitQuoteResponse, giveUpQuoteResponse } as unknown as BiddingClient;
  return { client, listTraderBids, listMyQuotes, submitQuoteResponse, giveUpQuoteResponse, unused };
}

describe('TRADER workspace', () => {
  it('has no date selector and reloads the authoritative feeds at Seoul date rollover', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T14:59:59.900Z'));
    const { client, listTraderBids, listMyQuotes } = clientWith();
    const view = render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByLabelText('Operational date')).not.toBeInTheDocument();
    expect(listTraderBids).toHaveBeenCalledOnce();
    expect(listMyQuotes).toHaveBeenCalledOnce();
    await act(async () => { vi.advanceTimersByTime(150); await Promise.resolve(); await Promise.resolve(); });
    expect(listTraderBids).toHaveBeenCalledTimes(2);
    expect(listMyQuotes).toHaveBeenCalledTimes(2);
    expect(screen.getByText('2026-08-31')).toBeInTheDocument();
    view.unmount();
    vi.useRealTimers();
  });

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
    const { client, submitQuoteResponse } = clientWith();
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Submit price' });
    fireEvent.change(screen.getByLabelText('lsmgo unit price'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('vlsfo unit price'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Barge fee'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit price' }));
    await waitFor(() => expect(submitQuoteResponse).toHaveBeenCalledOnce());
    expect(submitQuoteResponse).toHaveBeenCalledWith(membership, bidId, 1, null, { fuelGrades: ['lsmgo', 'vlsfo'], unitPrices: [3, 2], bargeFee: 5 });
    expect(Object.keys(submitQuoteResponse.mock.calls[0]![4])).toEqual(['fuelGrades', 'unitPrices', 'bargeFee']);
  });

  it('makes an open bid without an own quote explicit while retaining quote entry', async () => {
    const { client } = clientWith();
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);

    const ownQuoteState = await screen.findByRole('region', { name: 'Own response state' });
    expect(ownQuoteState).toHaveTextContent('Awaiting your response');
    expect(ownQuoteState).toHaveTextContent('Submit prices or give up while this bid remains open.');
    expect(screen.getByRole('heading', { name: 'Submit price' })).toBeInTheDocument();
    const totals = screen.getByLabelText('Quote totals');
    expect(within(totals).getByText('Authoritative server total').closest('div')).toHaveTextContent('Not submitted');
    expect(within(totals).getByText('Authoritative server total').closest('div')).toHaveTextContent('The server returns this value after your quote is saved.');
  });

  it('uses a target-bound confirmation for GIVE UP and sends only the own response revision', async () => {
    const { client, giveUpQuoteResponse } = clientWith([traderBid({ response_revision: 6 })]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await screen.findByRole('button', { name: 'GIVE UP' });
    fireEvent.click(screen.getByRole('button', { name: 'GIVE UP' }));
    expect(screen.getByRole('button', { name: 'Confirm GIVE UP' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm GIVE UP' }));
    await waitFor(() => expect(giveUpQuoteResponse).toHaveBeenCalledWith(membership, bidId, 6));
  });

  it('renders retained values as a resumable gave-up response without competitor state', async () => {
    const { client } = clientWith([traderBid({ response_status: 'gave_up', response_revision: 5 })], [quote({ response_status: 'gave_up' })]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    expect(await screen.findByText('Gave up')).toBeInTheDocument();
    expect(screen.getByText('No current price offer is active.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume / Submit price' })).toBeInTheDocument();
    expect(screen.queryByText(/competitor/i)).not.toBeInTheDocument();
  });

  it('shows requested fuel quantities beside their matching unit-price inputs', async () => {
    const { client } = clientWith();
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Submit price' });
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
    const { client, listTraderBids, listMyQuotes, submitQuoteResponse } = clientWith([traderBid({ response_status: 'quoted', response_revision: 4 })], [initial]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await screen.findByDisplayValue('3');
    listTraderBids.mockResolvedValueOnce(ok([traderBid({ response_status: 'quoted', response_revision: 4 })]));
    listMyQuotes.mockResolvedValueOnce(ok([refreshed]));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByDisplayValue('9');
    expect(screen.getByLabelText('vlsfo unit price')).toHaveValue(8);
    expect(screen.getByLabelText('Barge fee')).toHaveValue(7);
    expect(screen.queryByDisplayValue('3')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Update price' }));
    await waitFor(() => expect(submitQuoteResponse).toHaveBeenCalledWith(membership, bidId, 4, 8, { fuelGrades: ['lsmgo', 'vlsfo'], unitPrices: [9, 8], bargeFee: 7 }));
    expect(submitQuoteResponse.mock.calls[0]).toEqual([membership, bidId, 4, 8, { fuelGrades: ['lsmgo', 'vlsfo'], unitPrices: [9, 8], bargeFee: 7 }]);
    expect(Object.keys(submitQuoteResponse.mock.calls[0]![4])).toEqual(['fuelGrades', 'unitPrices', 'bargeFee']);
  });

  it.each(['40001', '55000', 'P0002'])('does not retry a %s quote-state error and reloads both authoritative feeds once', async (code) => {
    const initial = quote({ revision: 7 }); const refreshed = quote({ revision: 8, fuel_prices: [{ fuel_grade: 'lsmgo', unit_price: 6 }, { fuel_grade: 'vlsfo', unit_price: 4 }], barge_fee: 9 });
    const { client, listTraderBids, listMyQuotes, submitQuoteResponse } = clientWith([traderBid({ response_status: 'quoted', response_revision: 4 })], [initial]);
    const error: WorkflowError = { kind: code === '40001' ? 'conflict' : code === '55000' ? 'lifecycle' : 'not_found', code, message: 'Safe state error' };
    submitQuoteResponse.mockResolvedValueOnce({ data: null, error });
    listTraderBids.mockResolvedValueOnce(ok([traderBid({ response_status: 'quoted', response_revision: 4 })])).mockResolvedValueOnce(ok([traderBid({ response_status: 'quoted', response_revision: 4 })]));
    listMyQuotes.mockResolvedValueOnce(ok([initial])).mockResolvedValueOnce(ok([refreshed]));
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await screen.findByRole('button', { name: 'Update price' });
    fireEvent.click(screen.getByRole('button', { name: 'Update price' }));
    await screen.findByRole('alert');
    expect(submitQuoteResponse).toHaveBeenCalledOnce();
    expect(listTraderBids).toHaveBeenCalledTimes(2);
    expect(listMyQuotes).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('lsmgo unit price')).toHaveValue(6);
    expect(screen.getByLabelText('Barge fee')).toHaveValue(9);
  });

  it('clears TRADER data and invalidates access on 42501 without an older reload repopulating it', async () => {
    const onAuthorizationFailure = vi.fn(); const { client, submitQuoteResponse } = clientWith([traderBid({ response_status: 'quoted', response_revision: 4 })], [quote()]);
    submitQuoteResponse.mockResolvedValueOnce({ data: null, error: { kind: 'authorization', code: '42501', message: 'changed' } });
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={onAuthorizationFailure} />);
    await screen.findByRole('button', { name: 'Update price' });
    fireEvent.click(screen.getByRole('button', { name: 'Update price' }));
    await waitFor(() => expect(onAuthorizationFailure).toHaveBeenCalledOnce());
    expect(screen.queryByText('MV Trader')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update price' })).not.toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: 'Update price' })).not.toBeInTheDocument();
  });

  it('renders required TRADER operational data without competitor data', async () => {
    const { client } = clientWith([traderBid({ deadline_at: '2099-08-03T03:00:00.000Z' })], [quote()]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    const requirements = await screen.findByRole('region', { name: 'Bid requirements for MV Trader' });
    expect(screen.getByText('Effective status')).toBeInTheDocument();
    expect(screen.getByText('Response revision')).toBeInTheDocument();
    expect(within(requirements).getByText('Deadline')).toBeInTheDocument();
    expect(within(requirements).getByText('Remaining time')).toBeInTheDocument();
    expect(within(requirements).getByText(/remaining$/)).toBeInTheDocument();
    expect(within(requirements).getByText('Client clock, advisory only')).toBeInTheDocument();
    expect(within(requirements).getByText('Delivery window')).toBeInTheDocument();
    expect(within(requirements).getByText('LSMGO')).toBeInTheDocument();
    expect(within(requirements).getByText('20 MT requested')).toBeInTheDocument();
    expect(within(requirements).getByText('VLSFO')).toBeInTheDocument();
    expect(within(requirements).getByText('10 MT requested')).toBeInTheDocument();
    expect(screen.queryByText('Competitor')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Buyer quote comparison' })).not.toBeInTheDocument();
    expect(screen.queryByText('Rank')).not.toBeInTheDocument();
  });

  it('does not let an expired client countdown override server-open quote editability', async () => {
    const { client } = clientWith([traderBid({ deadline_at: '2020-01-01T00:00:00.000Z', effective_status: 'open' })]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);

    await screen.findByText('Expired');
    expect(screen.getByText('Effective status')).toBeInTheDocument();
    expect(screen.getByText('open', { selector: '.status-badge' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('lsmgo unit price'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('vlsfo unit price'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Barge fee'), { target: { value: '5' } });
    expect(screen.getByRole('button', { name: 'Submit price' })).toBeEnabled();
  });

  it('renders a closed own quote as read-only with its authoritative values', async () => {
    const { client } = clientWith([traderBid({ raw_status: 'closed', effective_status: 'closed', closed_at: now })], [quote()]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await screen.findByText('Quote submission is closed.');
    expect(screen.getByRole('status')).toHaveTextContent('Quote submission is closed.');
    expect(screen.getByRole('status')).toHaveClass('result-terminal');
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
    expect(screen.queryByRole('button', { name: 'Submit price' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update price' })).not.toBeInTheDocument();
  });

  it.each([[true, 'Selected. Your organization’s quote was selected.'], [false, 'Not selected. The award process is complete.']])('renders an awarded own quote as %s read-only', async (isAwarded, message) => {
    const { client } = clientWith([traderBid({ raw_status: 'awarded', effective_status: 'awarded', closed_at: now })], [quote({ is_awarded: isAwarded })]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await screen.findByText(message);
    expect(screen.getByRole('status')).toHaveTextContent(message);
    expect(screen.getByRole('status')).toHaveClass(isAwarded ? 'result-selected' : 'result-not-selected');
    expect(screen.getByRole('region', { name: 'Your quote summary' })).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit price' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update price' })).not.toBeInTheDocument();
  });

  it('keeps a terminal bid without an own quote neutral and free of competitor data', async () => {
    const { client } = clientWith([traderBid({ raw_status: 'awarded', effective_status: 'awarded', closed_at: now })]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    await screen.findByText('The award process is complete.');
    expect(screen.getByRole('status')).toHaveTextContent('The award process is complete.');
    expect(screen.getByRole('region', { name: 'Own response state' })).toHaveTextContent('Awaiting your response');
    expect(screen.queryByRole('region', { name: 'Your quote summary' })).not.toBeInTheDocument();
    expect(screen.queryByText(/selected organization|competitor/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('distinguishes open, own-quoted, and accessible counts from the authoritative feeds', async () => {
    const { client } = clientWith([
      traderBid({ response_status: 'quoted', response_revision: 2 }),
      traderBid({ id: '10000000-0000-4000-8000-000000000004', vessel_voyage: 'MV Terminal', raw_status: 'awarded', effective_status: 'awarded', closed_at: now }),
      traderBid({ id: '10000000-0000-4000-8000-000000000005', vessel_voyage: 'MV Open' }),
    ], [quote()]);
    render(<TraderWorkspace client={client} membershipId={membership} onAuthorizationFailure={vi.fn()} />);
    const summary = (await screen.findByRole('heading', { name: 'Quote workspace' })).closest('section');
    expect(summary).toHaveTextContent('2 open for quoting');
    expect(summary).toHaveTextContent('1 active quote');
    expect(summary).toHaveTextContent('3 accessible bids');
  });
});
