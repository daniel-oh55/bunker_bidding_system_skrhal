import { useCallback, useEffect, useRef, useState } from 'react';
import type { BiddingClient, BiddingResult, BidInput, PreparedMailIntakeBidInput } from './bidding-client';
import { CreateBidForm, PreparedMailIntakeBidForm } from './bid-form';
import { BuyerBidBoardCard, type BuyerBidBoardSellerState } from './buyer-bid-board-card';
import { BuyerBidDetail } from './buyer-bid-detail';
import { MailIntakeQueue } from './mail-intake-queue';
import { SellerManagement } from './seller-management';
import type { ActiveBuyer, Bid, BidAuditEvent, BidTraderAccess, MailIntakeItem, Quote, TraderOrganization, WorkflowError } from './types';
import { WorkspaceEmptyState, WorkspaceSummary } from '../ui/workspace-ui';
import { currentSeoulDate } from './datetime';

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
const sellerComparisonConcurrency = 4;
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

export function BuyerWorkspace({ client, membershipId, membershipRole = 'buyer_operator', onAuthorizationFailure, reloadVersion = 0 }: { client: BiddingClient; membershipId: string; membershipRole?: 'buyer_admin' | 'buyer_operator'; onAuthorizationFailure: () => void; reloadVersion?: number }) {
  const listOperation = useRef(0); const detailOperation = useRef(0); const mutationOperation = useRef(0); const selectedRef = useRef<Bid | null>(null); const detailRegionRef = useRef<HTMLElement | null>(null); const detailAttentionBidId = useRef<string | null>(null);
  const [buyers, setBuyers] = useState<ActiveBuyer[]>([]); const [organizations, setOrganizations] = useState<TraderOrganization[]>([]); const [bids, setBids] = useState<Bid[]>([]); const [boardSellers, setBoardSellers] = useState<Record<string, BuyerBidBoardSellerState>>({}); const [view, setView] = useState<View>('all'); const [responsible, setResponsible] = useState(''); const [selectedDate, setSelectedDate] = useState(() => currentSeoulDate()); const [selected, setSelected] = useState<Bid | null>(null); const [detail, setDetail] = useState<Detail | null>(null); const [error, setError] = useState<WorkflowError | null>(null); const [loading, setLoading] = useState(true); const [pending, setPending] = useState(false);
  const [collapsedCreators, setCollapsedCreators] = useState<Record<string, boolean>>({}); const [preparedItem, setPreparedItem] = useState<MailIntakeItem | null>(null); const [mailIntakeReloadVersion, setMailIntakeReloadVersion] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const initialDateRef = useRef(selectedDate);
  const clearVisible = useCallback(() => { detailAttentionBidId.current = null; selectedRef.current = null; setBids([]); setBoardSellers({}); setSelected(null); setDetail(null); }, []);
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
  const loadDetail = useCallback(async (bid: Bid, requestAttention = false) => {
    const operation = ++detailOperation.current;
    selectedRef.current = bid;
    setSelected(bid);
    setDetail(null);
    try {
      const [access, quotes, audit] = await Promise.all([client.listBidTraderAccess(membershipId, bid.id), client.listQuotesForBuyers(membershipId, bid.id), client.listBidAudit(membershipId, bid.id)]);
      if (operation !== detailOperation.current || selectedRef.current?.id !== bid.id) return false;
      const failure = access.error ?? quotes.error ?? audit.error;
      if (failure) { handleError(failure); return false; }
      if (requestAttention) detailAttentionBidId.current = bid.id;
      setDetail({ access: access.data ?? [], quotes: [...(quotes.data ?? [])].sort(quoteSort), audit: audit.data ?? [] });
      return true;
    } catch {
      if (operation === detailOperation.current) { setDetail(null); handleError(unknownError); }
      return false;
    }
  }, [client, handleError, membershipId]);
  useEffect(() => {
    if (detailAttentionBidId.current !== selected?.id || detail === null) return;
    const detailRegion = detailRegionRef.current;
    if (!detailRegion) return;
    detailAttentionBidId.current = null;
    detailRegion.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    detailRegion.focus({ preventScroll: true });
  }, [detail, selected]);
  const loadBoardSellers = useCallback(async (nextBids: Bid[], listGeneration: number) => {
    let cursor = 0;
    const worker = async () => {
      while (cursor < nextBids.length) {
        const bid = nextBids[cursor++];
        if (!bid || listGeneration !== listOperation.current) return;
        try {
          const result = await client.listBidSellerComparisonForBuyers(membershipId, bid.id);
          if (listGeneration !== listOperation.current) return;
          if (result.error?.kind === 'authorization') { handleError(result.error); return; }
          setBoardSellers((current) => ({ ...current, [bid.id]: result.error ? { status: 'error' } : { status: 'success', sellers: result.data ?? [] } }));
        } catch {
          if (listGeneration !== listOperation.current) return;
          setBoardSellers((current) => ({ ...current, [bid.id]: { status: 'error' } }));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(sellerComparisonConcurrency, nextBids.length) }, () => worker()));
  }, [client, handleError, membershipId]);
  const loadList = useCallback(async (nextView: View, nextDate: string, target?: string, retainId?: string, errorAfterReload?: WorkflowError) => {
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
      const [buyerResult, bidResult, orgResult] = await Promise.all([client.listActiveBuyers(membershipId), client.listBids(membershipId, nextDate, nextView, nextView === 'responsible_buyer' ? target : undefined), client.listActiveTraderOrganizations(membershipId)]);
      if (operation !== listOperation.current) return false;
      const failure = buyerResult.error ?? bidResult.error ?? orgResult.error;
      if (failure) { handleError(failure); if (operation === listOperation.current) setLoading(false); return false; }
      const nextBids = (bidResult.data ?? []).filter((bid) => bid.bid_date === nextDate);
      setBuyers(buyerResult.data ?? []);
      setOrganizations(orgResult.data ?? []);
      setBids(nextBids);
      setBoardSellers(Object.fromEntries(nextBids.map((bid) => [bid.id, { status: 'loading' } satisfies BuyerBidBoardSellerState])));
      setLoading(false);
      void loadBoardSellers(nextBids, operation);
      const nextSelected = keep ? nextBids.find((bid) => bid.id === keep) : undefined;
      if (nextSelected) void loadDetail(nextSelected);
      setError(errorAfterReload ?? null);
      return true;
    } catch {
      if (operation === listOperation.current) { clearVisible(); handleError(unknownError); setLoading(false); }
      return false;
    }
  }, [clearVisible, client, handleError, loadBoardSellers, loadDetail, membershipId]);
  useEffect(() => { void loadList('all', initialDateRef.current); return invalidateOperations; }, [invalidateOperations, loadList]);
  useEffect(() => { const timer = window.setInterval(() => setNowMs(Date.now()), 1_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const reloadRef = useRef<() => void>(() => {});
  reloadRef.current = () => { void loadList(view, selectedDate, responsible || undefined, selectedRef.current?.id); };
  useEffect(() => { if (reloadVersion > 0) reloadRef.current(); }, [reloadVersion]);
  const refresh = () => void loadList(view, selectedDate, responsible || undefined, selectedRef.current?.id);
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
        await loadList(view, selectedDate, responsible || undefined, retainId, result.error);
        return false;
      }
      handleError(result.error);
      return false;
    }
    return loadList(view, selectedDate, responsible || undefined, selectedRef.current?.id);
  };
  const create = async (input: BidInput) => mutate(() => client.createBid(membershipId, input));
  const publishPrepared = async (input: PreparedMailIntakeBidInput) => {
    const published = await mutate(() => client.publishMailIntakeBid(membershipId, input));
    if (published) { setPreparedItem(null); setMailIntakeReloadVersion((version) => version + 1); }
    return published;
  };
  const changeView = (next: View) => { setView(next); setResponsible(''); void loadList(next, selectedDate); };
  const changeDate = (nextDate: string) => { setSelectedDate(nextDate); void loadList(view, nextDate, responsible || undefined, selectedRef.current?.id); };
  const todayDate = currentSeoulDate(nowMs);
  const historicalDateSelected = selectedDate !== todayDate;
  const effectiveOpenCount = bids.filter((bid) => bid.effective_status === 'open').length;
  const terminalCount = bids.length - effectiveOpenCount;
  const creatorGroups = view === 'all' ? groupBidsByCreator(bids) : [];
  const renderBidCard = (bid: Bid) => <BuyerBidBoardCard key={bid.id} bid={bid} sellerState={boardSellers[bid.id] ?? { status: 'loading' }} currentTimeMs={nowMs} selected={selected?.id === bid.id} onManage={() => void loadDetail(bid, true)} />;
  return <div className="workspace buyer-workspace">
    <WorkspaceSummary
      eyebrow="BUYER operations"
      title="Bid management"
      summary={<span className="buyer-summary-metrics"><span><strong>{bids.length}</strong> total bids</span><span><strong>{effectiveOpenCount}</strong> effective open</span><span><strong>{terminalCount}</strong> closed / terminal</span></span>}
      action={<button type="button" className="secondary" onClick={refresh} disabled={loading || pending}>Refresh</button>}
    />
    {error ? <p className="notice error" role="alert">{error.message}</p> : null}
    <section className="panel filters buyer-filters" aria-label="Bid filters">
      <label className="buyer-operational-date">Operational date<input aria-label="Operational date" type="date" value={selectedDate} onChange={(event) => { if (event.target.value) changeDate(event.target.value); }} /></label>
      <fieldset>
        <legend>Bid view</legend>
        <div className="buyer-filter-options">
          {views.map((option) => <label key={option.value}><input type="radio" name="bid-view" aria-label={option.label} checked={view === option.value} onChange={() => changeView(option.value)} /> <span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}
        </div>
      </fieldset>
      {view === 'responsible_buyer' ? <label className="buyer-filter-select">Responsible BUYER<select aria-label="Responsible BUYER filter" value={responsible} onChange={(event) => { const target = event.target.value; setResponsible(target); if (target) void loadList('responsible_buyer', selectedDate, target); }}><option value="">Select an active BUYER</option>{buyers.map((buyer) => <option value={buyer.user_id} key={buyer.user_id}>{buyer.display_label}</option>)}</select></label> : null}
    </section>
    {preparedItem ? <PreparedMailIntakeBidForm key={`${preparedItem.id}:${preparedItem.revision}`} item={preparedItem} buyers={buyers} organizations={organizations} disabled={pending} onSubmit={publishPrepared} onClose={() => setPreparedItem(null)} /> : null}
    {historicalDateSelected ? <section className="panel historical-create-notice" role="note"><h2>Create new bid unavailable</h2><p>New BIDs are created only for today’s Seoul operational date ({todayDate}). Select today to create a BID.</p></section> : <CreateBidForm buyers={buyers} disabled={pending} onSubmit={create} />}
    {membershipRole === 'buyer_admin' ? <SellerManagement client={client} membershipId={membershipId} reloadVersion={reloadVersion} onAuthorizationFailure={onAuthorizationFailure} onActiveOrganizationsChanged={() => loadList(view, selectedDate, responsible || undefined, selectedRef.current?.id)} /> : null}
    <MailIntakeQueue client={client} membershipId={membershipId} selectedBidDate={selectedDate} reloadVersion={mailIntakeReloadVersion} onPrepare={setPreparedItem} onAuthorizationFailure={onAuthorizationFailure} />
    <section className="panel buyer-bid-board" aria-label="BUYER operational bid board">
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
    {selected ? <section className="panel bid-detail buyer-bid-detail" aria-label="Selected bid detail" aria-live="polite" ref={detailRegionRef} tabIndex={-1}><BuyerBidDetail key={`${selected.id}:${selected.revision}`} bid={selected} buyers={buyers} organizations={organizations} detail={detail} pending={pending} client={client} membershipId={membershipId} mutate={mutate} refresh={() => void loadDetail(selected)} currentTimeMs={nowMs} /></section> : null}
  </div>;
}
