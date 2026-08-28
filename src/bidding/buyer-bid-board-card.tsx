import type { Bid, BuyerSellerComparison, Quote } from './types';
import { StatusBadge } from '../ui/workspace-ui';

export type BuyerBidBoardSellerState =
  | { status: 'loading' }
  | { status: 'success'; sellers: BuyerSellerComparison[] }
  | { status: 'error' };

const number = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
const money = (value: number) => `$${number(value)}`;
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'No deadline';
const remainingTime = (deadline: string | null, nowMs: number) => {
  if (!deadline) return 'No deadline';
  const remainingSeconds = Math.ceil((new Date(deadline).getTime() - nowMs) / 1_000);
  if (remainingSeconds <= 0) return 'Expired';
  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m ${seconds}s remaining`;
};
const quotePrice = (quote: Quote, grade: Bid['fuel_items'][number]['fuel_grade']) => {
  const price = quote.fuel_prices.find((candidate) => candidate.fuel_grade === grade);
  return price ? money(price.unit_price) : '—';
};
const isComparisonEligible = (bid: Bid, quote: Quote) => {
  if (bid.effective_status === 'open') return quote.access_active && quote.organization_active;
  if (bid.effective_status === 'closed') return quote.eligible_for_award;
  return false;
};
const quoteMetadata = (bid: Bid, quote: Quote, comparisonEligible: boolean) => {
  const metadata: string[] = [];
  if (quote.is_awarded) metadata.push('Awarded quote');
  if (!quote.access_active) metadata.push('Access inactive');
  if (!quote.organization_active) metadata.push('Organization inactive');
  if (bid.effective_status === 'open') {
    metadata.push(comparisonEligible ? 'Current comparison eligible' : 'Excluded from current comparison');
    metadata.push('Award unavailable while bid is open');
  } else if (bid.effective_status === 'closed') {
    metadata.push(quote.eligible_for_award ? 'Eligible for award' : 'Ineligible for award');
  } else if (bid.effective_status === 'awarded' && !quote.is_awarded) {
    metadata.push('Historical quote', 'Not selected');
  } else if (bid.effective_status === 'cancelled') {
    metadata.push('Historical quote', 'No award candidate');
  }
  return metadata.join(' · ');
};
const sellerMetadata = (bid: Bid, seller: BuyerSellerComparison, comparisonEligible: boolean) => {
  if (seller.quote) return quoteMetadata(bid, seller.quote, comparisonEligible);
  const metadata = ['Current scope'];
  if (!seller.organization_active) metadata.push('Organization inactive');
  metadata.push('Excluded from current comparison');
  return metadata.join(' · ');
};

function AdvisoryComparison({ bid, quotes }: { bid: Bid; quotes: Quote[] }) {
  if (bid.effective_status !== 'open' && bid.effective_status !== 'closed') return null;
  const eligible = quotes.filter((quote) => isComparisonEligible(bid, quote)).sort((a, b) => a.total_amount - b.total_amount || a.id.localeCompare(b.id));
  const isOpen = bid.effective_status === 'open';
  const label = isOpen ? 'Lowest current offer · comparison only' : 'Lowest award-eligible offer · advisory only';
  const empty = isOpen ? 'No current comparison offers' : 'No award-eligible offers';
  const gapLabel = isOpen ? 'Gap to second current offer' : 'Gap to second award-eligible offer';
  const authorityNote = isOpen ? 'Awards are unavailable while the bid is open.' : 'Award actions remain exclusively in Manage bid.';
  if (eligible.length === 0) return <div className="buyer-board-result"><span>{label}</span><strong>{empty}</strong><small>{authorityNote}</small></div>;
  const lowest = eligible[0]!;
  const second = eligible[1];
  const gap = second ? second.total_amount - lowest.total_amount : null;
  const percentage = gap === null ? null : gap / lowest.total_amount * 100;
  return <div className="buyer-board-result">
    <span>{label}</span>
    <strong>{lowest.trader_organization_label} · {money(lowest.total_amount)}</strong>
    <small>{gap === null ? `${gapLabel}: — (fewer than two comparison-eligible quotes)` : `${gapLabel}: ${money(gap)} (${number(percentage!)}%)`}</small>
    <small>{authorityNote}</small>
  </div>;
}

export function BuyerBidBoardCard({ bid, sellerState, currentTimeMs, selected, onManage }: {
  bid: Bid;
  sellerState: BuyerBidBoardSellerState;
  currentTimeMs: number;
  selected: boolean;
  onManage: () => void;
}) {
  const headingId = `buyer-board-card-${bid.id}`;
  const remaining = remainingTime(bid.deadline_at, currentTimeMs);
  const sellers = sellerState.status === 'success'
    ? [...sellerState.sellers].sort((a, b) => Number(Boolean(b.quote?.is_awarded)) - Number(Boolean(a.quote?.is_awarded))
      || Number(Boolean(b.quote)) - Number(Boolean(a.quote))
      || (a.quote?.total_amount ?? 0) - (b.quote?.total_amount ?? 0)
      || a.trader_organization_label.localeCompare(b.trader_organization_label)
      || a.trader_organization_id.localeCompare(b.trader_organization_id))
    : [];
  const quotes = sellers.flatMap((seller) => seller.quote ? [seller.quote] : []);
  const comparisonRanks = new Map(
    quotes.filter((quote) => isComparisonEligible(bid, quote)).sort((a, b) => a.total_amount - b.total_amount || a.id.localeCompare(b.id)).map((quote, index) => [quote.id, index + 1]),
  );

  return <article className={`buyer-board-card status-${bid.effective_status}${selected ? ' is-selected' : ''}`} aria-labelledby={headingId}>
    <header className="buyer-board-card-heading">
      <div><p className="eyebrow">Vessel / voyage</p><h3 id={headingId}>{bid.vessel_voyage}</h3><p className="buyer-board-port">{bid.port_name}</p></div>
      <div className="buyer-bid-card-status"><span className="buyer-card-label">Effective status</span><StatusBadge status={bid.effective_status} /></div>
    </header>
    <dl className="buyer-board-summary">
      <div><dt>Delivery window</dt><dd>{bid.delivery_window}</dd></div>
      <div><dt>Deadline</dt><dd>{date(bid.deadline_at)}</dd></div>
      <div><dt>Remaining time</dt><dd className={`deadline-countdown${remaining === 'Expired' ? ' is-expired' : ''}`}>{remaining}</dd></div>
      <div><dt>Responsible BUYER</dt><dd>{bid.responsible_buyer_label}</dd></div>
      <div className="buyer-board-fuels"><dt>Fuel request</dt><dd>{bid.fuel_items.map((item) => <span key={item.fuel_grade}><strong>{item.fuel_grade.toUpperCase()}</strong> {number(item.quantity_mt)} MT</span>)}</dd></div>
    </dl>
    <section className="buyer-board-quotes" aria-label={`SELLER comparison for ${bid.vessel_voyage}`}>
      <div className="buyer-board-quotes-heading"><div><p className="eyebrow">BUYER-visible comparison</p><h4>SELLER comparison</h4></div>{sellerState.status === 'success' ? <span>{sellers.length} SELLER{sellers.length === 1 ? '' : 's'} · {quotes.length} quote{quotes.length === 1 ? '' : 's'} received</span> : null}</div>
      {sellerState.status === 'loading' ? <p className="buyer-board-quote-state" role="status">Loading SELLER comparison…</p>
        : sellerState.status === 'error' ? <p className="buyer-board-quote-state is-error" role="status">SELLER comparison temporarily unavailable. Refresh to try again.</p>
          : sellers.length === 0 ? <p className="buyer-board-quote-state">No SELLER participants</p>
            : <div className="buyer-board-quote-scroll" tabIndex={0} role="region" aria-label={`Scrollable SELLER comparison table for ${bid.vessel_voyage}`}>
              <table>
                <thead><tr><th scope="col">Rank</th><th scope="col">SELLER</th><th scope="col">Status</th>{bid.fuel_items.map((item) => <th scope="col" key={item.fuel_grade}>{item.fuel_grade.toUpperCase()} ($/MT)</th>)}<th scope="col">Barge fee ($)</th><th scope="col">Authoritative total ($)</th></tr></thead>
                <tbody>{sellers.map((seller) => {
                  const quote = seller.quote;
                  const comparisonEligible = quote ? isComparisonEligible(bid, quote) : false;
                  const status = quote?.is_awarded ? 'Awarded' : quote ? 'Quoted' : 'Awaiting quote';
                  return <tr className={`${quote?.is_awarded ? 'is-awarded ' : ''}${!quote?.is_awarded && !comparisonEligible ? 'is-comparison-excluded' : ''}`.trim()} key={seller.trader_organization_id}>
                  <td className="buyer-board-rank">{quote?.is_awarded ? 'Awarded' : quote ? comparisonRanks.get(quote.id) ?? '—' : '—'}</td>
                  <th scope="row"><strong>{seller.trader_organization_label}</strong><small>{sellerMetadata(bid, seller, comparisonEligible)}</small></th>
                  <td className="buyer-board-seller-status">{status}</td>
                  {bid.fuel_items.map((item) => <td key={item.fuel_grade}>{quote ? quotePrice(quote, item.fuel_grade) : '—'}</td>)}
                  <td>{quote ? money(quote.barge_fee) : '—'}</td><td className="buyer-board-total">{quote ? <>{money(quote.total_amount)}<small>Server total</small></> : '—'}</td>
                </tr>;
                })}</tbody>
              </table>
            </div>}
    </section>
    {bid.effective_status === 'awarded' && bid.awarded_trader_organization_label && bid.awarded_total_amount !== null
      ? <div className="buyer-board-result is-awarded"><span>Awarded result · authoritative</span><strong>{bid.awarded_trader_organization_label} · {money(bid.awarded_total_amount)}</strong><small>Manual server-authorized award; not an automatic lowest-price selection.</small></div>
      : sellerState.status === 'success' && sellers.length > 0 ? <AdvisoryComparison bid={bid} quotes={quotes} /> : null}
    <footer className="buyer-board-card-footer">
      <span>Creator: {bid.created_by_label} · Revision {bid.revision}</span>
      <button type="button" aria-pressed={selected} onClick={onManage}>{selected ? 'Managing bid' : 'Manage bid'}</button>
    </footer>
  </article>;
}
