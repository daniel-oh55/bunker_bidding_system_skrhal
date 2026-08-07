import { useEffect, useState } from 'react';
import type { AccessContext } from '../auth/access-client';
import type { BiddingClient } from './bidding-client';
import { BuyerWorkspace } from './buyer-workspace';
import { TraderWorkspace } from './trader-workspace';

const shortId = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;
const contextLabel = (context: AccessContext) => `${context.organization_label ?? shortId(context.organization_id)} · ${context.organization_kind} · ${context.membership_role}`;

export function ContextWorkspace({ contexts, client, recheck }: { contexts: AccessContext[]; client: BiddingClient; recheck: () => void }) {
  const [selectedId, setSelectedId] = useState(() => contexts[0]?.membership_id ?? '');
  useEffect(() => { if (!contexts.some((context) => context.membership_id === selectedId)) setSelectedId(contexts[0]?.membership_id ?? ''); }, [contexts, selectedId]);
  const context = contexts.find((candidate) => candidate.membership_id === selectedId) ?? contexts[0];
  if (!context) return null;
  return <><header className="workspace-header"><div><p className="eyebrow">SKRHAL Bunker Bidding</p><h1>Authorized workspace</h1></div><div className="header-actions">{contexts.length > 1 ? <label>Membership context<select aria-label="Membership context" value={context.membership_id} onChange={(event) => setSelectedId(event.target.value)}>{contexts.map((option) => <option key={option.membership_id} value={option.membership_id}>{contextLabel(option)}</option>)}</select></label> : <p className="context-chip">{contextLabel(context)}</p>}</div></header><section key={context.membership_id} aria-label={`${context.organization_kind} workspace`}>{context.organization_kind === 'buyer' ? <BuyerWorkspace client={client} membershipId={context.membership_id} onAuthorizationFailure={recheck} /> : <TraderWorkspace client={client} membershipId={context.membership_id} onAuthorizationFailure={recheck} />}</section></>;
}
