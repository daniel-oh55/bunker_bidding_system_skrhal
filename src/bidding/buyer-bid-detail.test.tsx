import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BuyerBidDetail } from './buyer-bid-detail';
import type { BiddingClient } from './bidding-client';
import type { Bid, BidAuditEvent, BidTraderAccess, Quote } from './types';

const currentBuyerId = '10000000-0000-4000-8000-000000000001';
const responsibleBuyerId = '10000000-0000-4000-8000-000000000002';
const inactiveBuyerId = '10000000-0000-4000-8000-000000000099';
const bidId = '10000000-0000-4000-8000-000000000003';
const now = '2026-08-03T03:00:00.000Z';
const buyers = [
  { user_id: currentBuyerId, display_label: 'Current BUYER', active_buyer_membership_count: 1 },
  { user_id: responsibleBuyerId, display_label: 'Responsible BUYER', active_buyer_membership_count: 1 },
];
const bid = (overrides: Partial<Bid> = {}): Bid => ({
  id: bidId, vessel_voyage: 'MV Detail', port_name: 'Busan', delivery_window: 'Tomorrow', deadline_at: now,
  raw_status: 'open', effective_status: 'open', revision: 3, created_by: currentBuyerId, created_by_label: 'Creator',
  responsible_buyer_user_id: responsibleBuyerId, responsible_buyer_label: 'Responsible BUYER', fuel_items: [{ fuel_grade: 'vlsfo', quantity_mt: 10 }],
  created_at: now, updated_at: now, closed_at: null, cancelled_at: null, awarded_quote_id: null,
  awarded_trader_organization_id: null, awarded_trader_organization_label: null, awarded_total_amount: null, awarded_at: null, ...overrides,
});
const quote = (): Quote => ({
  id: '10000000-0000-4000-8000-000000000004', bid_id: bidId, trader_organization_id: '20000000-0000-4000-8000-000000000001', trader_organization_label: 'Trader A',
  revision: 1, created_by: currentBuyerId, fuel_prices: [{ fuel_grade: 'vlsfo', unit_price: 10 }], barge_fee: 2, total_amount: 102,
  created_at: now, updated_at: now, access_active: true, organization_active: true, eligible_for_award: true, is_awarded: false,
});
const client = {} as BiddingClient;
const access = (organizationId = '20000000-0000-4000-8000-000000000001', label = 'Trader A'): BidTraderAccess => ({
  bid_id: bidId, trader_organization_id: organizationId, trader_organization_label: label, granted_at: now,
  granted_by_user_id: currentBuyerId, granted_by_membership_id: currentBuyerId,
});

function renderDetail(current = bid(), audit: BidAuditEvent[] = [], quotes: Quote[] = [], accesses: BidTraderAccess[] = [], overrides: Partial<ComponentProps<typeof BuyerBidDetail>> = {}) {
  return render(<BuyerBidDetail bid={current} buyers={buyers} organizations={[]} detail={{ access: accesses, quotes, audit }} pending={false} client={client} membershipId={currentBuyerId} mutate={vi.fn()} refresh={vi.fn()} {...overrides} />);
}

