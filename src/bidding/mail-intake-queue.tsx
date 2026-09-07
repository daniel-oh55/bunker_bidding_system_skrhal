import { useCallback, useEffect, useRef, useState } from 'react';
import type { BiddingClient, PreparedMailIntakeBidInput } from './bidding-client';
import type { MailIntakeItem, WorkflowError } from './types';
import { WorkspaceEmptyState } from '../ui/workspace-ui';
import { defaultPublishDeadlineInput, localInputToIso, seoulDateFromInstant } from './datetime';

type Target = { id: string; revision: number };
const unknownError: WorkflowError = { kind: 'unknown', code: null, message: 'The request could not be completed. Please try again.' };
const displayCandidate = (value: string | null) => value ?? 'Not extracted';
const displayError = (error: WorkflowError) => {
  if (error.kind === 'authorization') return 'Your authorization changed. Access is being verified again.';
  if (error.kind === 'conflict') return 'This mail intake item changed elsewhere. The latest pending queue was loaded.';
  if (error.kind === 'lifecycle') return 'This mail intake item is no longer pending. The latest pending queue was loaded.';
  if (error.kind === 'not_found') return 'This mail intake item no longer exists. The latest pending queue was loaded.';
  if (error.kind === 'protocol') return 'The server returned an invalid response. Mail intake data was not displayed.';
  if (error.kind === 'validation') return 'The mail intake request was rejected. Refresh and review the current item.';
  return 'The mail intake request could not be completed. Please try again.';
};
const isCompleteCandidate = (item: MailIntakeItem) => !!item.vessel_voyage && !!item.port_name && !!item.delivery_window && item.fuel_items.length > 0;

