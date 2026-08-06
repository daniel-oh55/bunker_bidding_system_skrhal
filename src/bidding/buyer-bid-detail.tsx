import { useEffect, useState } from 'react';
import type { BiddingClient, BiddingResult } from './bidding-client';
import { FuelRows } from './bid-form';
import { isoToLocalInput, localInputToIso } from './datetime';
import { fuelGrades, type ActiveBuyer, type Bid, type BidAuditEvent, type BidTraderAccess, type Quote, type TraderOrganization } from './types';

type Detail = { access: BidTraderAccess[]; quotes: Quote[]; audit: BidAuditEvent[] };
type Row = { grade: typeof fuelGrades[number]; quantity: string };
type AwardConfirmation = { quoteId: string; quoteRevision: number; signature: string };

const number = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'No deadline';
const updateInput = (draft: { vessel: string; port: string; window: string; deadline: string; rows: Row[] }) => ({
  vesselVoyage: draft.vessel,
  portName: draft.port,
  deliveryWindow: draft.window,
  deadlineAt: localInputToIso(draft.deadline),
  fuelGrades: draft.rows.map((row) => row.grade),
  quantities: draft.rows.map((row) => Number(row.quantity)),
});

function buyerLabel(id: string | null, buyers: ActiveBuyer[]) {
  if (id === null) return 'None';
  return buyers.find((buyer) => buyer.user_id === id)?.display_label ?? `Unknown or inactive BUYER · …${id.slice(-4)}`;
}

