import { useCallback, useEffect, useRef, useState } from 'react';
import type { BiddingClient, BiddingResult, BidInput } from './bidding-client';
import { CreateBidForm } from './bid-form';
import { BuyerBidDetail } from './buyer-bid-detail';
import type { ActiveBuyer, Bid, BidAuditEvent, BidTraderAccess, Quote, TraderOrganization, WorkflowError } from './types';
import { StatusBadge, WorkspaceEmptyState, WorkspaceSummary } from '../ui/workspace-ui';

type View = 'all' | 'created_by_me' | 'responsible_buyer';
type Detail = { access: BidTraderAccess[]; quotes: Quote[]; audit: BidAuditEvent[] };
const views: { value: View; label: string }[] = [
  { value: 'all', label: 'All bids' },
  { value: 'created_by_me', label: 'Created by me' },
  { value: 'responsible_buyer', label: 'By BUYER' },
];
const quoteSort = (a: Quote, b: Quote) => Number(b.is_awarded) - Number(a.is_awarded) || a.total_amount - b.total_amount || a.id.localeCompare(b.id);
const unknownError: WorkflowError = { kind: 'unknown', code: null, message: 'The request could not be completed. Please try again.' };
const displayDate = (value: string | null) => value ? new Date(value).toLocaleString() : 'No deadline';