export function MailIntakeQueue({ client, membershipId, selectedBidDate, reloadVersion = 0, canEdit = true, editUnavailableMessage, canPublish = true, publishUnavailableMessage, activeSellerOrganizationIds = [], onPrepare = () => {}, onPublish = () => Promise.resolve(false), onAuthorizationFailure }: { client: BiddingClient; membershipId: string; selectedBidDate: string; reloadVersion?: number; canEdit?: boolean; editUnavailableMessage?: string; canPublish?: boolean; publishUnavailableMessage?: string; activeSellerOrganizationIds?: string[]; onPrepare?: (item: MailIntakeItem) => void; onPublish?: (input: PreparedMailIntakeBidInput) => Promise<boolean>; onAuthorizationFailure: () => void }) {
  const operation = useRef(0);
  const [items, setItems] = useState<MailIntakeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<WorkflowError | null>(null);
  const [dismissTarget, setDismissTarget] = useState<Target | null>(null);
  const [publishTarget, setPublishTarget] = useState<Target | null>(null);
  const clearTargets = useCallback(() => { setDismissTarget(null); setPublishTarget(null); }, []);
  const invalidate = useCallback(() => { ++operation.current; }, []);
  const failAuthorization = useCallback((nextError: WorkflowError) => { invalidate(); setItems([]); clearTargets(); setLoading(false); setPending(false); setError(nextError); onAuthorizationFailure(); }, [clearTargets, invalidate, onAuthorizationFailure]);
  const load = useCallback(async (errorAfterReload?: WorkflowError) => {
    const currentOperation = ++operation.current;
    clearTargets(); setPending(false); setLoading(true); setError(null);
    let result;
    try { result = await client.listMailIntakeItems(membershipId); } catch { result = { data: null, error: unknownError }; }
    if (currentOperation !== operation.current) return false;
    if (result.error) { if (result.error.kind === 'authorization') { failAuthorization(result.error); return false; } setItems([]); setLoading(false); setError(errorAfterReload ?? result.error); return false; }
    setItems(result.data ?? []); setLoading(false); setError(errorAfterReload ?? null); return true;
  }, [clearTargets, client, failAuthorization, membershipId]);
  useEffect(() => { void load(); return invalidate; }, [invalidate, load]);
  useEffect(() => { clearTargets(); }, [clearTargets, selectedBidDate]);
  useEffect(() => { if (reloadVersion > 0) void load(); }, [load, reloadVersion]);
  const dismiss = async (target: Target) => {
    const item = items.find((candidate) => candidate.id === target.id && candidate.revision === target.revision);
    if (!item) { setDismissTarget(null); return; }
    const currentOperation = ++operation.current;
    clearTargets(); setPending(true); setError(null);
    let result;
    try { result = await client.dismissMailIntakeItem(membershipId, item.id, item.revision); } catch { result = { data: null, error: unknownError }; }
    if (currentOperation !== operation.current) return;
    setPending(false);
    if (result.error) { if (result.error.kind === 'authorization') { failAuthorization(result.error); return; } if (result.error.kind === 'conflict' || result.error.kind === 'lifecycle' || result.error.kind === 'not_found') { await load(result.error); return; } setError(result.error); return; }
    await load();
  };
  const publish = async (target: Target) => {
    const item = items.find((candidate) => candidate.id === target.id && candidate.revision === target.revision);
    if (!item || !canPublish || item.warnings.length > 0 || !isCompleteCandidate(item) || activeSellerOrganizationIds.length === 0) { setPublishTarget(null); return; }
    const deadlineAt = localInputToIso(defaultPublishDeadlineInput());
    if (!deadlineAt) { setPublishTarget(null); return; }
    const input: PreparedMailIntakeBidInput = { intakeItemId: item.id, expectedIntakeRevision: item.revision, vesselVoyage: item.vessel_voyage!, portName: item.port_name!, deliveryWindow: item.delivery_window!, deadlineAt, responsibleBuyerUserId: null, fuelGrades: item.fuel_items.map((fuel) => fuel.grade), quantities: item.fuel_items.map((fuel) => fuel.quantity), selectedTraderOrganizationIds: [...activeSellerOrganizationIds] };
    clearTargets(); setPending(true); setError(null);
    try { await onPublish(input); } catch { setError(unknownError); }
    await load();
  };
  const visibleItems = items.filter((item) => seoulDateFromInstant(item.received_at) === selectedBidDate);
  const directPublishMessage = (item: MailIntakeItem) => {
    if (!canPublish) return publishUnavailableMessage;
    if (item.warnings.length) return 'Review extraction warnings in Edit BID before publishing.';
    if (!isCompleteCandidate(item)) return 'Edit BID to complete the missing candidate values before publishing.';
    if (activeSellerOrganizationIds.length === 0) return 'At least one active SELLER is required before publishing.';
    return undefined;
  };
  return <section className="panel mail-intake-queue" aria-labelledby="mail-intake-heading">
    <header className="mail-intake-heading"><div><p className="eyebrow">Review queue</p><h2 id="mail-intake-heading">Mail intake</h2></div><div className="mail-intake-heading-actions"><span>{visibleItems.length} pending for {selectedBidDate}</span><button type="button" className="secondary" disabled={loading || pending} onClick={() => void load()}>Refresh mail intake</button></div></header>
    <div className="mail-intake-boundary"><p>Only explicit BUYER Publish creates an authoritative BID. Gmail never auto-publishes.</p><p>Received time is source metadata, not the bidding deadline.</p></div>
    {error ? <p className="notice error" role="alert">{displayError(error)}</p> : null}
    {loading ? <WorkspaceEmptyState title="Loading mail intake" description="Retrieving the shared pending queue." /> : visibleItems.length === 0 ? <WorkspaceEmptyState title="No pending mail intake for this operational date" description="Pending rows for other Seoul dates remain stored and appear when that date is selected." /> : <ol className="mail-intake-items">{visibleItems.map((item) => {
      const confirmingDismiss = dismissTarget?.id === item.id && dismissTarget.revision === item.revision;
      const confirmingPublish = publishTarget?.id === item.id && publishTarget.revision === item.revision;
      const directMessage = directPublishMessage(item);
      return <li className="mail-intake-item" key={`${item.id}:${item.revision}`}><article>
        <header className="mail-intake-item-heading"><div><h3>{item.subject || '(No subject)'}</h3><p>Received {new Date(item.received_at).toLocaleString()}</p></div><span>Revision {item.revision}</span></header>
        <dl className="mail-intake-candidates"><div><dt>Vessel / voyage</dt><dd>{displayCandidate(item.vessel_voyage)}</dd></div><div><dt>Port</dt><dd>{displayCandidate(item.port_name)}</dd></div><div><dt>Delivery window</dt><dd>{displayCandidate(item.delivery_window)}</dd></div><div><dt>Fuel candidates</dt><dd>{item.fuel_items.length ? item.fuel_items.map((fuel) => `${fuel.grade.toUpperCase()} ${fuel.quantity} MT`).join(', ') : 'None extracted'}</dd></div></dl>
        {item.warnings.length ? <aside className="notice warning mail-intake-warnings"><strong>Extraction warnings</strong><ul>{item.warnings.map((warning, index) => <li key={`${item.id}:warning:${index}`}>{warning}</li>)}</ul><p>Use Edit BID to review these warnings before publishing.</p></aside> : null}
        {directMessage && !item.warnings.length ? <p className="mail-intake-publish-note" role="note">{directMessage}</p> : null}
        <footer className="mail-intake-actions">
          {confirmingPublish ? <div className="mail-intake-confirmation" role="group" aria-label={`Confirm publishing ${item.subject || 'item with no subject'}`}><p>Publish the displayed parsed values unchanged with the next 18:30 Seoul deadline, current-actor responsibility, and all currently active SELLERs?</p><div><button type="button" disabled={pending} onClick={() => void publish(publishTarget)}>Confirm Publish BID</button><button type="button" className="secondary" disabled={pending} onClick={() => setPublishTarget(null)}>Cancel</button></div></div> : <button type="button" disabled={pending || !!directMessage} title={directMessage} onClick={() => setPublishTarget({ id: item.id, revision: item.revision })}>Publish BID</button>}
          <button type="button" className="secondary" disabled={pending || !canEdit} title={!canEdit ? editUnavailableMessage : undefined} onClick={() => onPrepare(item)}>Edit BID</button>
          {confirmingDismiss ? <div className="mail-intake-confirmation" role="group" aria-label={`Confirm dismissal of ${item.subject || 'item with no subject'}`}><p>Dismissal is shared and irreversible.</p><div><button type="button" className="danger" disabled={pending} onClick={() => void dismiss(dismissTarget)}>Confirm dismiss for all BUYERs</button><button type="button" className="secondary" disabled={pending} onClick={() => setDismissTarget(null)}>Cancel</button></div></div> : <button type="button" className="secondary mail-intake-dismiss-button" disabled={pending} onClick={() => setDismissTarget({ id: item.id, revision: item.revision })}>Dismiss</button>}
        </footer>
      </article></li>;
    })}</ol>}
  </section>;
}