export function BuyerBidDetail({ bid, buyers, organizations, detail, pending, client, membershipId, mutate, refresh }: {
  bid: Bid;
  buyers: ActiveBuyer[];
  organizations: TraderOrganization[];
  detail: Detail | null;
  pending: boolean;
  client: BiddingClient;
  membershipId: string;
  mutate: (operation: () => Promise<BiddingResult<Bid>>) => Promise<boolean>;
  refresh: () => void;
}) {
  const [draft, setDraft] = useState(() => ({
    vessel: bid.vessel_voyage,
    port: bid.port_name,
    window: bid.delivery_window,
    deadline: isoToLocalInput(bid.deadline_at),
    rows: bid.fuel_items.map((item) => ({ grade: item.fuel_grade, quantity: String(item.quantity_mt) })),
  }));
  const [responsible, setResponsible] = useState(bid.responsible_buyer_user_id);
  const [scope, setScope] = useState('');
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [awardConfirm, setAwardConfirm] = useState<AwardConfirmation | null>(null);
  const quoteSignature = detail?.quotes.map((quote) => `${quote.id}:${quote.revision}`).sort().join('|') ?? '';

  useEffect(() => {
    setAwardConfirm(null);
  }, [quoteSignature]);

  const commercialOpen = detail !== null && detail.quotes.length === 0 && bid.effective_status === 'open';
  const deadlineOpen = bid.effective_status === 'open';
  const validRows = draft.rows.length > 0 && draft.rows.every((row) => Number.isFinite(Number(row.quantity)) && Number(row.quantity) > 0);
  const termsOpen = bid.effective_status === 'open';
  const traderOpen = bid.effective_status === 'closed' || bid.effective_status === 'awarded';
  const saveBid = () => {
    const commercialFieldsUnchanged = draft.vessel === bid.vessel_voyage
      && draft.port === bid.port_name
      && draft.window === bid.delivery_window
      && draft.rows.every((row, index) => row.grade === bid.fuel_items[index]?.fuel_grade && Number(row.quantity) === bid.fuel_items[index]?.quantity_mt);
    if (deadlineOpen && validRows && (commercialOpen || commercialFieldsUnchanged)) {
      void mutate(() => client.updateBid(membershipId, bid.id, bid.revision, updateInput(draft)));
    }
  };

  return <div>
    <div className="bid-overview">
      <h2>{bid.vessel_voyage}</h2>
      <dl className="operational-data">
        <div><dt>Port</dt><dd>{bid.port_name}</dd></div>
        <div><dt>Delivery window</dt><dd>{bid.delivery_window}</dd></div>
        <div><dt>Raw status</dt><dd>{bid.raw_status}</dd></div>
        <div><dt>Effective status</dt><dd>{bid.effective_status}</dd></div>
        <div><dt>Deadline</dt><dd>{date(bid.deadline_at)}</dd></div>
        <div><dt>Creator</dt><dd>{bid.created_by_label}</dd></div>
        <div><dt>Responsible BUYER</dt><dd>{bid.responsible_buyer_label}</dd></div>
        <div><dt>Fuel requested</dt><dd>{bid.fuel_items.map((item) => `${item.fuel_grade.toUpperCase()} ${item.quantity_mt}`).join(', ')}</dd></div>
        <div><dt>Revision</dt><dd>{bid.revision}</dd></div>
        {bid.awarded_trader_organization_label ? <>
          <div><dt>Awarded organization</dt><dd>{bid.awarded_trader_organization_label}</dd></div>
          <div><dt>Awarded total</dt><dd>{number(bid.awarded_total_amount ?? 0)}</dd></div>
        </> : null}
      </dl>
    </div>

    <details className="detail-section" open={termsOpen}>
      <summary>Bid terms &amp; deadline</summary>
      {detail === null ? <p>Loading bid detail</p> : detail.quotes.length ? <p className="notice">The first quote freezes commercial terms. Only deadline changes remain available.</p> : <p>Commercial fields are editable until the first quote is retained.</p>}
      <label>Vessel / voyage<input aria-label="Edit vessel / voyage" disabled={!commercialOpen || pending} value={draft.vessel} onChange={(event) => setDraft({ ...draft, vessel: event.target.value })} /></label>
      <label>Port<input aria-label="Edit port" disabled={!commercialOpen || pending} value={draft.port} onChange={(event) => setDraft({ ...draft, port: event.target.value })} /></label>
      <label>Delivery window<input aria-label="Edit delivery window" disabled={!commercialOpen || pending} value={draft.window} onChange={(event) => setDraft({ ...draft, window: event.target.value })} /></label>
      <label>Deadline<input aria-label="Edit deadline" type="datetime-local" disabled={!deadlineOpen || detail === null || pending} value={draft.deadline} onChange={(event) => setDraft({ ...draft, deadline: event.target.value })} /></label>
      <FuelRows rows={draft.rows} onChange={(rows) => setDraft({ ...draft, rows })} disabled={!commercialOpen || pending} />
      <button type="button" disabled={!deadlineOpen || detail === null || !validRows || pending} onClick={saveBid}>Save bid</button>
    </details>

    <details className="detail-section">
      <summary>Responsibility &amp; lifecycle</summary>
      <h3>Responsibility</h3>
      <select aria-label="Assign responsible BUYER" disabled={pending || bid.raw_status === 'awarded' || bid.raw_status === 'cancelled'} value={responsible} onChange={(event) => setResponsible(event.target.value)}>
        {buyers.map((buyer) => <option key={buyer.user_id} value={buyer.user_id}>{buyer.display_label}</option>)}
      </select>
      <button type="button" disabled={pending || responsible === bid.responsible_buyer_user_id} onClick={() => void mutate(() => client.reassignBid(membershipId, bid.id, bid.revision, responsible))}>Reassign</button>
      <h3>Lifecycle</h3>
      {bid.raw_status === 'open' ? <button type="button" disabled={pending} onClick={() => void mutate(() => client.closeBid(membershipId, bid.id, bid.revision))}>Close</button> : null}
      {(bid.raw_status === 'closed' || (bid.raw_status === 'open' && bid.effective_status === 'closed')) ? <>
        <label>Reopen deadline<input aria-label="Reopen deadline" type="datetime-local" value={draft.deadline} onChange={(event) => setDraft({ ...draft, deadline: event.target.value })} /></label>
        <button type="button" disabled={pending} onClick={() => void mutate(() => client.reopenBid(membershipId, bid.id, bid.revision, localInputToIso(draft.deadline)))}>Reopen</button>
      </> : null}
      {bid.raw_status === 'open' || bid.raw_status === 'closed' ? cancelConfirm
        ? <button type="button" disabled={pending} onClick={() => void mutate(() => client.cancelBid(membershipId, bid.id, bid.revision))}>Confirm cancel</button>
        : <button type="button" className="secondary" disabled={pending} onClick={() => setCancelConfirm(true)}>Cancel bid</button>
        : null}
    </details>

    <details className="detail-section" open={traderOpen}>
      <summary>TRADER access &amp; quotes</summary>
      <h3>TRADER access</h3>
      {bid.effective_status === 'open' ? <>
        <select aria-label="Grant TRADER organization" value={scope} onChange={(event) => setScope(event.target.value)}>
          <option value="">Select active TRADER organization</option>
          {organizations.filter((organization) => !detail?.access.some((access) => access.trader_organization_id === organization.organization_id)).map((organization) => <option key={organization.organization_id} value={organization.organization_id}>{organization.organization_label}</option>)}
        </select>
        <button type="button" disabled={!scope || pending || detail === null} onClick={() => void mutate(() => client.grantBidTraderAccess(membershipId, bid.id, bid.revision, scope))}>Grant scope</button>
      </> : null}
      <ul>{detail?.access.map((access) => <li key={access.trader_organization_id}>{access.trader_organization_label} <button type="button" className="secondary" disabled={pending} onClick={() => void mutate(() => client.revokeBidTraderAccess(membershipId, bid.id, bid.revision, access.trader_organization_id))}>Revoke</button></li>)}</ul>
      <h3>Buyer-visible quotes</h3>
      <ul className="quote-list">{detail?.quotes.map((quote) => {
        const confirmed = awardConfirm?.quoteId === quote.id && awardConfirm.quoteRevision === quote.revision && awardConfirm.signature === quoteSignature;
        return <li key={quote.id}>
          <dl className="operational-data">
            <div><dt>TRADER organization</dt><dd>{quote.trader_organization_label}</dd></div>
            <div><dt>Grade prices</dt><dd>{quote.fuel_prices.map((price) => `${price.fuel_grade.toUpperCase()} ${number(price.unit_price)}`).join(', ')}</dd></div>
            <div><dt>Barge fee</dt><dd>{number(quote.barge_fee)}</dd></div>
            <div><dt>Authoritative total</dt><dd>{number(quote.total_amount)}</dd></div>
            <div><dt>Quote revision</dt><dd>{quote.revision}</dd></div>
            <div><dt>Access</dt><dd>{quote.access_active ? 'active' : 'revoked'}</dd></div>
            <div><dt>Organization</dt><dd>{quote.organization_active ? 'active' : 'inactive'}</dd></div>
            <div><dt>Award eligibility</dt><dd>{quote.eligible_for_award ? 'eligible' : 'ineligible'}</dd></div>
            <div><dt>Awarded</dt><dd>{quote.is_awarded ? 'yes' : 'no'}</dd></div>
          </dl>
          {quote.eligible_for_award && !quote.is_awarded ? confirmed
            ? <button type="button" disabled={pending} onClick={() => void mutate(() => client.awardBid(membershipId, bid.id, bid.revision, quote.id, quote.revision))}>Confirm award</button>
            : <button type="button" disabled={pending} onClick={() => setAwardConfirm({ quoteId: quote.id, quoteRevision: quote.revision, signature: quoteSignature })}>Award</button>
            : null}
        </li>;
      })}</ul>
    </details>

    <details className="detail-section">
      <summary>Audit history</summary>
      <ol className="audit-list">{detail?.audit.map((event) => <AuditEvent key={event.id} event={event} buyers={buyers} />)}</ol>
    </details>
    <button type="button" className="secondary detail-refresh" onClick={refresh}>Refresh detail</button>
  </div>;
}

function AuditEvent({ event, buyers }: { event: BidAuditEvent; buyers: ActiveBuyer[] }) {
  return <li><dl className="operational-data">
    <div><dt>Event type</dt><dd>{event.event_type}</dd></div>
    <div><dt>Occurred</dt><dd>{date(event.occurred_at)}</dd></div>
    <div><dt>Actor role</dt><dd>{event.actor_role}</dd></div>
    <div><dt>Revision</dt><dd>{event.prior_revision ?? 'none'} to {event.resulting_revision}</dd></div>
    <div><dt>Status</dt><dd>{event.prior_status ?? 'none'} to {event.resulting_status}</dd></div>
    {event.prior_responsible_buyer_user_id !== event.resulting_responsible_buyer_user_id ? <div><dt>Responsible BUYER transition</dt><dd>{buyerLabel(event.prior_responsible_buyer_user_id, buyers)} to {buyerLabel(event.resulting_responsible_buyer_user_id, buyers)}</dd></div> : null}
  </dl></li>;
}
