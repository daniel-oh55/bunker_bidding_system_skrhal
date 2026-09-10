import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  it('uses history wording and ignores even supplied reorder controls in read-only mode', () => {
    const onManage = vi.fn(); const onDropBefore = vi.fn();
    const props = { bid: bid({ raw_status: 'awarded', effective_status: 'awarded' }), sellerState: { status: 'success' as const, sellers: [] }, currentTimeMs: Date.parse(now), selected: false, onManage, readOnly: true, reorder: { enabled: true, canMoveEarlier: true, canMoveLater: true, onMoveEarlier: vi.fn(), onMoveLater: vi.fn(), onDropBefore } };
    const { rerender } = render(<BuyerBidBoardCard {...props} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['View history']);
    fireEvent.click(screen.getByRole('button', { name: 'View history' }));
    expect(onManage).toHaveBeenCalledOnce();
    fireEvent.drop(screen.getByRole('article'), { dataTransfer: { getData: () => bidId } });
    expect(onDropBefore).not.toHaveBeenCalled();
    rerender(<BuyerBidBoardCard {...props} selected />);
    expect(screen.getByRole('button', { name: 'Viewing history' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('exposes non-gesture reorder controls without invoking Manage bid', () => {
    const onManage = vi.fn(); const onMoveEarlier = vi.fn(); const onMoveLater = vi.fn();
    render(<BuyerBidBoardCard bid={bid()} sellerState={{ status: 'success', sellers: [] }} currentTimeMs={Date.parse(now)} selected={false} onManage={onManage} reorder={{ enabled: true, canMoveEarlier: false, canMoveLater: true, onMoveEarlier, onMoveLater, onDropBefore: vi.fn() }} />);
    const card = screen.getByRole('article', { name: /MV Synthetic/ });
    const dragStrip = within(card).getByRole('group', { name: /Drag to reorder/ });
    expect(dragStrip).toBe(card.firstElementChild);
    expect(dragStrip).toHaveAttribute('draggable', 'true');
    expect(dragStrip).toHaveAttribute('title', 'Drag to reorder');
    const dataTransfer = { effectAllowed: '', setData: vi.fn() };
    fireEvent.dragStart(dragStrip, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', bidId);
    const moveEarlier = within(card).getByRole('button', { name: 'Move earlier' });
    expect(moveEarlier.closest('footer')).not.toBeNull();
    expect(moveEarlier).toBeDisabled();
    fireEvent.click(within(card).getByRole('button', { name: 'Move later' }));
    expect(onMoveLater).toHaveBeenCalledOnce();
    expect(onMoveEarlier).not.toHaveBeenCalled();
    expect(onManage).not.toHaveBeenCalled();
  });
  it('renders the operational bid summary and BUYER-visible quote table in one semantic card', () => {
    const { card, onManage } = renderCard(bid(), [quote('Synthetic Trader', 1007)]);
    expect(within(card).getByText('Buyer Creator')).toBeInTheDocument();
    expect(within(card).getByText('Test Port')).toBeInTheDocument();
    expect(within(card).getByText('1–2 September')).toBeInTheDocument();
    expect(within(card).getByText('Buyer Operator')).toBeInTheDocument();
    expect(within(card).getByText('VLSFO')).toBeInTheDocument();
    expect(within(card).getByRole('table')).toBeInTheDocument();
    expect(within(card).getByRole('region', { name: /SELLER comparison table/ })).toHaveAttribute('tabindex', '0');
    expect(within(card).getByRole('heading', { name: 'Buyer-visible comparison' })).toBeInTheDocument();
    expect(within(card).queryByRole('heading', { name: 'SELLER comparison' })).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Manage bid' }));
    expect(onManage).toHaveBeenCalledOnce();
  });

  it('keeps seconds in a compact advisory remaining-time value directly below the deadline', () => {
    const { card } = renderCard(bid({ deadline_at: '2026-08-27T04:02:03.000Z' }));
    const deadline = within(card).getByText('Deadline').closest('div')!;
    expect(deadline).toHaveTextContent('(25:02:03 remaining)');
    expect(deadline).not.toHaveTextContent('Remaining time:');
    expect(deadline).not.toHaveTextContent('Client clock, advisory only');
  });

  it('follows the bid fuel-item order for dynamic unit-price columns', () => {
    const currentBid = bid({ fuel_items: [{ fuel_grade: 'ulsfo', quantity_mt: 5 }, { fuel_grade: 'hsfo', quantity_mt: 8 }, { fuel_grade: 'lsfo', quantity_mt: 3 }] });
    const prices = [{ fuel_grade: 'hsfo' as const, unit_price: 80 }, { fuel_grade: 'lsfo' as const, unit_price: 90 }, { fuel_grade: 'ulsfo' as const, unit_price: 70 }];
    const { card } = renderCard(currentBid, [quote('Dynamic Trader', 999, { fuel_prices: prices })]);
    expect(within(card).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Rank', 'SELLER', 'Status', 'ULSFO ($/MT)', 'HSFO ($/MT)', 'LSFO ($/MT)', 'Barge fee ($)', 'Total ($)',
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
    expect(within(lowRow).getByText('1')).toHaveAttribute('title', 'Lowest current comparison offer');
    expect(within(secondRow).getByText('2')).toBeInTheDocument();
    expect(lowRow).not.toHaveClass('is-comparison-excluded');
    expect(within(lowRow).getByRole('rowheader')).toHaveTextContent('Current Low');
    expect(within(lowRow).queryByText(/Award unavailable while bid is open/)).not.toBeInTheDocument();
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
    expect(within(activeRow).getByText('1')).toHaveAttribute('title', 'Lowest current comparison offer');
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
    expect(within(eligibleRow).getByText('1')).toHaveAttribute('title', 'Lowest award-eligible comparison offer');
    const result = within(card).getByText(/Lowest award-eligible offer/).closest('.buyer-board-result')!;
    expect(result).toHaveTextContent('Award Eligible Low · $100');
    expect(result).toHaveTextContent('Gap to second award-eligible offer: $25 (25%)');
    expect(result).toHaveTextContent('Eligible SELLER selection is available in this comparison. Manage bid remains available for full detail.');
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

  it('renders a scoped unquoted SELLER as Awaiting with no rank or commercial values', () => {
    const card = renderSellers(bid(), [awaiting('Waiting Seller', '71')]);
    const row = within(card).getByRole('rowheader', { name: /Waiting Seller/ }).closest('tr')!;
    expect(within(row).getByText('Awaiting')).toBeInTheDocument();
    expect(row.querySelector('.buyer-board-seller-status')).toHaveClass('status-awaiting');
    expect(within(row).getAllByText('—')).toHaveLength(4);
    expect(row).toHaveClass('is-comparison-excluded');
    expect(within(card).getByText('No current comparison offers')).toBeInTheDocument();
    expect(within(card).getByText('1 SELLER · 0 current quotes')).toBeInTheDocument();
  });

  it('excludes awaiting rows from mixed ranking and the lowest-price result', () => {
    const quoted = quote('Quoted Seller', 100, { eligible_for_award: false });
    const card = renderSellers(bid(), [awaiting('Waiting Seller', '72'), comparison(quoted)]);
    const waitingRow = within(card).getByRole('rowheader', { name: /Waiting Seller/ }).closest('tr')!;
    const quotedRow = within(card).getByRole('rowheader', { name: /Quoted Seller/ }).closest('tr')!;
    expect(within(waitingRow).getAllByText('—')).toHaveLength(4);
    expect(within(quotedRow).getByText('1')).toHaveAttribute('title', 'Lowest current comparison offer');
    expect(within(quotedRow).getByText('Quoted')).toBeInTheDocument();
    expect(quotedRow.querySelector('.buyer-board-seller-status')).toHaveClass('status-quoted');
    expect(within(card).getByText(/Quoted Seller · \$100/)).toBeInTheDocument();
    expect(within(card).getByText('2 SELLERs · 1 current quote')).toBeInTheDocument();
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
    expect(within(card).getByText('2 SELLERs · 1 current quote')).toBeInTheDocument();
  });

  it('does not count a retained gave-up quote as a current quote', () => {
    const gaveUp = quote('Gave Up Seller', 50, { response_status: 'gave_up', eligible_for_award: false });
    const card = renderSellers(bid(), [comparison(gaveUp)]);
    expect(within(card).getByText('Gave up')).toBeInTheDocument();
    expect(within(card).getByText('1 SELLER · 0 current quotes')).toBeInTheDocument();
    expect(within(card).getByText('No current comparison offers')).toBeInTheDocument();
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
    expect(screen.getByText('0 SELLERs · 0 current quotes')).toBeInTheDocument();
    rerender(<BuyerBidBoardCard bid={currentBid} sellerState={{ status: 'loading' }} currentTimeMs={Date.parse(now)} selected={false} onManage={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading SELLER comparison');
    rerender(<BuyerBidBoardCard bid={currentBid} sellerState={{ status: 'error' }} currentTimeMs={Date.parse(now)} selected onManage={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('SELLER comparison temporarily unavailable');
    expect(screen.getByRole('button', { name: 'Managing bid' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('enables every eligible CLOSED quote, including a non-lowest SELLER, and opens a frozen confirmation before calling the parent', async () => {
    const currentBid = bid({ raw_status: 'closed', effective_status: 'closed', revision: 7, closed_at: now });
    const low = quote('Lowest Seller', 900, { revision: 2 });
    const chosen = quote('Non-lowest Seller', 1200, { revision: 5 });
    const onAward = vi.fn(() => Promise.resolve(true));
    render(<BuyerBidBoardCard bid={currentBid} sellerState={{ status: 'success', sellers: [comparison(low), comparison(chosen)] }} currentTimeMs={Date.parse(now)} selected={false} onManage={vi.fn()} onAward={onAward} />);

    expect(screen.getByRole('button', { name: 'Select Lowest Seller' })).toBeEnabled();
    const selectChosen = screen.getByRole('button', { name: 'Select Non-lowest Seller' });
    expect(selectChosen).toBeEnabled();
    fireEvent.click(selectChosen);
    expect(onAward).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('group', { name: 'Confirm Non-lowest Seller selection' });
    expect(confirmation).toHaveTextContent('Authoritative total: $1,200');
    expect(confirmation).toHaveTextContent('BID revision 7 · Quote revision 5');
    expect(confirmation).toHaveTextContent('This selection is final in V1.1. There is no unaward or replacement.');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm selection' }));
    await waitFor(() => expect(onAward).toHaveBeenCalledExactlyOnceWith(currentBid.id, 7, chosen.id, 5));
  });

  it('shows quoted OPEN selection for discoverability but keeps it disabled with an explanation', () => {
    const onAward = vi.fn(() => Promise.resolve(true));
    render(<BuyerBidBoardCard bid={bid()} sellerState={{ status: 'success', sellers: [comparison(quote('Open Seller', 1000))] }} currentTimeMs={Date.parse(now)} selected={false} onManage={vi.fn()} onAward={onAward} />);
    const select = screen.getByRole('button', { name: 'Select Open Seller' });
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute('title', 'Selection is available only after bidding closes.');
    expect(select).toHaveAccessibleDescription('Selection is available only after bidding closes.');
    fireEvent.click(select);
    expect(onAward).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Confirm selection' })).not.toBeInTheDocument();
  });

  it('keeps gave-up, awaiting, revoked-access, inactive-organization, and ineligible CLOSED rows non-actionable', () => {
    const currentBid = bid({ raw_status: 'closed', effective_status: 'closed', closed_at: now });
    const gaveUp = comparison(quote('Gave Up', 700, { response_status: 'gave_up', eligible_for_award: false }));
    const revoked = comparison(quote('Revoked', 800, { access_active: false, eligible_for_award: false }));
    const inactive = comparison(quote('Inactive', 900, { organization_active: false, eligible_for_award: false }));
    const ineligible = comparison(quote('Ineligible', 1000, { eligible_for_award: false }));
    render(<BuyerBidBoardCard bid={currentBid} sellerState={{ status: 'success', sellers: [gaveUp, revoked, inactive, ineligible, awaiting('Awaiting', '90')] }} currentTimeMs={Date.parse(now)} selected={false} onManage={vi.fn()} onAward={() => Promise.resolve(true)} />);

    expect(screen.queryByRole('button', { name: 'Select Gave Up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select Awaiting' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select Revoked' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select Inactive' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select Ineligible' })).toBeDisabled();
  });

  it.each([
    ['awarded', bid({ raw_status: 'awarded', effective_status: 'awarded', awarded_quote_id: quote('Terminal', 1000).id, awarded_trader_organization_id: quote('Terminal', 1000).trader_organization_id, awarded_trader_organization_label: 'Terminal', awarded_total_amount: 1000, awarded_at: now })],
    ['cancelled', bid({ raw_status: 'cancelled', effective_status: 'cancelled', cancelled_at: now })],
  ] as const)('has no executable selection on an %s card', (_status, currentBid) => {
    render(<BuyerBidBoardCard bid={currentBid} sellerState={{ status: 'success', sellers: [comparison(quote('Terminal', 1000))] }} currentTimeMs={Date.parse(now)} selected={false} onManage={vi.fn()} onAward={() => Promise.resolve(true)} />);
    expect(screen.queryByRole('button', { name: 'Select Terminal' })).not.toBeInTheDocument();
  });

  it('has no executable selection in archived read-only history', () => {
    const currentBid = bid({ raw_status: 'closed', effective_status: 'closed', closed_at: now });
    render(<BuyerBidBoardCard bid={currentBid} sellerState={{ status: 'success', sellers: [comparison(quote('Archived Seller', 1000))] }} currentTimeMs={Date.parse(now)} selected={false} onManage={vi.fn()} onAward={() => Promise.resolve(true)} readOnly />);
    expect(screen.queryByRole('button', { name: 'Select Archived Seller' })).not.toBeInTheDocument();
  });

  it('cancels confirmation without changing the BID', () => {
    const currentBid = bid({ raw_status: 'closed', effective_status: 'closed', closed_at: now });
    const onAward = vi.fn(() => Promise.resolve(true));
    render(<BuyerBidBoardCard bid={currentBid} sellerState={{ status: 'success', sellers: [comparison(quote('Review Seller', 1000))] }} currentTimeMs={Date.parse(now)} selected={false} onManage={vi.fn()} onAward={onAward} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select Review Seller' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep reviewing' }));
    expect(screen.queryByRole('button', { name: 'Confirm selection' })).not.toBeInTheDocument();
    expect(onAward).not.toHaveBeenCalled();
  });

  it('prevents duplicate confirmation while the award mutation is pending', async () => {
    const currentBid = bid({ raw_status: 'closed', effective_status: 'closed', closed_at: now });
    let resolveAward!: (value: boolean) => void;
    const award = new Promise<boolean>((resolve) => { resolveAward = resolve; });
    const onAward = vi.fn(() => award);
    render(<BuyerBidBoardCard bid={currentBid} sellerState={{ status: 'success', sellers: [comparison(quote('Pending Seller', 1000))] }} currentTimeMs={Date.parse(now)} selected={false} onManage={vi.fn()} onAward={onAward} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select Pending Seller' }));
    const confirm = screen.getByRole('button', { name: 'Confirm selection' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onAward).toHaveBeenCalledOnce();
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep reviewing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select Pending Seller' })).toBeDisabled();
    await act(async () => { resolveAward(true); await award; });
  });

  it.each([
    ['BID revision', (currentBid: Bid, seller: BuyerSellerComparison) => ({ nextBid: { ...currentBid, revision: currentBid.revision + 1 }, nextSeller: seller })],
    ['BID status', (currentBid: Bid, seller: BuyerSellerComparison) => ({ nextBid: { ...currentBid, raw_status: 'awarded' as const, effective_status: 'awarded' as const, awarded_quote_id: seller.quote!.id }, nextSeller: seller })],
    ['quote revision', (currentBid: Bid, seller: BuyerSellerComparison) => ({ nextBid: currentBid, nextSeller: comparison({ ...seller.quote!, revision: seller.quote!.revision + 1 }) })],
    ['response status', (currentBid: Bid, seller: BuyerSellerComparison) => ({ nextBid: currentBid, nextSeller: { ...seller, response_status: 'gave_up' as const, quote: { ...seller.quote!, response_status: 'gave_up' as const, eligible_for_award: false } } })],
    ['access', (currentBid: Bid, seller: BuyerSellerComparison) => ({ nextBid: currentBid, nextSeller: { ...seller, access_active: false, quote: { ...seller.quote!, access_active: false, eligible_for_award: false } } })],
    ['organization', (currentBid: Bid, seller: BuyerSellerComparison) => ({ nextBid: currentBid, nextSeller: { ...seller, organization_active: false, quote: { ...seller.quote!, organization_active: false, eligible_for_award: false } } })],
    ['eligibility', (currentBid: Bid, seller: BuyerSellerComparison) => ({ nextBid: currentBid, nextSeller: { ...seller, quote: { ...seller.quote!, eligible_for_award: false } } })],
    ['awarded state', (currentBid: Bid, seller: BuyerSellerComparison) => ({ nextBid: { ...currentBid, awarded_quote_id: seller.quote!.id }, nextSeller: { ...seller, quote: { ...seller.quote!, is_awarded: true, eligible_for_award: false } } })],
  ])('invalidates a frozen confirmation after a meaningful %s change', async (_field, change) => {
    const currentBid = bid({ raw_status: 'closed', effective_status: 'closed', revision: 4, closed_at: now });
    const seller = comparison(quote('Changing Seller', 1234, { revision: 3 }));
    const onAward = vi.fn(() => Promise.resolve(true));
    const { rerender } = render(<BuyerBidBoardCard bid={currentBid} sellerState={{ status: 'success', sellers: [seller] }} currentTimeMs={Date.parse(now)} selected={false} onManage={vi.fn()} onAward={onAward} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select Changing Seller' }));
    expect(screen.getByRole('button', { name: 'Confirm selection' })).toBeInTheDocument();
    const { nextBid, nextSeller } = change(currentBid, seller);
    rerender(<BuyerBidBoardCard bid={nextBid} sellerState={{ status: 'success', sellers: [nextSeller] }} currentTimeMs={Date.parse(now)} selected={false} onManage={vi.fn()} onAward={onAward} />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm selection' })).not.toBeInTheDocument());
    expect(onAward).not.toHaveBeenCalled();
  });
});
