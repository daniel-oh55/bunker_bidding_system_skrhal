import { useCallback, useEffect, useRef, useState } from 'react';
import type { BiddingClient, BiddingResult } from './bidding-client';
import type { SellerOrganizationAdmin, WorkflowError } from './types';
import type { SellerRegistrationAdminRequest, TraderOrganization } from './types';
import type { AccessClient } from '../auth/access-client';

const unknownError: WorkflowError = { kind: 'unknown', code: null, message: 'The SELLER administration request could not be completed. Please try again.' };
const sellerDeleteLifecycleMessage = 'SELLER organization has memberships or retained bidding history; deactivate it instead';
const statusLabel: Record<SellerOrganizationAdmin['organization_status'], string> = {
  active: 'Active',
  inactive: 'Inactive',
  suspended: 'Suspended',
};

export function SellerManagement({ client, membershipId, reloadVersion = 0, onAuthorizationFailure, onActiveOrganizationsChanged, registrationEnabled = false, accessClient }: {
  client: BiddingClient;
  membershipId: string;
  reloadVersion?: number;
  onAuthorizationFailure: () => void;
  onActiveOrganizationsChanged: () => unknown;
  registrationEnabled?: boolean;
  accessClient?: AccessClient;
}) {
  const listOperation = useRef(0);
  const mutationOperation = useRef(0);
  const [visible, setVisible] = useState(false);
  const [organizations, setOrganizations] = useState<SellerOrganizationAdmin[]>([]);
  const [name, setName] = useState('');
  const [armedOrganizationId, setArmedOrganizationId] = useState<string | null>(null);
  const [editingOrganization, setEditingOrganization] = useState<SellerOrganizationAdmin | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletionTarget, setDeletionTarget] = useState<SellerOrganizationAdmin | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<WorkflowError | null>(null);

  const failClosed = useCallback((failure: WorkflowError) => {
    ++listOperation.current;
    ++mutationOperation.current;
    setOrganizations([]);
    setArmedOrganizationId(null);
    setEditingOrganization(null);
    setDeletionTarget(null);
    setLoading(false);
    setPending(false);
    setError(failure);
    onAuthorizationFailure();
  }, [onAuthorizationFailure]);

  const load = useCallback(async () => {
    const operation = ++listOperation.current;
    setArmedOrganizationId(null);
    setEditingOrganization(null);
    setDeletionTarget(null);
    setLoading(true);
    setError(null);
    let result: BiddingResult<SellerOrganizationAdmin[]>;
    try {
      result = client.listTraderOrganizationsForAdmin
        ? await client.listTraderOrganizationsForAdmin(membershipId)
        : { data: null, error: unknownError };
    } catch {
      result = { data: null, error: unknownError };
    }
    if (operation !== listOperation.current) return false;
    setLoading(false);
    if (result.error) {
      if (result.error.kind === 'authorization') failClosed(result.error);
      else { setOrganizations([]); setError(result.error); }
      return false;
    }
    setOrganizations(result.data ?? []);
    return true;
  }, [client, failClosed, membershipId]);

  useEffect(() => () => { ++listOperation.current; ++mutationOperation.current; }, []);
  useEffect(() => { if (visible) void load(); }, [load, visible]);
  const reloadRef = useRef(load);
  reloadRef.current = load;
  useEffect(() => { if (visible && reloadVersion > 0) void reloadRef.current(); }, [reloadVersion, visible]);

  const runMutation = async (operation: () => Promise<BiddingResult<SellerOrganizationAdmin>>) => {
    const generation = ++mutationOperation.current;
    setPending(true);
    setError(null);
    let result: BiddingResult<SellerOrganizationAdmin>;
    try {
      result = await operation();
    } catch {
      result = { data: null, error: unknownError };
    }
    if (generation !== mutationOperation.current) return false;
    if (result.error) {
      setPending(false);
      if (result.error.kind === 'authorization') failClosed(result.error);
      else {
        setError(result.error);
        if (result.error.kind === 'conflict') {
          await load();
          if (generation === mutationOperation.current) setError(result.error);
        }
      }
      return false;
    }
    setArmedOrganizationId(null);
    await Promise.all([load(), Promise.resolve(onActiveOrganizationsChanged())]);
    if (generation === mutationOperation.current) setPending(false);
    return true;
  };

  const submitCreate = (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 120 || pending) return;
    void runMutation(() => client.createTraderOrganization
      ? client.createTraderOrganization(membershipId, normalizedName)
      : Promise.resolve({ data: null, error: unknownError })).then((created) => {
      if (created) setName('');
    });
  };

  const confirmDeactivation = (organizationId: string) => {
    if (pending || armedOrganizationId !== organizationId) return;
    void runMutation(() => client.deactivateTraderOrganization
      ? client.deactivateTraderOrganization(membershipId, organizationId)
      : Promise.resolve({ data: null, error: unknownError }));
  };

  const submitRename = (event: React.FormEvent) => {
    event.preventDefault();
    const target = editingOrganization;
    const normalizedName = editingName.trim();
    if (!target || !normalizedName || normalizedName.length > 120 || pending) return;
    void runMutation(() => client.renameTraderOrganization
      ? client.renameTraderOrganization(membershipId, target.organization_id, target.organization_label, target.organization_status, normalizedName)
      : Promise.resolve({ data: null, error: unknownError }));
  };

  const confirmDeletion = () => {
    const target = deletionTarget;
    if (!target || pending) return;
    void runMutation(async () => {
      const result = client.deleteTraderOrganization
        ? await client.deleteTraderOrganization(membershipId, target.organization_id, target.organization_label, target.organization_status)
        : { data: null, error: unknownError };
      return result.error?.kind === 'lifecycle'
        ? { ...result, error: { ...result.error, message: sellerDeleteLifecycleMessage } }
        : result;
    });
  };

  return <section className="panel seller-management" aria-label="SELLER management">
    <div className="seller-management-heading">
      <div><p className="eyebrow">BUYER administration</p><h2>SELLER master management</h2></div>
      <button type="button" className="secondary" aria-expanded={visible} onClick={() => { setVisible((current) => !current); setArmedOrganizationId(null); setEditingOrganization(null); setDeletionTarget(null); }}>Manage SELLERs</button>
    </div>
    {visible ? <div className="seller-management-content">
      <form className="seller-create-form" onSubmit={submitCreate}>
        <div><h3>+ Add SELLER</h3><p>Creating a SELLER creates the organization only. It does not create a login account or invitation.</p></div>
        <label>SELLER organization name<input aria-label="SELLER organization name" maxLength={120} disabled={pending} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <button type="submit" disabled={pending || name.trim().length === 0 || name.trim().length > 120}>Add SELLER</button>
      </form>
      {error ? <p className="notice error" role="alert">{error.message}</p> : null}
      {loading ? <p>Loading SELLER organizations</p> : organizations.length === 0 ? <p>No SELLER organizations found.</p> : <ul className="seller-list">{organizations.map((organization) => {
        const armed = armedOrganizationId === organization.organization_id;
        const editing = editingOrganization?.organization_id === organization.organization_id;
        const deleting = deletionTarget?.organization_id === organization.organization_id;
        const confirmationId = `seller-deactivation-${organization.organization_id}`;
        return <li key={organization.organization_id}>
          <div className="seller-list-row">
            <div><strong>{organization.organization_label}</strong><span className={`seller-status status-${organization.organization_status}`}>{statusLabel[organization.organization_status]}</span><small>{organization.active_trader_membership_count} active TRADER-user {organization.active_trader_membership_count === 1 ? 'membership' : 'memberships'}</small></div>
            <div className="seller-row-actions">
              <button type="button" className="secondary" disabled={pending} onClick={() => { setEditingOrganization(organization); setEditingName(organization.organization_label); setArmedOrganizationId(null); setDeletionTarget(null); }}>Rename</button>
              {organization.organization_status === 'active' ? <button type="button" className="secondary" disabled={pending} aria-describedby={armed ? confirmationId : undefined} onClick={() => { setArmedOrganizationId(organization.organization_id); setEditingOrganization(null); setDeletionTarget(null); }}>Deactivate</button> : null}
              <button type="button" className="danger" disabled={pending} onClick={() => { setDeletionTarget(organization); setArmedOrganizationId(null); setEditingOrganization(null); }}>Delete</button>
            </div>
          </div>
          {editing ? <form className="seller-rename-form" onSubmit={submitRename}>
            <label>New SELLER organization name<input aria-label="New SELLER organization name" maxLength={120} disabled={pending} value={editingName} onChange={(event) => setEditingName(event.target.value)} /></label>
            <div className="seller-confirmation-actions">
              <button type="submit" disabled={pending || editingName.trim().length === 0 || editingName.trim().length > 120}>Save rename</button>
              <button type="button" className="secondary" disabled={pending} onClick={() => { setEditingOrganization(null); setEditingName(''); }}>Cancel rename</button>
            </div>
          </form> : null}
          {armed ? <div className="seller-deactivation-confirmation" id={confirmationId} role="alert">
            <strong>Deactivate {organization.organization_label}?</strong>
            <p>All users in this SELLER organization immediately lose application access. Existing BID scopes, quotes, awards and audit records are retained. Reactivation is not available from this screen.</p>
            <div className="seller-confirmation-actions">
              <button type="button" className="danger" disabled={pending} onClick={() => confirmDeactivation(organization.organization_id)}>Confirm deactivation</button>
              <button type="button" className="secondary" disabled={pending} onClick={() => setArmedOrganizationId(null)}>Keep active</button>
            </div>
          </div> : null}
          {deleting ? <div className="seller-delete-confirmation" role="alert">
            <strong>Permanently delete {deletionTarget.organization_label}?</strong>
            <p>Permanent deletion is allowed only for unused SELLERs. Memberships and retained bidding or commercial history block deletion; administration audit history remains.</p>
            <div className="seller-confirmation-actions">
              <button type="button" className="danger" disabled={pending} onClick={confirmDeletion}>Confirm permanent delete</button>
              <button type="button" className="secondary" disabled={pending} onClick={() => setDeletionTarget(null)}>Cancel delete</button>
            </div>
          </div> : null}
        </li>;
      })}</ul>}
      {registrationEnabled && accessClient ? <SellerRegistrationAdministration client={client} accessClient={accessClient} membershipId={membershipId} reloadVersion={reloadVersion} onAuthorizationFailure={onAuthorizationFailure} onActiveOrganizationsChanged={onActiveOrganizationsChanged} /> : null}
    </div> : null}
  </section>;
}

