import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BuyerBidBoardCard } from './buyer-bid-board-card';
import type { Bid, BuyerSellerComparison, Quote } from './types';

const now = '2026-08-26T03:00:00.000Z';
const bidId = '10000000-0000-4000-8000-000000000001';
const bid = (overrides: Partial<Bid> = {}): Bid => ({
  bid_date: '2026-08-26',
  id: bidId, vessel_voyage: 'MV Synthetic 01 / V001', port_name: 'Test Port', delivery_window: '1–2 September', deadline_at: '2099-08-26T03:00:00.000Z',
  raw_status: 'open', effective_status: 'open', revision: 2, created_by: '10000000-0000-4000-8000-000000000002', created_by_label: 'Buyer Creator',
  responsible_buyer_user_id: '10000000-0000-4000-8000-000000000003', responsible_buyer_label: 'Buyer Operator', fuel_items: [{ fuel_grade: 'vlsfo', quantity_mt: 10 }],
  created_at: now, updated_at: now, closed_at: null, cancelled_at: null, awarded_quote_id: null, awarded_trader_organization_id: null,
  awarded_trader_organization_label: null, awarded_total_amount: null, awarded_at: null, ...overrides,
});
const quote = (name: string, total: number, overrides: Partial<Quote> = {}): Quote => ({
  id: `20000000-0000-4000-8000-${String(Math.round(total * 100) + name.length).padStart(12, '0')}`, bid_id: bidId, trader_organization_id: `30000000-0000-4000-8000-${String(Math.round(total * 100) + name.length).padStart(12, '0')}`,
  trader_organization_label: name, revision: 1, created_by: '10000000-0000-4000-8000-000000000004', fuel_prices: [{ fuel_grade: 'vlsfo', unit_price: 100 }],
  barge_fee: 7, total_amount: total, created_at: now, updated_at: now, access_active: true, organization_active: true, eligible_for_award: true, is_awarded: false, ...overrides, response_status: overrides.response_status ?? 'quoted',
});
const comparison = (currentQuote: Quote): BuyerSellerComparison => ({
  bid_id: currentQuote.bid_id,
  trader_organization_id: currentQuote.trader_organization_id,
  trader_organization_label: currentQuote.trader_organization_label,
  access_active: currentQuote.access_active,
  organization_active: currentQuote.organization_active,
  response_status: currentQuote.response_status,
  quote: currentQuote,
});
const awaiting = (name: string, suffix: string, overrides: Partial<BuyerSellerComparison> = {}): BuyerSellerComparison => ({
  bid_id: bidId,
  trader_organization_id: `30000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
  trader_organization_label: name,
  access_active: true,
  organization_active: true,
  quote: null,
  ...overrides, response_status: overrides.response_status ?? 'awaiting',
});
const renderCard = (currentBid = bid(), quotes: Quote[] = [], onManage = vi.fn()) => {
  render(<BuyerBidBoardCard bid={currentBid} sellerState={{ status: 'success', sellers: quotes.map(comparison) }} currentTimeMs={Date.parse(now)} selected={false} onManage={onManage} />);
  return { card: screen.getByRole('article', { name: currentBid.vessel_voyage }), onManage };
};
const renderSellers = (currentBid: Bid, sellers: BuyerSellerComparison[]) => {
  render(<BuyerBidBoardCard bid={currentBid} sellerState={{ status: 'success', sellers }} currentTimeMs={Date.parse(now)} selected={false} onManage={vi.fn()} />);
  return screen.getByRole('article', { name: currentBid.vessel_voyage });
};

describe('BuyerBidBoardCard', () => {
  it('renders the operational bid summary and BUYER-visible quote table in one semantic card', () => {
    const { card, onManage } = renderCard(bid(), [quote('Synthetic Trader', 1007)]);
    expect(within(card).getByText('Test Port')).toBeInTheDocument();
    expect(within(card).getByText('1–2 September')).toBeInTheDocument();
    expect(within(card).getByText('Buyer Operator')).toBeInTheDocument();
    expect(within(card).getByText('VLSFO')).toBeInTheDocument();
    expect(within(card).getByRole('table')).toBeInTheDocument();
    expect(within(card).getByRole('region', { name: /Scrollable SELLER comparison table/ })).toHaveAttribute('tabindex', '0');
    fireEvent.click(within(card).getByRole('button', { name: 'Manage bid' }));
    expect(onManage).toHaveBeenCalledOnce();
  });

  it('follows the bid fuel-item order for dynamic unit-price columns', () => {
    const currentBid = bid({ fuel_items: [{ fuel_grade: 'ulsfo', quantity_mt: 5 }, { fuel_grade: 'hsfo', quantity_mt: 8 }, { fuel_grade: 'lsfo', quantity_mt: 3 }] });
    const prices = [{ fuel_grade: 'hsfo' as const, unit_price: 80 }, { fuel_grade: 'lsfo' as const, unit_price: 90 }, { fuel_grade: 'ulsfo' as const, unit_price: 70 }];
    const { card } = renderCard(currentBid, [quote('Dynamic Trader', 999, { fuel_prices: prices })]);
    expect(within(card).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Rank', 'SELLER', 'Status', 'ULSFO ($/MT)', 'HSFO ($/MT)', 'LSFO ($/MT)', 'Barge fee ($)', 'Authoritative total ($)',
    ]);
  });

  it('displays server total_amount without treating a browser recomputation as authoritative', () => {
    const { card } = renderCard(bid(), [quote('Server Total Trader', 9876)]);
    const row = within(card).getByRole('rowheader', { name: /Server Total Trader/ }).closest('tr')!;
    expect(within(row).getByText('$9,876')).toBeInTheDocument();
    expect(within(row).getByText('Server total')).toBeInTheDocument();
    expect(within(row).queryByText('$1,007')).not.toBeInTheDocument();
  });

  it('ranks active OPEN-bid quotes for current comparison without implying they can be awarded', () => {
    const quotes = [
      quote('Current Low', 100, { eligible_for_award: false }),
      quote('Current Second', 125, { eligible_for_award: false }),
    ];
    const { card } = renderCard(bid(), quotes);
    const lowRow = within(card).getByRole('rowheader', { name: /Current Low/ }).closest('tr')!;
    const secondRow = within(card).getByRole('rowheader', { name: /Current Second/ }).closest('tr')!;
    expect(within(lowRow).getByText('1')).toBeInTheDocument();
    expect(within(secondRow).getByText('2')).toBeInTheDocument();
    expect(lowRow).not.toHaveClass('is-comparison-excluded');
    expect(within(lowRow).getByRole('rowheader')).toHaveTextContent('Current comparison eligible · Award unavailable while bid is open');
    const result = within(card).getByText(/Lowest current offer/).closest('.buyer-board-result')!;
    expect(result).toHaveTextContent('comparison only');
    expect(result).toHaveTextContent('Current Low · $100');
    expect(result).toHaveTextContent('Gap to second current offer: $25 (25%)');
    expect(result).toHaveTextContent('Awards are unavailable while the bid is open.');
    expect(within(card).queryByText('Eligible for award')).not.toBeInTheDocument();
  });

  it('keeps cheaper inactive OPEN-bid quotes visible but excludes them from current comparison', () => {
    const quotes = [
      quote('Access Revoked Low', 50, { access_active: false, eligible_for_award: false }),
      quote('Organization Inactive Low', 75, { organization_active: false, eligible_for_award: false }),
      quote('Active Current Low', 100, { eligible_for_award: false }),
    ];
    const { card } = renderCard(bid(), quotes);
    const accessRow = within(card).getByRole('rowheader', { name: /Access Revoked Low/ }).closest('tr')!;
    const organizationRow = within(card).getByRole('rowheader', { name: /Organization Inactive Low/ }).closest('tr')!;
    const activeRow = within(card).getByRole('rowheader', { name: /Active Current Low/ }).closest('tr')!;
    expect(accessRow).toHaveClass('is-comparison-excluded');
    expect(organizationRow).toHaveClass('is-comparison-excluded');
    expect(within(accessRow).getByText('—')).toBeInTheDocument();
    expect(within(organizationRow).getByText('—')).toBeInTheDocument();
    expect(within(activeRow).getByText('1')).toBeInTheDocument();
    expect(within(accessRow).getByRole('rowheader')).toHaveTextContent('Access inactive · Excluded from current comparison');
    expect(within(organizationRow).getByRole('rowheader')).toHaveTextContent('Organization inactive · Excluded from current comparison');
    const result = within(card).getByText(/Lowest current offer/).closest('.buyer-board-result')!;
    expect(result).toHaveTextContent('Active Current Low · $100');
    expect(result).not.toHaveTextContent('Access Revoked Low · $50');
    expect(result).not.toHaveTextContent('Organization Inactive Low · $75');
  });

  it.each([
    { quotes: [] as Quote[], expected: null },
    { quotes: [quote('Only Current', 100, { eligible_for_award: false })], expected: 'Gap to second current offer: — (fewer than two comparison-eligible quotes)' },
    { quotes: [quote('First Current', 100, { eligible_for_award: false }), quote('Second Current', 100, { eligible_for_award: false })], expected: 'Gap to second current offer: $0 (0%)' },
  ])('preserves current-comparison gap presentation for $quotes.length OPEN-bid quotes', ({ quotes, expected }) => {
    const { card } = renderCard(bid(), quotes);
    if (expected === null) expect(within(card).queryByText(/Gap to second current offer/)).not.toBeInTheDocument();
    else expect(within(card).getByText(expected)).toBeInTheDocument();
  });

  it('uses server award eligibility for CLOSED-bid ranking and advisory comparison', () => {
    const currentBid = bid({ raw_status: 'closed', effective_status: 'closed', closed_at: now });
    const quotes = [
      quote('Ineligible Closed Low', 50, { eligible_for_award: false }),
      quote('Award Eligible Low', 100),
      quote('Award Eligible Second', 125),
    ];
    const { card } = renderCard(currentBid, quotes);
    const ineligibleRow = within(card).getByRole('rowheader', { name: /Ineligible Closed Low/ }).closest('tr')!;
    const eligibleRow = within(card).getByRole('rowheader', { name: /Award Eligible Low/ }).closest('tr')!;
    expect(ineligibleRow).toHaveClass('is-comparison-excluded');
    expect(within(ineligibleRow).getByText('—')).toBeInTheDocument();
    expect(within(eligibleRow).getByText('1')).toBeInTheDocument();
    const result = within(card).getByText(/Lowest award-eligible offer/).closest('.buyer-board-result')!;
    expect(result).toHaveTextContent('Award Eligible Low · $100');
    expect(result).toHaveTextContent('Gap to second award-eligible offer: $25 (25%)');
    expect(result).toHaveTextContent('Award actions remain exclusively in Manage bid.');
    expect(result).not.toHaveTextContent('Ineligible Closed Low · $50');
  });

  it('prioritizes the authoritative awarded result without describing it as the lowest offer', () => {
    const awarded = quote('Chosen Trader', 900, { is_awarded: true, eligible_for_award: false });
    const currentBid = bid({ raw_status: 'awarded', effective_status: 'awarded', closed_at: now, awarded_quote_id: awarded.id, awarded_trader_organization_id: awarded.trader_organization_id, awarded_trader_organization_label: 'Chosen Trader', awarded_total_amount: 900, awarded_at: now });
    const { card } = renderCard(currentBid, [quote('Cheaper Eligible Trader', 100), awarded]);
    const result = within(card).getByText(/Awarded result/).closest('.buyer-board-result')!;
    expect(result).toHaveTextContent('Chosen Trader · $900');
    expect(result).toHaveTextContent('not an automatic lowest-price selection');
    expect(within(card).queryByText(/Lowest .*offer/)).not.toBeInTheDocument();
    expect(within(card).getByRole('rowheader', { name: /Chosen Trader/ }).closest('tr')).toHaveClass('is-awarded');
    expect(within(within(card).getByRole('rowheader', { name: /Chosen Trader/ }).closest('tr')!).getAllByText('Awarded')).toHaveLength(2);
  });

  it('renders a scoped unquoted SELLER as Awaiting quote with no rank or commercial values', () => {
    const card = renderSellers(bid(), [awaiting('Waiting Seller', '71')]);
    const row = within(card).getByRole('rowheader', { name: /Waiting Seller/ }).closest('tr')!;
    expect(within(row).getByText('Awaiting quote')).toBeInTheDocument();
    expect(within(row).getAllByText('—')).toHaveLength(4);
    expect(row).toHaveClass('is-comparison-excluded');
    expect(within(card).getByText('No current comparison offers')).toBeInTheDocument();
    expect(within(card).getByText('1 SELLER · 0 quotes received')).toBeInTheDocument();
  });

  it('excludes awaiting rows from mixed ranking and the lowest-price result', () => {
    const quoted = quote('Quoted Seller', 100, { eligible_for_award: false });
    const card = renderSellers(bid(), [awaiting('Waiting Seller', '72'), comparison(quoted)]);
    const waitingRow = within(card).getByRole('rowheader', { name: /Waiting Seller/ }).closest('tr')!;
    const quotedRow = within(card).getByRole('rowheader', { name: /Quoted Seller/ }).closest('tr')!;
    expect(within(waitingRow).getAllByText('—')).toHaveLength(4);
    expect(within(quotedRow).getByText('1')).toBeInTheDocument();
    expect(within(quotedRow).getByText('Quoted')).toBeInTheDocument();
    expect(within(card).getByText(/Quoted Seller · \$100/)).toBeInTheDocument();
    expect(within(card).getByText('2 SELLERs · 1 quote received')).toBeInTheDocument();
  });

  it('keeps a gave-up quote as history while hiding its price and excluding it from rank', () => {
    const gaveUp = quote('Gave Up Seller', 50, { response_status: 'gave_up', eligible_for_award: false });
    const active = quote('Active Seller', 100, { eligible_for_award: false });
    const card = renderSellers(bid(), [comparison(gaveUp), comparison(active)]);
    const gaveUpRow = within(card).getByRole('rowheader', { name: /Gave Up Seller/ }).closest('tr')!;
    expect(within(gaveUpRow).getByText('Gave up')).toBeInTheDocument();
    expect(within(gaveUpRow).getAllByText('—')).toHaveLength(4);
    expect(gaveUpRow).toHaveClass('is-comparison-excluded');
    expect(within(card).getByText(/Active Seller · \$100/)).toBeInTheDocument();
    expect(within(card).queryByText(/Gave Up Seller · \$50/)).not.toBeInTheDocument();
  });

  it('shows inactive organization metadata for an awaiting participant', () => {
    const card = renderSellers(bid(), [awaiting('Inactive Waiting Seller', '73', { organization_active: false })]);
    expect(within(card).getByRole('rowheader', { name: /Inactive Waiting Seller/ })).toHaveTextContent('Organization inactive');
  });

  it('keeps CANCELLED-bid quote history visible without an award-candidate advisory result', () => {
    const currentBid = bid({ raw_status: 'cancelled', effective_status: 'cancelled', cancelled_at: now });
    const { card } = renderCard(currentBid, [quote('Historical Trader', 100)]);
    const row = within(card).getByRole('rowheader', { name: /Historical Trader/ }).closest('tr')!;
    expect(row).toHaveClass('is-comparison-excluded');
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).getByRole('rowheader')).toHaveTextContent('Historical quote · No award candidate');
    expect(within(card).queryByText(/Lowest|award-eligible offer|current offer/)).not.toBeInTheDocument();
    expect(card.querySelector('.buyer-board-result')).toBeNull();
  });

  it('renders compact empty, loading, and isolated unavailable quote states', () => {
    const currentBid = bid();
    const { rerender } = render(<BuyerBidBoardCard bid={currentBid} sellerState={{ status: 'success', sellers: [] }} currentTimeMs={Date.parse(now)} selected={false} onManage={vi.fn()} />);
    expect(screen.getByText('No SELLER participants')).toBeInTheDocument();
    expect(screen.getByText('0 SELLERs · 0 quotes received')).toBeInTheDocument();
    rerender(<BuyerBidBoardCard bid={currentBid} sellerState={{ status: 'loading' }} currentTimeMs={Date.parse(now)} selected={false} onManage={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading SELLER comparison');
    rerender(<BuyerBidBoardCard bid={currentBid} sellerState={{ status: 'error' }} currentTimeMs={Date.parse(now)} selected onManage={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('SELLER comparison temporarily unavailable');
    expect(screen.getByRole('button', { name: 'Managing bid' })).toHaveAttribute('aria-pressed', 'true');
  });
});