describe('BUYER bid detail organization', () => {
  it('preserves the required overview and exposes four named native disclosure sections', () => {
    renderDetail(bid({ awarded_trader_organization_label: 'Awarded Trader', awarded_total_amount: 102 }));
    expect(screen.getByRole('heading', { name: 'MV Detail' })).toBeInTheDocument();
    const overview = document.querySelector('.bid-overview');
    for (const label of ['Port', 'Delivery window', 'Raw status', 'Effective status', 'Deadline', 'Creator', 'Responsible BUYER', 'Fuel requested', 'Revision', 'Awarded organization', 'Awarded total']) expect(overview).toHaveTextContent(label);
    expect(screen.getByText('Effective status: open')).toHaveClass('status-badge');
    expect([...document.querySelectorAll('details > summary')].map((summary) => summary.textContent)).toEqual([
      'Bid terms & deadline', 'Responsibility & lifecycle', 'TRADER access & quotes', 'Audit history',
    ]);
  });

  it.each([
    ['open', bid(), [true, false, false, false]],
    ['closed', bid({ raw_status: 'closed', effective_status: 'closed' }), [false, false, true, false]],
    ['awarded', bid({ raw_status: 'awarded', effective_status: 'awarded' }), [false, false, true, false]],
    ['cancelled', bid({ raw_status: 'cancelled', effective_status: 'cancelled' }), [false, false, false, false]],
  ])('uses the expected default-open sections for a %s bid', (_state, currentBid, expected) => {
    renderDetail(currentBid);
    expect([...document.querySelectorAll('details')].map((section) => section.open)).toEqual(expected);
  });

  it('keeps lifecycle, TRADER scope, and award controls available in their existing states', () => {
    renderDetail(bid(), [], [quote()]);
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
    expect(screen.getByLabelText('Grant TRADER organization')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Award' }));
    expect(screen.getByRole('button', { name: 'Confirm award' })).toBeInTheDocument();
  });

  it('keeps close and award mutations bound to the current bid and reviewed quote arguments', () => {
    const closeBid = vi.fn().mockResolvedValue({ data: bid(), error: null });
    const closeMutate = vi.fn((operation: () => Promise<unknown>) => operation().then(() => true));
    const openView = renderDetail(bid(), [], [], [], { client: { closeBid } as unknown as BiddingClient, mutate: closeMutate });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(closeBid).toHaveBeenCalledWith(currentBuyerId, bidId, 3);
    openView.unmount();

    const reviewedQuote = quote();
    const awardBid = vi.fn().mockResolvedValue({ data: bid(), error: null });
    const awardMutate = vi.fn((operation: () => Promise<unknown>) => operation().then(() => true));
    renderDetail(bid({ raw_status: 'closed', effective_status: 'closed' }), [], [reviewedQuote], [], { client: { awardBid } as unknown as BiddingClient, mutate: awardMutate });
    fireEvent.click(screen.getByRole('button', { name: 'Award' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm award' }));
    expect(awardBid).toHaveBeenCalledWith(currentBuyerId, bidId, 3, reviewedQuote.id, reviewedQuote.revision);
  });

  it('renders active BUYER labels and hides full UUIDs for unavailable audit responsibility transitions', () => {
    const audit = [
      { id: '10000000-0000-4000-8000-000000000005', bid_id: bidId, event_type: 'responsible_buyer_changed', actor_user_id: currentBuyerId, actor_membership_id: currentBuyerId, actor_organization_id: currentBuyerId, actor_role: 'buyer_operator' as const, occurred_at: now, prior_revision: 2, resulting_revision: 3, prior_status: 'open' as const, resulting_status: 'open' as const, prior_responsible_buyer_user_id: currentBuyerId, resulting_responsible_buyer_user_id: responsibleBuyerId, before_snapshot: {}, after_snapshot: {} },
      { id: '10000000-0000-4000-8000-000000000006', bid_id: bidId, event_type: 'responsible_buyer_changed', actor_user_id: currentBuyerId, actor_membership_id: currentBuyerId, actor_organization_id: currentBuyerId, actor_role: 'buyer_operator' as const, occurred_at: now, prior_revision: 3, resulting_revision: 4, prior_status: 'open' as const, resulting_status: 'open' as const, prior_responsible_buyer_user_id: inactiveBuyerId, resulting_responsible_buyer_user_id: responsibleBuyerId, before_snapshot: {}, after_snapshot: {} },
    ];
    renderDetail(bid(), audit);
    expect(screen.getByText(/Current BUYER to Responsible BUYER/)).toBeInTheDocument();
    expect(screen.getByText(/Unknown or inactive BUYER · …0099 to Responsible BUYER/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(inactiveBuyerId);
    expect(document.body.textContent).not.toContain(currentBuyerId);
    expect(document.body.textContent).not.toContain(responsibleBuyerId);
  });

  it('requires a target-bound confirmation before revoking TRADER access', () => {
    const revoke = vi.fn().mockResolvedValue({ data: bid(), error: null });
    const mutate = vi.fn((operation: () => Promise<unknown>) => operation().then(() => true));
    renderDetail(bid(), [], [], [access()], { client: { revokeBidTraderAccess: revoke } as unknown as BiddingClient, mutate });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Revoke access for Trader A?');
    expect(mutate).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('clears the confirmation without mutation when BUYER keeps access', () => {
    const revoke = vi.fn();
    const mutate = vi.fn();
    renderDetail(bid(), [], [], [access()], { client: { revokeBidTraderAccess: revoke } as unknown as BiddingClient, mutate });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep access' }));
    expect(screen.queryByRole('button', { name: 'Confirm revoke' })).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('confirms exactly one revoke with the current server mutation arguments', () => {
    const revoke = vi.fn().mockResolvedValue({ data: bid(), error: null });
    const mutate = vi.fn((operation: () => Promise<unknown>) => operation().then(() => true));
    renderDetail(bid(), [], [], [access()], { client: { revokeBidTraderAccess: revoke } as unknown as BiddingClient, mutate });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(currentBuyerId, bidId, 3, '20000000-0000-4000-8000-000000000001');
  });

  it('shows the award-result warning only for the selected awarded TRADER organization', () => {
    const selected = access('20000000-0000-4000-8000-000000000001', 'Selected Trader');
    const other = access('20000000-0000-4000-8000-000000000002', 'Other Trader');
    const awarded = bid({ raw_status: 'awarded', effective_status: 'awarded', awarded_trader_organization_id: selected.trader_organization_id });
    renderDetail(awarded, [], [], [selected, other]);
    const revokeButtons = screen.getAllByRole('button', { name: 'Revoke' });
    expect(revokeButtons).toHaveLength(2);
    fireEvent.click(revokeButtons[0]!);
    expect(screen.getByText(/selected TRADER organization/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[1]!);
    expect(screen.getByRole('alert')).toHaveTextContent('Other Trader');
    expect(screen.queryByText(/selected TRADER organization/)).not.toBeInTheDocument();
  });

  it('replaces the pending target and invalidates it on revision, access, or bid changes', () => {
    const revoke = vi.fn();
    const mutate = vi.fn();
    const first = access();
    const second = access('20000000-0000-4000-8000-000000000002', 'Trader B');
    const props = { client: { revokeBidTraderAccess: revoke } as unknown as BiddingClient, mutate };
    const view = renderDetail(bid(), [], [], [first, second], props);
    const revokeButtons = screen.getAllByRole('button', { name: 'Revoke' });
    expect(revokeButtons).toHaveLength(2);
    fireEvent.click(revokeButtons[0]!);
    fireEvent.click(revokeButtons[1]!);
    expect(screen.getByRole('alert')).toHaveTextContent('Trader B');
    view.rerender(<BuyerBidDetail bid={bid({ revision: 4 })} buyers={buyers} organizations={[]} detail={{ access: [first, second], quotes: [], audit: [] }} pending={false} membershipId={currentBuyerId} refresh={vi.fn()} {...props} />);
    expect(screen.queryByRole('button', { name: 'Confirm revoke' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0]!);
    view.rerender(<BuyerBidDetail bid={bid({ revision: 4 })} buyers={buyers} organizations={[]} detail={{ access: [{ ...first, granted_at: '2026-08-04T03:00:00.000Z' }, second], quotes: [], audit: [] }} pending={false} membershipId={currentBuyerId} refresh={vi.fn()} {...props} />);
    expect(screen.queryByRole('button', { name: 'Confirm revoke' })).not.toBeInTheDocument();
    view.rerender(<BuyerBidDetail bid={bid({ id: '10000000-0000-4000-8000-000000000007' })} buyers={buyers} organizations={[]} detail={{ access: [first], quotes: [], audit: [] }} pending={false} membershipId={currentBuyerId} refresh={vi.fn()} {...props} />);
    expect(screen.queryByRole('button', { name: 'Confirm revoke' })).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('clears confirmation before refresh and prevents duplicate submission while pending', () => {
    const refresh = vi.fn();
    const view = renderDetail(bid(), [], [], [access()], { refresh });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh detail' }));
    expect(screen.queryByRole('button', { name: 'Confirm revoke' })).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    view.rerender(<BuyerBidDetail bid={bid()} buyers={buyers} organizations={[]} detail={{ access: [access()], quotes: [], audit: [] }} pending client={client} membershipId={currentBuyerId} mutate={vi.fn()} refresh={refresh} />);
    expect(screen.getByRole('button', { name: 'Confirm revoke' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep access' })).toBeDisabled();
  });
});
