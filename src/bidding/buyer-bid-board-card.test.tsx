import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BuyerBidBoardCard } from './buyer-bid-board-card';
import type { Bid, Quote } from './types';

const now = '2026-08-26T03:00:00.000Z';
const bidId = '10000000-0000-4000-8000-000000000001';
const bid = (overrides: Partial<Bid> = {}): Bid => ({
  id: bidId, vessel_voyage: 'MV Synthetic 01 / V001', port_name: 'Test Port', delivery_window: '1–2 September', deadline_at: '2099-08-26T03:00:00.000Z',
  raw_status: 'open', effective_status: 'open', revision: 2, created_by: '10000000-0000-4000-8000-000000000002', created_by_label: 'Buyer Creator',
  responsible_buyer_user_id: '10000000-0000-4000-8000-000000000003', responsible_buyer_label: 'Buyer Operator', fuel_items: [{ fuel_grade: 'vlsfo', quantity_mt: 10 }],
  created_at: now, updated_at: now, closed_at: null, cancelled_at: null, awarded_quote_id: null, awarded_trader_organization_id: null,
  awarded_trader_organization_label: null, awarded_total_amount: null, awarded_at: null, ...overrides,
});
const quote = (name: string, total: number, overrides: Partial<Quote> = {}): Quote => ({
  id: `20000000-0000-4000-8000-${String(Math.round(total * 100) + name.length).padStart(12, '0')}`, bid_id: bidId, trader_organization_id: `30000000-0000-4000-8000-${String(Math.round(total * 100) + name.length).padStart(12, '0')}`,
  trader_organization_label: name, revision: 1, created_by: '10000000-0000-4000-8000-000000000004', fuel_prices: [{ fuel_grade: 'vlsfo', unit_price: 100 }],
  barge_fee: 7, total_amount: total, created_at: now, updated_at: now, access_active: true, organization_active: true, eligible_for_award: true, is_awarded: false, ...overrides,
});
const renderCard = (currentBid = bid(), quotes: Quote[] = [], onManage = vi.fn()) => {
  render(<BuyerBidBoardCard bid={currentBid} quoteState={{ status: 'success', quotes }} currentTimeMs={Date.parse(now)} selected={false} onManage={onManage} />);
  return { card: screen.getByRole('article', { name: currentBid.vessel_voyage }), onManage };
};