export function BuyerWorkspace({ client, membershipId, onAuthorizationFailure, reloadVersion = 0 }: { client: BiddingClient; membershipId: string; onAuthorizationFailure: () => void; reloadVersion?: number }) {
  const listOperation = useRef(0); const detailOperation = useRef(0); const mutationOperation = useRef(0); const selectedRef = useRef<Bid | null>(null);
  const [buyers, setBuyers] = useState<ActiveBuyer[]>([]); const [organizations, setOrganizations] = useState<TraderOrganization[]>([]); const [bids, setBids] = useState<Bid[]>([]); const [view, setView] = useState<View>('all'); const [responsible, setResponsible] = useState(''); const [selected, setSelected] = useState<Bid | null>(null); const [detail, setDetail] = useState<Detail | null>(null); const [error, setError] = useState<WorkflowError | null>(null); const [loading, setLoading] = useState(true); const [pending, setPending] = useState(false);
  const clearVisible = useCallback(() => { selectedRef.current = null; setBids([]); setSelected(null); setDetail(null); }, []);
  const clearProtected = useCallback(() => { clearVisible(); setBuyers([]); setOrganizations([]); }, [clearVisible]);
  const invalidateOperations = useCallback(() => { ++listOperation.current; ++detailOperation.current; ++mutationOperation.current; }, []);
  const handleError = useCallback((next: WorkflowError) => {
    if (next.kind === 'authorization') {
      invalidateOperations();
      clearProtected();
      setError(next);
      setLoading(false);
      onAuthorizationFailure();
      return;
    }
    setError(next);
  }, [clearProtected, invalidateOperations, onAuthorizationFailure]);
  const loadDetail = useCallback(async (bid: Bid) => {
    const operation = ++detailOperation.current;
    selectedRef.current = bid;
    setSelected(bid);
    setDetail(null);
    try {
      const [access, quotes, audit] = await Promise.all([client.listBidTraderAccess(membershipId, bid.id), client.listQuotesForBuyers(membershipId, bid.id), client.listBidAudit(membershipId, bid.id)]);
      if (operation !== detailOperation.current || selectedRef.current?.id !== bid.id) return false;
      const failure = access.error ?? quotes.error ?? audit.error;
      if (failure) { handleError(failure); return false; }
      setDetail({ access: access.data ?? [], quotes: [...(quotes.data ?? [])].sort(quoteSort), audit: audit.data ?? [] });
      return true;
    } catch {
      if (operation === detailOperation.current) { setDetail(null); handleError(unknownError); }
      return false;
    }
  }, [client, handleError, membershipId]);
  const loadList = useCallback(async (nextView: View, target?: string, retainId?: string, errorAfterReload?: WorkflowError) => {
    const keep = retainId ?? selectedRef.current?.id;
    const operation = ++listOperation.current;
    ++detailOperation.current;
    clearVisible();
    setLoading(nextView !== 'responsible_buyer' || !!target);
    setError(null);
    if (nextView === 'responsible_buyer' && !target) {
      setLoading(false);
      return false;
    }
    try {
      const [buyerResult, bidResult, orgResult] = await Promise.all([client.listActiveBuyers(membershipId), client.listBids(membershipId, nextView, nextView === 'responsible_buyer' ? target : undefined), client.listActiveTraderOrganizations(membershipId)]);
      if (operation !== listOperation.current) return false;
      const failure = buyerResult.error ?? bidResult.error ?? orgResult.error;
      if (failure) { handleError(failure); if (operation === listOperation.current) setLoading(false); return false; }
      const nextBids = bidResult.data ?? [];
      setBuyers(buyerResult.data ?? []);
      setOrganizations(orgResult.data ?? []);
      setBids(nextBids);
      setLoading(false);
      const nextSelected = keep ? nextBids.find((bid) => bid.id === keep) : undefined;
      if (nextSelected) void loadDetail(nextSelected);
      setError(errorAfterReload ?? null);
      return true;
    } catch {
      if (operation === listOperation.current) { clearVisible(); handleError(unknownError); setLoading(false); }
      return false;
    }
  }, [clearVisible, client, handleError, loadDetail, membershipId]);
  useEffect(() => { void loadList('all'); return invalidateOperations; }, [invalidateOperations, loadList]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const reloadRef = useRef<() => void>(() => {});
  reloadRef.current = () => { void loadList(view, responsible || undefined, selectedRef.current?.id); };
  useEffect(() => { if (reloadVersion > 0) reloadRef.current(); }, [reloadVersion]);
  const refresh = () => void loadList(view, responsible || undefined, selectedRef.current?.id);
  const mutate = async (operation: () => Promise<BiddingResult<Bid>>) => {
    const mutation = ++mutationOperation.current;
    setPending(true); setError(null);
    let result: BiddingResult<Bid>;
    try { result = await operation(); } catch { result = { data: null, error: unknownError }; }
    if (mutation !== mutationOperation.current) return false;
    setPending(false);
    if (result.error) {
      const retainId = selectedRef.current?.id;
      if (result.error.kind === 'conflict' || result.error.kind === 'lifecycle' || result.error.kind === 'not_found') {
        await loadList(view, responsible || undefined, retainId, result.error);
        return false;
      }
      handleError(result.error);
      return false;
    }
    return loadList(view, responsible || undefined, selectedRef.current?.id);
  };
  const create = async (input: BidInput) => mutate(() => client.createBid(membershipId, input));
  const changeView = (next: View) => { setView(next); setResponsible(''); void loadList(next); };
  const effectiveOpenCount = bids.filter((bid) => bid.effective_status === 'open').length;
  const terminalCount = bids.length - effectiveOpenCount;
  return <div className="workspace buyer-workspace">
    <WorkspaceSummary
      eyebrow="BUYER operations"
      title="Bid management"
      summary={<span className="buyer-summary-metrics"><span><strong>{bids.length}</strong> total bids</span><span><strong>{effectiveOpenCount}</strong> effective open</span><span><strong>{terminalCount}</strong> closed / terminal</span></span>}
      action={<button type="button" className="secondary" onClick={refresh} disabled={loading || pending}>Refresh</button>}
    />
    {error ? <p className="notice error" role="alert">{error.message}</p> : null}
    <section className="panel filters buyer-filters" aria-label="Bid filters">
      <fieldset>
        <legend>Bid view</legend>
        <div className="buyer-filter-options">
          {views.map((option) => <label key={option.value}><input type="radio" name="bid-view" checked={view === option.value} onChange={() => changeView(option.value)} /> <span>{option.label}</span></label>)}
        </div>
      </fieldset>
      {view === 'responsible_buyer' ? <label className="buyer-filter-select">Responsible BUYER<select aria-label="Responsible BUYER filter" value={responsible} onChange={(event) => { const target = event.target.value; setResponsible(target); if (target) void loadList('responsible_buyer', target); }}><option value="">Select an active BUYER</option>{buyers.map((buyer) => <option value={buyer.user_id} key={buyer.user_id}>{buyer.display_label}</option>)}</select></label> : null}
    </section>
    <CreateBidForm buyers={buyers} disabled={pending} onSubmit={create} />
    <section className="bid-layout buyer-bid-layout">
      <section className="panel bid-list buyer-bid-list">
        <div className="buyer-list-heading"><div><p className="eyebrow">Current view</p><h2>Bids</h2></div><span>{bids.length} loaded</span></div>
        {loading ? <WorkspaceEmptyState title="Loading bids" description="Retrieving the current bid list." /> : view === 'responsible_buyer' && !responsible ? <WorkspaceEmptyState title="Select a BUYER to load responsible bids." description="Choose an active BUYER to view their responsible bids." /> : bids.length === 0 ? <WorkspaceEmptyState title="No bids in this view" description="Try another view or refresh the current bid list." /> : <div className="buyer-bid-cards">{bids.map((bid) => {
          const isSelected = selected?.id === bid.id;
          return <button type="button" className={`bid-button buyer-bid-card${isSelected ? ' is-selected' : ''}`} aria-pressed={isSelected} key={bid.id} onClick={() => void loadDetail(bid)}>
            <span className="buyer-bid-card-heading"><span><strong>{bid.vessel_voyage}</strong><span className="buyer-bid-port">{bid.port_name}</span></span><StatusBadge status={bid.effective_status} label="Effective status" /></span>
            <span className="buyer-bid-card-secondary">
              <span><span className="buyer-card-label">Deadline</span>{displayDate(bid.deadline_at)}</span>
              <span><span className="buyer-card-label">Responsible BUYER</span>{bid.responsible_buyer_label}</span>
              <span><span className="buyer-card-label">Fuel request</span>{bid.fuel_items.map((item) => `${item.fuel_grade.toUpperCase()} ${item.quantity_mt}`).join(', ')}</span>
            </span>
            <span className="buyer-bid-card-metadata">
              <span>Creator: {bid.created_by_label}</span>
              <span>Raw status: {bid.raw_status}</span>
              <span>Revision {bid.revision}</span>
              {bid.awarded_trader_organization_label ? <span className="buyer-bid-award">Awarded to {bid.awarded_trader_organization_label}; total {bid.awarded_total_amount}</span> : null}
            </span>
          </button>;
        })}</div>}
      </section>
      <section className="panel bid-detail buyer-bid-detail" aria-live="polite">{selected ? <BuyerBidDetail key={`${selected.id}:${selected.revision}`} bid={selected} buyers={buyers} organizations={organizations} detail={detail} pending={pending} client={client} membershipId={membershipId} mutate={mutate} refresh={() => void loadDetail(selected)} /> : <WorkspaceEmptyState title="No bid selected" description="Select a bid to view operations, quotes, scope, and audit history." />}</section>
    </section>
  </div>;
}