function SellerRegistrationAdministration({ client, accessClient, membershipId, reloadVersion, onAuthorizationFailure, onActiveOrganizationsChanged }: { client: BiddingClient; accessClient: AccessClient; membershipId: string; reloadVersion: number; onAuthorizationFailure: () => void; onActiveOrganizationsChanged: () => unknown }) {
  const loadOperation = useRef(0); const lastReloadVersion = useRef(reloadVersion);
  const [requests, setRequests] = useState<SellerRegistrationAdminRequest[]>([]); const [organizations, setOrganizations] = useState<TraderOrganization[]>([]); const [email, setEmail] = useState(''); const [selected, setSelected] = useState<Record<string, string>>({}); const [confirmation, setConfirmation] = useState<{ request: SellerRegistrationAdminRequest; action: 'approve' | 'reject' } | null>(null); const [notice, setNotice] = useState<string | null>(null); const [pending, setPending] = useState(false);
  const clearAndRecheck = useCallback(() => { ++loadOperation.current; setRequests([]); setOrganizations([]); setSelected({}); setConfirmation(null); setPending(false); onAuthorizationFailure(); }, [onAuthorizationFailure]);
  const load = useCallback(async () => {
    const operation = ++loadOperation.current; setPending(true);
    let requestResult: BiddingResult<SellerRegistrationAdminRequest[]>; let organizationResult: BiddingResult<TraderOrganization[]>;
    try {
      [requestResult, organizationResult] = await Promise.all([client.listSellerRegistrationRequestsForAdmin ? client.listSellerRegistrationRequestsForAdmin(membershipId) : Promise.resolve({ data: null, error: unknownError }), client.listActiveTraderOrganizations(membershipId)]);
    } catch {
      requestResult = { data: null, error: unknownError }; organizationResult = { data: null, error: unknownError };
    }
    if (operation !== loadOperation.current) return;
    setPending(false); const error = requestResult.error ?? organizationResult.error;
    if (error) { setRequests([]); setOrganizations([]); setSelected({}); setConfirmation(null); setNotice(error.kind === 'authorization' ? 'Registration administration is no longer available.' : error.message); if (error.kind === 'authorization') clearAndRecheck(); return; }
    setRequests(requestResult.data ?? []); setOrganizations(organizationResult.data ?? []);
  }, [clearAndRecheck, client, membershipId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { ++loadOperation.current; }, []);
  useEffect(() => { if (reloadVersion > lastReloadVersion.current) { lastReloadVersion.current = reloadVersion; void load(); } }, [load, reloadVersion]);
  const invite = async (event: React.FormEvent) => { event.preventDefault(); setPending(true); const result = await accessClient.inviteSellerRegistration(membershipId, email.trim()); setPending(false); setNotice(result.error ? 'Invitation could not be sent. Please try again.' : 'Invitation request accepted.'); if (!result.error) setEmail(''); };
  const act = async () => { const target = confirmation; if (!target) return; setPending(true); const result = target.action === 'approve' ? client.approveSellerRegistrationRequest ? await client.approveSellerRegistrationRequest(membershipId, target.request.request_id, target.request.revision, selected[target.request.request_id] ?? '') : { data: null, error: unknownError } : client.rejectSellerRegistrationRequest ? await client.rejectSellerRegistrationRequest(membershipId, target.request.request_id, target.request.revision) : { data: null, error: unknownError }; setPending(false); if (result.error) { setNotice(result.error.kind === 'conflict' ? 'Registration changed. The latest pending requests were loaded.' : result.error.message); if (result.error.kind === 'authorization') { clearAndRecheck(); return; } if (result.error.kind === 'conflict') void load(); return; } setConfirmation(null); await Promise.all([load(), Promise.resolve(onActiveOrganizationsChanged())]); };
  return <section className="seller-registration-admin" aria-label="SELLER registration administration"><h3>SELLER registration administration</h3><form className="seller-create-form" onSubmit={(event) => void invite(event)}><label>SELLER email invitation<input type="email" required disabled={pending} value={email} onChange={(event) => setEmail(event.target.value)} /></label><button type="submit" disabled={pending}>Invite SELLER user</button></form>{notice ? <p className="notice" role="status">{notice}</p> : null}{requests.length === 0 ? <p>No pending SELLER registrations.</p> : <ul className="seller-list">{requests.map((request) => { const selectedOrganizationId = selected[request.request_id] ?? ''; const selectedOrganization = organizations.find((organization) => organization.organization_id === selectedOrganizationId); const armed = confirmation?.request.request_id === request.request_id; return <li key={request.request_id}><strong>{request.applicant_email}</strong><small>Requested organization: {request.requested_organization_name} · {request.source} · {new Date(request.submitted_at).toLocaleString()}</small><label>Active SELLER organization<select aria-label={`Active SELLER organization for ${request.applicant_email}`} disabled={pending} value={selectedOrganizationId} onChange={(event) => setSelected((current) => ({ ...current, [request.request_id]: event.target.value }))}><option value="">Choose an active SELLER</option>{organizations.map((organization) => <option key={organization.organization_id} value={organization.organization_id}>{organization.organization_label}</option>)}</select></label><div className="seller-row-actions"><button type="button" disabled={pending || !selectedOrganizationId} onClick={() => setConfirmation({ request, action: 'approve' })}>Approve</button><button type="button" className="danger" disabled={pending} onClick={() => setConfirmation({ request, action: 'reject' })}>Reject</button></div>{armed ? <div className="seller-deactivation-confirmation" role="alert"><strong>{confirmation.action === 'approve' ? `${request.applicant_email} → ${selectedOrganization?.organization_label ?? 'selected SELLER'}` : `Reject ${request.applicant_email}?`}</strong><div className="seller-confirmation-actions"><button type="button" className={confirmation.action === 'reject' ? 'danger' : ''} disabled={pending} onClick={() => void act()}>Confirm {confirmation.action}</button><button type="button" className="secondary" disabled={pending} onClick={() => setConfirmation(null)}>Cancel</button></div></div> : null}</li>; })}</ul>}</section>;
}
