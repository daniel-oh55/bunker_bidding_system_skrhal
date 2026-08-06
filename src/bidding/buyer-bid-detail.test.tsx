import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BuyerBidDetail } from './buyer-bid-detail';
import type { BiddingClient } from './bidding-client';
import type { Bid, BidAuditEvent, Quote } from './types';

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

function renderDetail(current = bid(), audit: BidAuditEvent[] = [], quotes: Quote[] = []) {
  return render(<BuyerBidDetail bid={current} buyers={buyers} organizations={[]} detail={{ access: [], quotes, audit }} pending={false} client={client} membershipId={currentBuyerId} mutate={vi.fn()} refresh={vi.fn()} />);
}

describe('BUYER bid detail organization', () => {
  it('preserves the required overview and exposes four named native disclosure sections', () => {
    renderDetail(bid({ awarded_trader_organization_label: 'Awarded Trader', awarded_total_amount: 102 }));
    expect(screen.getByRole('heading', { name: 'MV Detail' })).toBeInTheDocument();
    const overview = document.querySelector('.bid-overview');
    for (const label of ['Port', 'Delivery window', 'Raw status', 'Effective status', 'Deadline', 'Creator', 'Responsible BUYER', 'Fuel requested', 'Revision', 'Awarded organization', 'Awarded total']) expect(overview).toHaveTextContent(label);
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
});
