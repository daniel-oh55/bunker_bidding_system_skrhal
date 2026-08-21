import { useEffect, useState } from 'react';
import type { BiddingClient, BiddingResult } from './bidding-client';
import { FuelRows } from './bid-form';
import { isoToLocalInput, localInputToIso } from './datetime';
import { fuelGrades, type ActiveBuyer, type Bid, type BidAuditEvent, type BidTraderAccess, type Quote, type TraderOrganization } from './types';
import { StatusBadge } from '../ui/workspace-ui';

type Detail = { access: BidTraderAccess[]; quotes: Quote[]; audit: BidAuditEvent[] };
type Row = { grade: typeof fuelGrades[number]; quantity: string };
type AwardConfirmation = { quoteId: string; quoteRevision: number; signature: string };
type RevokeConfirmation = { bidId: string; bidRevision: number; traderOrganizationId: string; accessSignature: string };

const number = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'No deadline';
const remainingTime = (deadline: string | null, nowMs: number) => {
  if (!deadline) return 'No deadline';
  const remainingSeconds = Math.ceil((new Date(deadline).getTime() - nowMs) / 1000);
  if (remainingSeconds <= 0) return 'Expired';
  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m ${seconds}s remaining`;
};
const updateInput = (draft: { vessel: string; port: string; window: string; deadline: string; rows: Row[] }) => ({
  vesselVoyage: draft.vessel,
  portName: draft.port,
  deliveryWindow: draft.window,
  deadlineAt: localInputToIso(draft.deadline),
  fuelGrades: draft.rows.map((row) => row.grade),
  quantities: draft.rows.map((row) => Number(row.quantity)),
});
const accessSignature = (access: BidTraderAccess[] | undefined) => access?.map((entry) => `${entry.trader_organization_id}:${entry.granted_at}`).sort().join('|') ?? '';
const quotePrice = (quote: Quote, grade: typeof fuelGrades[number]) => {
  const price = quote.fuel_prices.find((candidate) => candidate.fuel_grade === grade);
  return price ? number(price.unit_price) : '—';
};

function buyerLabel(id: string | null, buyers: ActiveBuyer[]) {
  if (id === null) return 'None';
  return buyers.find((buyer) => buyer.user_id === id)?.display_label ?? `Unknown or inactive BUYER · …${id.slice(-4)}`;
}

export function BuyerBidDetail({ bid, buyers, organizations, detail, pending, client, membershipId, mutate, refresh, currentTimeMs = Date.now() }: {
  bid: Bid;
  buyers: ActiveBuyer[];
  organizations: TraderOrganization[];
  detail: Detail | null;
  pending: boolean;
  client: BiddingClient;
  membershipId: string;
  mutate: (operation: () => Promise<BiddingResult<Bid>>) => Promise<boolean>;
  refresh: () => void;
  currentTimeMs?: number;
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
  const [revokeConfirm, setRevokeConfirm] = useState<RevokeConfirmation | null>(null);
  const quoteSignature = detail?.quotes.map((quote) => `${quote.id}:${quote.revision}`).sort().join('|') ?? '';
  const currentAccessSignature = accessSignature(detail?.access);

  useEffect(() => {
    setAwardConfirm(null);
  }, [quoteSignature]);

  useEffect(() => {
    setRevokeConfirm(null);
  }, [bid.id, bid.revision, currentAccessSignature]);

  const commercialOpen = detail !== null && detail.quotes.length === 0 && bid.effective_status === 'open';
  const deadlineOpen = bid.effective_status === 'open';
  const validRows = draft.rows.length > 0 && draft.rows.every((row) => Number.isFinite(Number(row.quantity)) && Number(row.quantity) > 0);
  const termsOpen = bid.effective_status === 'open';
  const revokeIsCurrent = (confirmation: RevokeConfirmation | null) => confirmation !== null
    && confirmation.bidId === bid.id
    && confirmation.bidRevision === bid.revision
    && confirmation.accessSignature === currentAccessSignature
    && detail?.access.some((access) => access.trader_organization_id === confirmation.traderOrganizationId) === true;
  const confirmRevoke = () => {
    if (revokeConfirm === null || !revokeIsCurrent(revokeConfirm) || pending) return;
    const confirmation = revokeConfirm;
    setRevokeConfirm(null);
    void mutate(() => client.revokeBidTraderAccess(membershipId, bid.id, bid.revision, confirmation.traderOrganizationId));
  };
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

  return <div className="buyer-detail-content">
    <div className="bid-overview">
      <div className="buyer-overview-heading">
        <div><p className="eyebrow">Selected bid</p><h2>{bid.vessel_voyage}</h2></div>
        <StatusBadge status={bid.effective_status} label="Effective status" />
      </div>
      <dl className="operational-data">
        <div><dt>Port</dt><dd>{bid.port_name}</dd></div>
        <div><dt>Delivery window</dt><dd>{bid.delivery_window}</dd></div>
        <div><dt>Raw status</dt><dd>{bid.raw_status}</dd></div>
        <div><dt>Deadline</dt><dd>{date(bid.deadline_at)}</dd></div>
        <div><dt>Remaining time</dt><dd><span className={`deadline-countdown${remainingTime(bid.deadline_at, currentTimeMs) === 'Expired' ? ' is-expired' : ''}`}>{remainingTime(bid.deadline_at, currentTimeMs)}</span><small className="countdown-note">Client clock, advisory only</small></dd></div>
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
      <div className="buyer-detail-form-grid">
        <label>Vessel / voyage<input aria-label="Edit vessel / voyage" disabled={!commercialOpen || pending} value={draft.vessel} onChange={(event) => setDraft({ ...draft, vessel: event.target.value })} /></label>
        <label>Port<input aria-label="Edit port" disabled={!commercialOpen || pending} value={draft.port} onChange={(event) => setDraft({ ...draft, port: event.target.value })} /></label>
        <label>Delivery window<input aria-label="Edit delivery window" disabled={!commercialOpen || pending} value={draft.window} onChange={(event) => setDraft({ ...draft, window: event.target.value })} /></label>
        <label>Deadline<input aria-label="Edit deadline" type="datetime-local" disabled={!deadlineOpen || detail === null || pending} value={draft.deadline} onChange={(event) => setDraft({ ...draft, deadline: event.target.value })} /></label>
      </div>
      <FuelRows rows={draft.rows} onChange={(rows) => setDraft({ ...draft, rows })} disabled={!commercialOpen || pending} />
      <div className="buyer-action-row"><button type="button" disabled={!deadlineOpen || detail === null || !validRows || pending} onClick={saveBid}>Save bid</button></div>
    </details>

    <details className="detail-section">
      <summary>Responsibility &amp; lifecycle</summary>
      <section className="buyer-operation-group" aria-labelledby="buyer-responsibility-heading">
        <h3 id="buyer-responsibility-heading">Responsibility</h3>
        <p className="buyer-section-helper">Assignment supports operational filtering; server authorization remains authoritative.</p>
        <div className="buyer-action-row buyer-action-row-field">
          <select aria-label="Assign responsible BUYER" disabled={pending || bid.raw_status === 'awarded' || bid.raw_status === 'cancelled'} value={responsible} onChange={(event) => setResponsible(event.target.value)}>
            {buyers.map((buyer) => <option key={buyer.user_id} value={buyer.user_id}>{buyer.display_label}</option>)}
          </select>
          <button type="button" disabled={pending || responsible === bid.responsible_buyer_user_id} onClick={() => void mutate(() => client.reassignBid(membershipId, bid.id, bid.revision, responsible))}>Reassign</button>
        </div>
      </section>
      <section className="buyer-operation-group" aria-labelledby="buyer-lifecycle-heading">
        <h3 id="buyer-lifecycle-heading">Lifecycle</h3>
        <div className="buyer-action-row">
          {bid.raw_status === 'open' ? <button type="button" disabled={pending} onClick={() => void mutate(() => client.closeBid(membershipId, bid.id, bid.revision))}>Close</button> : null}
          {(bid.raw_status === 'closed' || (bid.raw_status === 'open' && bid.effective_status === 'closed')) ? <>
            <label>Reopen deadline<input aria-label="Reopen deadline" type="datetime-local" value={draft.deadline} onChange={(event) => setDraft({ ...draft, deadline: event.target.value })} /></label>
            <button type="button" disabled={pending} onClick={() => void mutate(() => client.reopenBid(membershipId, bid.id, bid.revision, localInputToIso(draft.deadline)))}>Reopen</button>
          </> : null}
          {bid.raw_status === 'open' || bid.raw_status === 'closed' ? cancelConfirm
            ? <button type="button" disabled={pending} onClick={() => void mutate(() => client.cancelBid(membershipId, bid.id, bid.revision))}>Confirm cancel</button>
            : <button type="button" className="secondary" disabled={pending} onClick={() => setCancelConfirm(true)}>Cancel bid</button>
            : null}
        </div>
      </section>
    </details>

    <details className="detail-section" open={traderOpen}>
      <summary>TRADER access &amp; quotes</summary>
      <div className="buyer-section-heading"><div><h3>TRADER access</h3><p className="buyer-section-helper">Manage which active organizations can participate in this bid.</p></div>{detail ? <span>{detail.access.length} with access</span> : null}</div>
      {bid.effective_status === 'open' ? <>
        <div className="buyer-action-row buyer-action-row-field">
          <select aria-label="Grant TRADER organization" value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="">Select active TRADER organization</option>
            {organizations.filter((organization) => !detail?.access.some((access) => access.trader_organization_id === organization.organization_id)).map((organization) => <option key={organization.organization_id} value={organization.organization_id}>{organization.organization_label}</option>)}
          </select>
          <button type="button" disabled={!scope || pending || detail === null} onClick={() => void mutate(() => client.grantBidTraderAccess(membershipId, bid.id, bid.revision, scope))}>Grant scope</button>
        </div>
      </> : null}
      <ul className="buyer-access-list">{detail?.access.map((access) => {
        const confirmed = revokeIsCurrent(revokeConfirm) && revokeConfirm?.traderOrganizationId === access.trader_organization_id;
        const confirmationId = `revoke-confirmation-${access.trader_organization_id}`;
        const selectedAwardee = bid.effective_status === 'awarded' && bid.awarded_trader_organization_id === access.trader_organization_id;
        return <li key={access.trader_organization_id}>
          <div className="buyer-access-item"><strong>{access.trader_organization_label}</strong><button type="button" className="secondary" disabled={pending} aria-describedby={confirmed ? confirmationId : undefined} onClick={() => setRevokeConfirm({ bidId: bid.id, bidRevision: bid.revision, traderOrganizationId: access.trader_organization_id, accessSignature: currentAccessSignature })}>Revoke</button></div>
          {confirmed ? <div id={confirmationId} className="revoke-confirmation" role="alert">
            <strong>Revoke access for {access.trader_organization_label}?</strong>
            <p>Revoking access immediately removes this TRADER organization’s bid and quote visibility. BUYER records remain retained.</p>
            {selectedAwardee ? <p className="revoke-award-warning">This is the selected TRADER organization. Revoking access will remove its award-result visibility.</p> : null}
            <div className="revoke-confirmation-actions">
              <button type="button" disabled={pending} onClick={confirmRevoke}>Confirm revoke</button>
              <button type="button" className="secondary" disabled={pending} onClick={() => setRevokeConfirm(null)}>Keep access</button>
            </div>
          </div> : null}
        </li>;
      })}</ul>
      <div className="buyer-section-heading buyer-quotes-heading"><div><h3>Buyer-visible quotes</h3><p className="buyer-section-helper">Compared in the existing authoritative order.</p></div>{detail ? <span>{detail.quotes.length} quotes</span> : null}</div>
      {detail?.quotes.length ? <div className="buyer-quote-board" role="region" aria-label="Buyer quote comparison" tabIndex={0}>
        <table>
          <caption className="visually-hidden"><span>Grade prices</span><span>Authoritative total</span></caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">TRADER organization</th>
              {bid.fuel_items.map((item) => <th scope="col" key={item.fuel_grade}><span>{item.fuel_grade.toUpperCase()} unit price</span><small>{number(item.quantity_mt)} MT requested</small></th>)}
              <th scope="col">Barge fee</th>
              <th scope="col">Authoritative server total</th>
              <th scope="col">Quote revision</th>
              <th scope="col">Award result</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>{detail.quotes.map((quote, index) => {
            const confirmed = awardConfirm?.quoteId === quote.id && awardConfirm.quoteRevision === quote.revision && awardConfirm.signature === quoteSignature;
            const awardResult = quote.is_awarded ? 'Selected / awarded' : bid.effective_status === 'awarded' ? 'Not selected' : 'Pending';
            return <tr className={quote.is_awarded ? 'is-awarded' : undefined} key={quote.id}>
              <td className="buyer-quote-rank" data-label="Rank">{index + 1}</td>
              <th scope="row" data-label="TRADER organization"><strong>{quote.trader_organization_label}</strong><small>Access <span>{quote.access_active ? 'active' : 'revoked'}</span> · Organization <span>{quote.organization_active ? 'active' : 'inactive'}</span></small></th>
              {bid.fuel_items.map((item) => <td data-label={`${item.fuel_grade.toUpperCase()} unit price`} key={item.fuel_grade}>{quotePrice(quote, item.fuel_grade)}</td>)}
              <td data-label="Barge fee">{number(quote.barge_fee)}</td>
              <td className="buyer-quote-total" data-label="Authoritative server total">{number(quote.total_amount)}</td>
              <td data-label="Quote revision">{quote.revision}</td>
              <td data-label="Award result"><span className={`buyer-award-marker${quote.is_awarded ? ' is-selected' : bid.effective_status === 'awarded' ? ' is-not-selected' : ''}`}>{awardResult}</span><small>{quote.eligible_for_award ? 'eligible' : 'ineligible'}</small>{quote.is_awarded ? <span className="visually-hidden">yes</span> : null}</td>
              <td className="buyer-quote-action" data-label="Action"><div className="buyer-action-row">{quote.eligible_for_award && !quote.is_awarded ? confirmed
                ? <button type="button" disabled={pending} onClick={() => void mutate(() => client.awardBid(membershipId, bid.id, bid.revision, quote.id, quote.revision))}>Confirm award</button>
                : <button type="button" disabled={pending} onClick={() => setAwardConfirm({ quoteId: quote.id, quoteRevision: quote.revision, signature: quoteSignature })}>Award</button>
                : null}</div></td>
            </tr>;
          })}</tbody>
        </table>
      </div> : detail ? <p className="buyer-quote-empty">No quotes submitted for this bid.</p> : null}
    </details>

    <details className="detail-section">
      <summary>Audit history</summary>
      <p className="buyer-section-helper">Server-recorded changes in chronological response order.</p>
      <ol className="audit-list buyer-audit-timeline">{detail?.audit.map((event) => <AuditEvent key={event.id} event={event} buyers={buyers} />)}</ol>
    </details>
    <button type="button" className="secondary detail-refresh" onClick={() => { setRevokeConfirm(null); refresh(); }}>Refresh detail</button>
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
