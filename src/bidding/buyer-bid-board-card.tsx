import type { Bid, Quote } from './types';
import { StatusBadge } from '../ui/workspace-ui';

export type BuyerBidBoardQuoteState =
  | { status: 'loading' }
  | { status: 'success'; quotes: Quote[] }
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
const quoteMetadata = (quote: Quote) => {
  const metadata: string[] = [];
  if (quote.is_awarded) metadata.push('Awarded quote');
  if (!quote.access_active) metadata.push('Access inactive');
  if (!quote.organization_active) metadata.push('Organization inactive');
  if (quote.eligible_for_award) metadata.push('Eligible for award');
  else if (!quote.is_awarded) metadata.push('Ineligible for award');
  return metadata.join(' · ');
};

function LowestEligibleOffer({ quotes }: { quotes: Quote[] }) {
  const eligible = quotes.filter((quote) => quote.eligible_for_award).sort((a, b) => a.total_amount - b.total_amount || a.id.localeCompare(b.id));
  if (eligible.length === 0) return <div className="buyer-board-result"><span>Lowest eligible offer</span><strong>No eligible offers</strong></div>;
  const lowest = eligible[0]!;
  const second = eligible[1];
  const gap = second ? second.total_amount - lowest.total_amount : null;
  const percentage = gap === null ? null : gap / lowest.total_amount * 100;
  return <div className="buyer-board-result">
    <span>Lowest eligible offer · advisory only</span>
    <strong>{lowest.trader_organization_label} · {money(lowest.total_amount)}</strong>
    <small>{gap === null ? 'Gap to second eligible: — (fewer than two eligible quotes)' : `Gap to second eligible: ${money(gap)} (${number(percentage!)}%)`}</small>
  </div>;
}

export function BuyerBidBoardCard({ bid, quoteState, currentTimeMs, selected, onManage }: {
  bid: Bid;
  quoteState: BuyerBidBoardQuoteState;
  currentTimeMs: number;
  selected: boolean;
  onManage: () => void;
}) {
  const headingId = `buyer-board-card-${bid.id}`;
  const remaining = remainingTime(bid.deadline_at, currentTimeMs);
  const quotes = quoteState.status === 'success'
    ? [...quoteState.quotes].sort((a, b) => Number(b.is_awarded) - Number(a.is_awarded) || a.total_amount - b.total_amount || a.id.localeCompare(b.id))
    : [];
  const eligibleRanks = new Map(
    quotes.filter((quote) => quote.eligible_for_award).sort((a, b) => a.total_amount - b.total_amount || a.id.localeCompare(b.id)).map((quote, index) => [quote.id, index + 1]),
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
    <section className="buyer-board-quotes" aria-label={`Quote comparison for ${bid.vessel_voyage}`}>
      <div className="buyer-board-quotes-heading"><div><p className="eyebrow">BUYER-visible comparison</p><h4>TRADER quotes</h4></div>{quoteState.status === 'success' ? <span>{quotes.length} received</span> : null}</div>
      {quoteState.status === 'loading' ? <p className="buyer-board-quote-state" role="status">Loading quotes…</p>
        : quoteState.status === 'error' ? <p className="buyer-board-quote-state is-error" role="status">Quotes temporarily unavailable. Refresh to try again.</p>
          : quotes.length === 0 ? <p className="buyer-board-quote-state">No quotes received yet</p>
            : <div className="buyer-board-quote-scroll" tabIndex={0} role="region" aria-label={`Scrollable quote table for ${bid.vessel_voyage}`}>
              <table>
                <thead><tr><th scope="col">Rank</th><th scope="col">TRADER organization</th>{bid.fuel_items.map((item) => <th scope="col" key={item.fuel_grade}>{item.fuel_grade.toUpperCase()} ($/MT)</th>)}<th scope="col">Barge fee ($)</th><th scope="col">Authoritative total ($)</th></tr></thead>
                <tbody>{quotes.map((quote) => <tr className={`${quote.is_awarded ? 'is-awarded ' : ''}${quote.eligible_for_award ? '' : 'is-ineligible'}`.trim()} key={quote.id}>
                  <td className="buyer-board-rank">{quote.is_awarded ? 'Awarded' : eligibleRanks.get(quote.id) ?? '—'}</td>
                  <th scope="row"><strong>{quote.trader_organization_label}</strong><small>{quoteMetadata(quote)}</small></th>
                  {bid.fuel_items.map((item) => <td key={item.fuel_grade}>{quotePrice(quote, item.fuel_grade)}</td>)}
                  <td>{money(quote.barge_fee)}</td><td className="buyer-board-total">{money(quote.total_amount)}<small>Server total</small></td>
                </tr>)}</tbody>
              </table>
            </div>}
    </section>
    {bid.effective_status === 'awarded' && bid.awarded_trader_organization_label && bid.awarded_total_amount !== null
      ? <div className="buyer-board-result is-awarded"><span>Awarded result · authoritative</span><strong>{bid.awarded_trader_organization_label} · {money(bid.awarded_total_amount)}</strong><small>Manual server-authorized award; not an automatic lowest-price selection.</small></div>
      : quoteState.status === 'success' && quotes.length > 0 ? <LowestEligibleOffer quotes={quotes} /> : null}
    <footer className="buyer-board-card-footer">
      <span>Creator: {bid.created_by_label} · Revision {bid.revision}</span>
      <button type="button" aria-pressed={selected} onClick={onManage}>{selected ? 'Managing bid' : 'Manage bid'}</button>
    </footer>
  </article>;
}
