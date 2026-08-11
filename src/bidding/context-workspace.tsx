import { useEffect, useState } from 'react';
import type { AccessContext } from '../auth/access-client';
import type { BiddingClient } from './bidding-client';
import { BuyerWorkspace } from './buyer-workspace';
import { TraderWorkspace } from './trader-workspace';
import type { RealtimeInvalidationClient } from '../realtime/realtime-client';

const shortId = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;
const contextLabel = (context: AccessContext) => `${context.organization_label ?? shortId(context.organization_id)} · ${context.organization_kind} · ${context.membership_role}`;

export function ContextWorkspace({ contexts, client, recheck, realtimeClient }: { contexts: AccessContext[]; client: BiddingClient; recheck: () => void; realtimeClient?: RealtimeInvalidationClient }) {
  const [selectedId, setSelectedId] = useState(() => contexts[0]?.membership_id ?? '');
  const [invalidation, setInvalidation] = useState({ membershipId: '', version: 0 });
  useEffect(() => { if (!contexts.some((context) => context.membership_id === selectedId)) setSelectedId(contexts[0]?.membership_id ?? ''); }, [contexts, selectedId]);
  const context = contexts.find((candidate) => candidate.membership_id === selectedId) ?? contexts[0];
  useEffect(() => {
    if (!context) return;
    return realtimeClient?.subscribeToWorkspaceInvalidations(context, () => {
    setInvalidation((current) => ({ membershipId: context.membership_id, version: current.membershipId === context.membership_id ? current.version + 1 : 1 }));
    });
  }, [context, realtimeClient]);
  if (!context) return null;
  const reloadVersion = invalidation.membershipId === context.membership_id ? invalidation.version : 0;
  return <><header className="workspace-header"><div><p className="eyebrow">SKRHAL Bunker Bidding</p><h1>Authorized workspace</h1></div><div className="header-actions">{contexts.length > 1 ? <label>Membership context<select aria-label="Membership context" value={context.membership_id} onChange={(event) => setSelectedId(event.target.value)}>{contexts.map((option) => <option key={option.membership_id} value={option.membership_id}>{contextLabel(option)}</option>)}</select></label> : <p className="context-chip">{contextLabel(context)}</p>}</div></header><section key={context.membership_id} aria-label={`${context.organization_kind} workspace`}>{context.organization_kind === 'buyer' ? <BuyerWorkspace client={client} membershipId={context.membership_id} onAuthorizationFailure={recheck} reloadVersion={reloadVersion} /> : <TraderWorkspace client={client} membershipId={context.membership_id} onAuthorizationFailure={recheck} reloadVersion={reloadVersion} />}</section></>;
}