describe('BuyerBidBoardCard', () => {
  it('renders the operational bid summary and BUYER-visible quote table in one semantic card', () => {
    const { card, onManage } = renderCard(bid(), [quote('Synthetic Trader', 1007)]);
    expect(within(card).getByText('Test Port')).toBeInTheDocument();
    expect(within(card).getByText('1–2 September')).toBeInTheDocument();
    expect(within(card).getByText('Buyer Operator')).toBeInTheDocument();
    expect(within(card).getByText('VLSFO')).toBeInTheDocument();
    expect(within(card).getByRole('table')).toBeInTheDocument();
    expect(within(card).getByRole('region', { name: /Scrollable quote table/ })).toHaveAttribute('tabindex', '0');
    fireEvent.click(within(card).getByRole('button', { name: 'Manage bid' }));
    expect(onManage).toHaveBeenCalledOnce();
  });

  it('follows the bid fuel-item order for dynamic unit-price columns', () => {
    const currentBid = bid({ fuel_items: [{ fuel_grade: 'ulsfo', quantity_mt: 5 }, { fuel_grade: 'hsfo', quantity_mt: 8 }, { fuel_grade: 'lsfo', quantity_mt: 3 }] });
    const prices = [{ fuel_grade: 'hsfo' as const, unit_price: 80 }, { fuel_grade: 'lsfo' as const, unit_price: 90 }, { fuel_grade: 'ulsfo' as const, unit_price: 70 }];
    const { card } = renderCard(currentBid, [quote('Dynamic Trader', 999, { fuel_prices: prices })]);
    expect(within(card).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Rank', 'TRADER organization', 'ULSFO ($/MT)', 'HSFO ($/MT)', 'LSFO ($/MT)', 'Barge fee ($)', 'Authoritative total ($)',
    ]);
  });

  it('displays server total_amount without treating a browser recomputation as authoritative', () => {
    const { card } = renderCard(bid(), [quote('Server Total Trader', 9876)]);
    const row = within(card).getByRole('rowheader', { name: /Server Total Trader/ }).closest('tr')!;
    expect(within(row).getByText('$9,876')).toBeInTheDocument();
    expect(within(row).getByText('Server total')).toBeInTheDocument();
    expect(within(row).queryByText('$1,007')).not.toBeInTheDocument();
  });

  it('ignores a lower ineligible quote when deriving the advisory lowest eligible offer', () => {
    const quotes = [
      quote('Ineligible Low', 50, { access_active: false, eligible_for_award: false }),
      quote('Eligible Low', 100),
      quote('Eligible Second', 125),
    ];
    const { card } = renderCard(bid(), quotes);
    const result = within(card).getByText(/Lowest eligible offer/).closest('.buyer-board-result')!;
    expect(result).toHaveTextContent('Eligible Low · $100');
    expect(result).toHaveTextContent('Gap to second eligible: $25 (25%)');
    expect(result).not.toHaveTextContent('Ineligible Low · $50');
    expect(within(card).getByRole('rowheader', { name: /Ineligible Low/ })).toHaveTextContent('Access inactive · Ineligible for award');
  });

  it.each([
    { quotes: [] as Quote[], expected: null },
    { quotes: [quote('Only Eligible', 100)], expected: 'Gap to second eligible: — (fewer than two eligible quotes)' },
    { quotes: [quote('First Eligible', 100), quote('Second Eligible', 100)], expected: 'Gap to second eligible: $0 (0%)' },
  ])('handles advisory gap presentation for $quotes.length eligible quotes', ({ quotes, expected }) => {
    const { card } = renderCard(bid(), quotes);
    if (expected === null) expect(within(card).queryByText(/Gap to second eligible/)).not.toBeInTheDocument();
    else expect(within(card).getByText(expected)).toBeInTheDocument();
  });

  it('prioritizes the authoritative awarded result without describing it as the lowest offer', () => {
    const awarded = quote('Chosen Trader', 900, { is_awarded: true, eligible_for_award: false });
    const currentBid = bid({ raw_status: 'awarded', effective_status: 'awarded', closed_at: now, awarded_quote_id: awarded.id, awarded_trader_organization_id: awarded.trader_organization_id, awarded_trader_organization_label: 'Chosen Trader', awarded_total_amount: 900, awarded_at: now });
    const { card } = renderCard(currentBid, [quote('Cheaper Eligible Trader', 100), awarded]);
    const result = within(card).getByText(/Awarded result/).closest('.buyer-board-result')!;
    expect(result).toHaveTextContent('Chosen Trader · $900');
    expect(result).toHaveTextContent('not an automatic lowest-price selection');
    expect(within(card).queryByText(/Lowest eligible offer/)).not.toBeInTheDocument();
    expect(within(card).getByRole('rowheader', { name: /Chosen Trader/ }).closest('tr')).toHaveClass('is-awarded');
  });

  it('renders compact empty, loading, and isolated unavailable quote states', () => {
    const currentBid = bid();
    const { rerender } = render(<BuyerBidBoardCard bid={currentBid} quoteState={{ status: 'success', quotes: [] }} currentTimeMs={Date.parse(now)} selected={false} onManage={vi.fn()} />);
    expect(screen.getByText('No quotes received yet')).toBeInTheDocument();
    rerender(<BuyerBidBoardCard bid={currentBid} quoteState={{ status: 'loading' }} currentTimeMs={Date.parse(now)} selected={false} onManage={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading quotes');
    rerender(<BuyerBidBoardCard bid={currentBid} quoteState={{ status: 'error' }} currentTimeMs={Date.parse(now)} selected onManage={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Quotes temporarily unavailable');
    expect(screen.getByRole('button', { name: 'Managing bid' })).toHaveAttribute('aria-pressed', 'true');
  });
});
