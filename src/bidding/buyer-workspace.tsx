import { useCallback, useEffect, useRef, useState } from 'react';
import type { BiddingClient, BiddingResult, BidInput } from './bidding-client';
import { CreateBidForm } from './bid-form';
import { BuyerBidDetail } from './buyer-bid-detail';
import { MailIntakeQueue } from './mail-intake-queue';
import type { ActiveBuyer, Bid, BidAuditEvent, BidTraderAccess, Quote, TraderOrganization, WorkflowError } from './types';
import { StatusBadge, WorkspaceEmptyState, WorkspaceSummary } from '../ui/workspace-ui';

type View = 'all' | 'created_by_me' | 'responsible_buyer';
type Detail = { access: BidTraderAccess[]; quotes: Quote[]; audit: BidAuditEvent[] };
type CreatorGroup = { creatorId: string; creatorLabel: string; bids: Bid[] };
const views: { value: View; label: string; description: string }[] = [
  { value: 'all', label: 'All bids', description: 'Grouped by creator' },
  { value: 'created_by_me', label: 'Created by me', description: 'Only bids you created' },
  { value: 'responsible_buyer', label: 'By BUYER', description: 'Filter by responsibility' },
];
const quoteSort = (a: Quote, b: Quote) => Number(b.is_awarded) - Number(a.is_awarded) || a.total_amount - b.total_amount || a.id.localeCompare(b.id);
const unknownError: WorkflowError = { kind: 'unknown', code: null, message: 'The request could not be completed. Please try again.' };
const displayDate = (value: string | null) => value ? new Date(value).toLocaleString() : 'No deadline';
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
const groupBidsByCreator = (bids: Bid[]) => {
  const groups: CreatorGroup[] = [];
  const groupIndexes = new Map<string, number>();
  for (const bid of bids) {
    const existingIndex = groupIndexes.get(bid.created_by);
    if (existingIndex === undefined) {
      groupIndexes.set(bid.created_by, groups.length);
      groups.push({ creatorId: bid.created_by, creatorLabel: bid.created_by_label, bids: [bid] });
    } else {
      groups[existingIndex]!.bids.push(bid);
    }
  }
  return groups;
};

