import { Fragment, useEffect, useRef, useState, type DragEvent } from 'react';
import type { Bid, BuyerSellerComparison, Quote } from './types';
import { StatusBadge } from '../ui/workspace-ui';

export type BuyerBidBoardSellerState =
  | { status: 'loading' }
  | { status: 'success'; sellers: BuyerSellerComparison[] }
  | { status: 'error' };
export type BuyerBidReorderControls = {
  enabled: boolean;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onDropBefore: (sourceBidId: string) => void;
};
type AwardConfirmation = {
  bidId: string;
  bidRevision: number;
  quoteId: string;
  quoteRevision: number;
  sellerLabel: string;
  authoritativeTotal: number;
  signature: string;
};

const number = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
const money = (value: number) => `$${number(value)}`;
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'No deadline';
const remainingTime = (deadline: string | null, nowMs: number) => {
  if (!deadline) return 'No deadline';
  const remainingSeconds = Math.ceil((new Date(deadline).getTime() - nowMs) / 1_000);
  if (remainingSeconds <= 0) return 'Expired';
  const hours = Math.floor(remainingSeconds / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} remaining`;
};
const quotePrice = (quote: Quote, grade: Bid['fuel_items'][number]['fuel_grade']) => {
  const price = quote.fuel_prices.find((candidate) => candidate.fuel_grade === grade);
  return price ? money(price.unit_price) : '—';
};
const isComparisonEligible = (bid: Bid, quote: Quote) => {
  if (quote.response_status !== 'quoted') return false;
  if (bid.effective_status === 'open') return quote.access_active && quote.organization_active;
  if (bid.effective_status === 'closed') return quote.eligible_for_award;
  return false;
};
const quoteMetadata = (bid: Bid, quote: Quote, comparisonEligible: boolean) => {
  const metadata: string[] = [];
  if (quote.is_awarded) metadata.push('Awarded quote');
  if (quote.response_status === 'gave_up') metadata.push('Gave up');
  if (!quote.access_active) metadata.push('Access inactive');
  if (!quote.organization_active) metadata.push('Organization inactive');
  if (bid.effective_status === 'open') {
    if (!comparisonEligible) metadata.push('Excluded from current comparison');
  } else if (bid.effective_status === 'closed') {
    if (!quote.eligible_for_award) metadata.push('Ineligible for award');
  } else if (bid.effective_status === 'awarded' && !quote.is_awarded) {
    metadata.push('Historical quote', 'Not selected');
  } else if (bid.effective_status === 'cancelled') {
    metadata.push('Historical quote', 'No award candidate');
  }
  return metadata.join(' · ');
};
const sellerMetadata = (bid: Bid, seller: BuyerSellerComparison, comparisonEligible: boolean) => {
  if (seller.quote) return quoteMetadata(bid, seller.quote, comparisonEligible);
  const metadata = [seller.access_active ? '' : 'Access inactive'];
  if (!seller.organization_active) metadata.push('Organization inactive');
  return metadata.filter(Boolean).join(' · ');
};
const awardTargetSignature = (bid: Bid, seller: BuyerSellerComparison) => JSON.stringify([
  bid.id,
  bid.revision,
  bid.raw_status,
  bid.effective_status,
  bid.awarded_quote_id,
  bid.awarded_trader_organization_id,
  bid.awarded_at,
  seller.trader_organization_id,
  seller.trader_organization_label,
  seller.response_status,
  seller.access_active,
  seller.organization_active,
  seller.quote?.id ?? null,
  seller.quote?.revision ?? null,
  seller.quote?.response_status ?? null,
  seller.quote?.access_active ?? null,
  seller.quote?.organization_active ?? null,
  seller.quote?.eligible_for_award ?? null,
  seller.quote?.is_awarded ?? null,
  seller.quote?.total_amount ?? null,
]);

function AdvisoryComparison({ bid, quotes }: { bid: Bid; quotes: Quote[] }) {
  if (bid.effective_status !== 'open' && bid.effective_status !== 'closed') return null;
  const eligible = quotes.filter((quote) => isComparisonEligible(bid, quote)).sort((a, b) => a.total_amount - b.total_amount || a.id.localeCompare(b.id));
  const isOpen = bid.effective_status === 'open';
  const label = isOpen ? 'Lowest current offer · comparison only' : 'Lowest award-eligible offer · advisory only';
  const empty = isOpen ? 'No current comparison offers' : 'No award-eligible offers';
  const gapLabel = isOpen ? 'Gap to second current offer' : 'Gap to second award-eligible offer';
  const authorityNote = isOpen ? 'Awards are unavailable while the bid is open.' : 'Eligible SELLER selection is available in this comparison. Manage bid remains available for full detail.';
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

export function BuyerBidBoardCard({ bid, sellerState, currentTimeMs, selected, onManage, onAward, awardPending = false, readOnly = false, reorder: requestedReorder }: {
  bid: Bid;
  sellerState: BuyerBidBoardSellerState;
  currentTimeMs: number;
  selected: boolean;
  onManage: () => void;
  onAward?: (bidId: string, bidRevision: number, quoteId: string, quoteRevision: number) => Promise<boolean>;
  awardPending?: boolean;
  reorder?: BuyerBidReorderControls;
  readOnly?: boolean;
}) {
  const reorder = readOnly ? undefined : requestedReorder;
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
  const currentQuoteCount = sellers.filter((seller) => seller.response_status === 'quoted' && seller.quote !== null && seller.access_active && seller.organization_active).length;
  const comparisonRanks = new Map(
    quotes.filter((quote) => isComparisonEligible(bid, quote)).sort((a, b) => a.total_amount - b.total_amount || a.id.localeCompare(b.id)).map((quote, index) => [quote.id, index + 1]),
  );

  const [dragOver, setDragOver] = useState(false);
  const [awardConfirmation, setAwardConfirmation] = useState<AwardConfirmation | null>(null);
  const [awardSubmitting, setAwardSubmitting] = useState(false);
  const awardSubmittingRef = useRef(false);
  const confirmedSeller = awardConfirmation
    ? sellers.find((seller) => seller.quote?.id === awardConfirmation.quoteId)
    : undefined;
  const currentAwardSignature = confirmedSeller ? awardTargetSignature(bid, confirmedSeller) : null;
  const confirmedTarget = awardConfirmation && currentAwardSignature === awardConfirmation.signature ? awardConfirmation : null;
  useEffect(() => {
    if (awardConfirmation && currentAwardSignature !== awardConfirmation.signature) setAwardConfirmation(null);
  }, [awardConfirmation, currentAwardSignature]);
  const confirmAward = async () => {
    if (!confirmedTarget || !onAward || awardPending || awardSubmittingRef.current) return;
    awardSubmittingRef.current = true;
    setAwardSubmitting(true);
    try {
      await onAward(confirmedTarget.bidId, confirmedTarget.bidRevision, confirmedTarget.quoteId, confirmedTarget.quoteRevision);
    } finally {
      awardSubmittingRef.current = false;
      setAwardSubmitting(false);
    }
  };
  const onDragStart = (event: DragEvent<HTMLElement>) => {
    if (!reorder?.enabled) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', bid.id);
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragOver(false);
    const sourceId = event.dataTransfer.getData('text/plain');
    if (reorder?.enabled && sourceId) reorder.onDropBefore(sourceId);
  };
  return <article className={`buyer-board-card status-${bid.effective_status}${selected ? ' is-selected' : ''}${dragOver ? ' is-reorder-target' : ''}`} aria-labelledby={headingId} onDragOver={(event) => { if (reorder?.enabled) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOver(true); } }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
    {reorder ? <div className="buyer-bid-drag-strip" role="group" draggable={reorder.enabled} aria-label={`Drag to reorder ${bid.vessel_voyage}`} title="Drag to reorder" onDragStart={onDragStart}><span aria-hidden="true" /></div> : null}
    <header className="buyer-board-card-heading">
      <div className="buyer-board-card-creator"><span className="buyer-card-label">Creator</span><span>{bid.created_by_label}</span></div>
      <div className="buyer-bid-card-status"><span className="buyer-card-label">Effective status</span><StatusBadge status={bid.effective_status} label={bid.effective_status === 'open' ? 'Bidding open' : bid.effective_status === 'closed' ? 'Bidding closed' : undefined} /></div>
      <div className="buyer-board-card-vessel"><p className="eyebrow">Vessel / voyage</p><h3 id={headingId}>{bid.vessel_voyage}</h3><p className="buyer-board-port">{bid.port_name}</p></div>
    </header>
    <dl className="buyer-board-summary">
      <div><dt>Delivery window</dt><dd>{bid.delivery_window}</dd></div>
      <div className="buyer-board-deadline"><dt>Deadline</dt><dd>{date(bid.deadline_at)}{remaining !== 'No deadline' ? <span className={`deadline-countdown${remaining === 'Expired' ? ' is-expired' : ''}`} title="Remaining time is advisory only" aria-label={`Remaining time: ${remaining}, advisory only`}>({remaining})</span> : null}</dd></div>
      <div><dt>Responsible BUYER</dt><dd>{bid.responsible_buyer_label}</dd></div>
      <div className="buyer-board-fuels"><dt>Fuel request</dt><dd>{bid.fuel_items.map((item) => <span key={item.fuel_grade}><strong>{item.fuel_grade.toUpperCase()}</strong> {number(item.quantity_mt)} MT</span>)}</dd></div>
    </dl>
    <section className="buyer-board-quotes" aria-label={`SELLER comparison for ${bid.vessel_voyage}`}>
      <div className="buyer-board-quotes-heading"><h4>Buyer-visible comparison</h4>{sellerState.status === 'success' ? <span>{sellers.length} SELLER{sellers.length === 1 ? '' : 's'} · {currentQuoteCount} current quote{currentQuoteCount === 1 ? '' : 's'}</span> : null}</div>
      {sellerState.status === 'loading' ? <p className="buyer-board-quote-state" role="status">Loading SELLER comparison…</p>
        : sellerState.status === 'error' ? <p className="buyer-board-quote-state is-error" role="status">SELLER comparison temporarily unavailable. Refresh to try again.</p>
          : sellers.length === 0 ? <p className="buyer-board-quote-state">No SELLER participants</p>
            : <div className="buyer-board-quote-scroll" tabIndex={0} role="region" aria-label={`SELLER comparison table for ${bid.vessel_voyage}`}>
              <table>
                <thead><tr><th scope="col">Rank</th><th scope="col">SELLER</th><th scope="col">Status</th>{bid.fuel_items.map((item) => <th scope="col" key={item.fuel_grade}>{item.fuel_grade.toUpperCase()} ($/MT)</th>)}<th scope="col">Barge fee ($)</th><th scope="col">Total ($)</th></tr></thead>
                <tbody>{sellers.map((seller) => {
                  const quote = seller.quote;
                  const comparisonEligible = quote ? isComparisonEligible(bid, quote) : false;
                  const hasActivePrice = seller.response_status === 'quoted' && quote;
                  const metadata = sellerMetadata(bid, seller, comparisonEligible);
                  const rank = quote ? comparisonRanks.get(quote.id) : undefined;
                  const status = quote?.is_awarded ? 'Awarded' : seller.response_status === 'quoted' ? 'Quoted' : seller.response_status === 'gave_up' ? 'Gave up' : 'Awaiting';
                  const showSelect = !readOnly && !!quote && seller.response_status === 'quoted' && (bid.effective_status === 'open' || bid.effective_status === 'closed');
                  const awardEligible = !!quote
                    && bid.effective_status === 'closed'
                    && bid.awarded_quote_id === null
                    && seller.response_status === 'quoted'
                    && quote.response_status === 'quoted'
                    && seller.access_active
                    && quote.access_active
                    && seller.organization_active
                    && quote.organization_active
                    && quote.eligible_for_award
                    && !quote.is_awarded;
                  const selectTitle = bid.effective_status === 'open'
                    ? 'Selection is available only after bidding closes.'
                    : !awardEligible
                      ? 'This quote is not eligible for award.'
                      : awardPending || awardSubmitting
                        ? 'Another award action is in progress.'
                        : !onAward
                          ? 'Selection is not available in this view.'
                          : `Select ${seller.trader_organization_label}`;
                  const selectReasonId = `buyer-board-select-reason-${bid.id}-${quote?.id ?? seller.trader_organization_id}`;
                  const selectDisabled = !awardEligible || awardPending || awardSubmitting || !onAward;
                  const confirmed = !!quote && confirmedTarget?.quoteId === quote.id;
                  return <Fragment key={seller.trader_organization_id}><tr className={`${quote?.is_awarded ? 'is-awarded ' : ''}${rank === 1 && !quote?.is_awarded ? 'is-lowest-comparison ' : ''}${!quote?.is_awarded && !comparisonEligible ? 'is-comparison-excluded' : ''}`.trim()}>
                  <td className="buyer-board-rank">{quote?.is_awarded ? 'Awarded' : hasActivePrice ? rank === 1 ? <span title={bid.effective_status === 'open' ? 'Lowest current comparison offer' : 'Lowest award-eligible comparison offer'} aria-label={bid.effective_status === 'open' ? 'Lowest current comparison offer' : 'Lowest award-eligible comparison offer'}>1</span> : rank ?? '—' : '—'}</td>
                  <th scope="row"><strong>{seller.trader_organization_label}</strong>{metadata ? <small>{metadata}</small> : null}</th>
                  <td className={`buyer-board-seller-status status-${seller.response_status}`}>{status}</td>
                  {bid.fuel_items.map((item) => <td key={item.fuel_grade}>{hasActivePrice ? quotePrice(quote, item.fuel_grade) : '—'}</td>)}
                  <td>{hasActivePrice ? money(quote.barge_fee) : '—'}</td><td className="buyer-board-total">{hasActivePrice ? <><span>{money(quote.total_amount)}</span><small>Server total</small>{showSelect ? <><button type="button" className="buyer-board-select" aria-label={`Select ${seller.trader_organization_label}`} aria-describedby={selectDisabled ? selectReasonId : undefined} title={selectTitle} disabled={selectDisabled} onClick={() => setAwardConfirmation({ bidId: bid.id, bidRevision: bid.revision, quoteId: quote.id, quoteRevision: quote.revision, sellerLabel: seller.trader_organization_label, authoritativeTotal: quote.total_amount, signature: awardTargetSignature(bid, seller) })}>Select</button>{selectDisabled ? <span className="visually-hidden" id={selectReasonId}>{selectTitle}</span> : null}</> : null}</> : '—'}</td>
                </tr>{confirmed ? <tr className="buyer-board-award-confirmation-row"><td colSpan={bid.fuel_items.length + 5}><div className="buyer-board-award-confirmation" role="group" aria-label={`Confirm ${confirmedTarget.sellerLabel} selection`}>
                  <div><strong>Select {confirmedTarget.sellerLabel}</strong><span>Authoritative total: {money(confirmedTarget.authoritativeTotal)}</span><span>BID revision {confirmedTarget.bidRevision} · Quote revision {confirmedTarget.quoteRevision}</span><small>This selection is final in V1.1. There is no unaward or replacement.</small></div>
                  <div className="buyer-board-award-confirmation-actions"><button type="button" disabled={awardPending || awardSubmitting} onClick={() => void confirmAward()}>Confirm selection</button><button type="button" className="secondary" disabled={awardPending || awardSubmitting} onClick={() => setAwardConfirmation(null)}>Keep reviewing</button></div>
                </div></td></tr> : null}</Fragment>;
                })}</tbody>
              </table>
            </div>}
    </section>
    {bid.effective_status === 'awarded' && bid.awarded_trader_organization_label && bid.awarded_total_amount !== null
      ? <div className="buyer-board-result is-awarded"><span>Awarded result · authoritative</span><strong>{bid.awarded_trader_organization_label} · {money(bid.awarded_total_amount)}</strong><small>Manual server-authorized award; not an automatic lowest-price selection.</small></div>
      : sellerState.status === 'success' && sellers.length > 0 ? <AdvisoryComparison bid={bid} quotes={quotes} /> : null}
    <footer className="buyer-board-card-footer">
      <span>Revision {bid.revision}</span>
      {reorder ? <div className="buyer-bid-reorder-controls" aria-label={`Reorder ${bid.vessel_voyage}`}>
        <button type="button" className="secondary" disabled={!reorder.enabled || !reorder.canMoveEarlier} onClick={reorder.onMoveEarlier}>Move earlier</button>
        <button type="button" className="secondary" disabled={!reorder.enabled || !reorder.canMoveLater} onClick={reorder.onMoveLater}>Move later</button>
      </div> : null}
      <button type="button" aria-pressed={selected} onClick={onManage}>{readOnly ? selected ? 'Viewing history' : 'View history' : selected ? 'Managing bid' : 'Manage bid'}</button>
    </footer>
  </article>;
}