export function BuyerWorkspace({ client, membershipId, onAuthorizationFailure, reloadVersion = 0 }: { client: BiddingClient; membershipId: string; onAuthorizationFailure: () => void; reloadVersion?: number }) {
  const listOperation = useRef(0); const detailOperation = useRef(0); const mutationOperation = useRef(0); const selectedRef = useRef<Bid | null>(null);
  const [buyers, setBuyers] = useState<ActiveBuyer[]>([]); const [organizations, setOrganizations] = useState<TraderOrganization[]>([]); const [bids, setBids] = useState<Bid[]>([]); const [view, setView] = useState<View>('all'); const [responsible, setResponsible] = useState(''); const [selected, setSelected] = useState<Bid | null>(null); const [detail, setDetail] = useState<Detail | null>(null); const [error, setError] = useState<WorkflowError | null>(null); const [loading, setLoading] = useState(true); const [pending, setPending] = useState(false);
  const [collapsedCreators, setCollapsedCreators] = useState<Record<string, boolean>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
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
  useEffect(() => { const timer = window.setInterval(() => setNowMs(Date.now()), 1_000); return () => window.clearInterval(timer); }, []);
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
  const creatorGroups = view === 'all' ? groupBidsByCreator(bids) : [];
  const renderBidCard = (bid: Bid) => {
    const isSelected = selected?.id === bid.id;
    return <button type="button" className={`bid-button buyer-bid-card${isSelected ? ' is-selected' : ''}`} aria-pressed={isSelected} key={bid.id} onClick={() => void loadDetail(bid)}>
      <span className="buyer-bid-card-heading"><span><span className="buyer-card-label">Vessel / voyage</span><strong>{bid.vessel_voyage}</strong><span className="buyer-bid-port">{bid.port_name}</span></span><span className="buyer-bid-card-status"><span className="buyer-card-label">Effective status</span><StatusBadge status={bid.effective_status} /></span></span>
      <span className="buyer-bid-card-attention">
        <span><span className="buyer-card-label">Deadline</span>{displayDate(bid.deadline_at)}</span>
        <span><span className="buyer-card-label">Remaining time</span><span className={`deadline-countdown${remainingTime(bid.deadline_at, nowMs) === 'Expired' ? ' is-expired' : ''}`}>{remainingTime(bid.deadline_at, nowMs)}</span></span>
      </span>
      <span className="buyer-bid-card-secondary">
        <span><span className="buyer-card-label">Fuel request</span>{bid.fuel_items.map((item) => `${item.fuel_grade.toUpperCase()} ${item.quantity_mt} MT`).join(', ')}</span>
        <span><span className="buyer-card-label">Responsible BUYER</span>{bid.responsible_buyer_label}</span>
      </span>
      {bid.awarded_trader_organization_label ? <span className="buyer-bid-award"><span className="buyer-card-label">Awarded result</span><strong>{bid.awarded_trader_organization_label}</strong><span>Authoritative total {bid.awarded_total_amount}</span></span> : null}
      <span className="buyer-bid-card-metadata">
        <span>Creator: {bid.created_by_label}</span>
        <span>Raw status: {bid.raw_status}</span>
        <span>Revision {bid.revision}</span>
      </span>
    </button>;
  };
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
          {views.map((option) => <label key={option.value}><input type="radio" name="bid-view" aria-label={option.label} checked={view === option.value} onChange={() => changeView(option.value)} /> <span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}
        </div>
      </fieldset>
      {view === 'responsible_buyer' ? <label className="buyer-filter-select">Responsible BUYER<select aria-label="Responsible BUYER filter" value={responsible} onChange={(event) => { const target = event.target.value; setResponsible(target); if (target) void loadList('responsible_buyer', target); }}><option value="">Select an active BUYER</option>{buyers.map((buyer) => <option value={buyer.user_id} key={buyer.user_id}>{buyer.display_label}</option>)}</select></label> : null}
    </section>
    <MailIntakeQueue client={client} membershipId={membershipId} onAuthorizationFailure={onAuthorizationFailure} />
    <CreateBidForm buyers={buyers} disabled={pending} onSubmit={create} />
    <section className="bid-layout buyer-bid-layout">
      <section className="panel bid-list buyer-bid-list">
        <div className="buyer-list-heading"><div><p className="eyebrow">Current view</p><h2>Bids</h2></div><span>{bids.length} loaded</span></div>
        {loading ? <WorkspaceEmptyState title="Loading bids" description="Retrieving the current bid list." /> : view === 'responsible_buyer' && !responsible ? <WorkspaceEmptyState title="Select a BUYER to load responsible bids." description="Choose an active BUYER to view their responsible bids." /> : bids.length === 0 ? <WorkspaceEmptyState title="No bids in this view" description="Try another view or refresh the current bid list." /> : view === 'all' ? <div className="buyer-creator-groups">{creatorGroups.map((group) => {
          const isCollapsed = collapsedCreators[group.creatorId] ?? false;
          const groupContentId = `buyer-creator-bids-${group.creatorId}`;
          const groupOpenCount = group.bids.filter((bid) => bid.effective_status === 'open').length;
          return <section className={`buyer-creator-group${isCollapsed ? ' is-collapsed' : ''}`} aria-label={`Bids created by ${group.creatorLabel}`} key={group.creatorId}>
            <header className="buyer-creator-group-header">
              <div className="buyer-creator-identity"><p className="eyebrow">Bid creator</p><h3>{group.creatorLabel}</h3></div>
              <div className="buyer-creator-group-actions">
                <span className="buyer-creator-group-counts"><span><strong>{group.bids.length}</strong> total bids</span><span><strong>{groupOpenCount}</strong> effective open</span></span>
                <button type="button" className="secondary buyer-creator-toggle" aria-controls={groupContentId} aria-expanded={!isCollapsed} aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} bids created by ${group.creatorLabel}`} onClick={() => setCollapsedCreators((current) => ({ ...current, [group.creatorId]: !current[group.creatorId] }))}><span aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>{isCollapsed ? 'Expand' : 'Collapse'}</button>
              </div>
            </header>
            <div className="buyer-bid-cards buyer-creator-bid-cards" id={groupContentId} hidden={isCollapsed}>{group.bids.map(renderBidCard)}</div>
          </section>;
        })}</div> : <div className="buyer-bid-cards">{bids.map(renderBidCard)}</div>}
      </section>
      <section className="panel bid-detail buyer-bid-detail" aria-live="polite">{selected ? <BuyerBidDetail key={`${selected.id}:${selected.revision}`} bid={selected} buyers={buyers} organizations={organizations} detail={detail} pending={pending} client={client} membershipId={membershipId} mutate={mutate} refresh={() => void loadDetail(selected)} currentTimeMs={nowMs} /> : <WorkspaceEmptyState title="No bid selected" description="Select a bid to view operations, quotes, scope, and audit history." />}</section>
    </section>
  </div>;
}
