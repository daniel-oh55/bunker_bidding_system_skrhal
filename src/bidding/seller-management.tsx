import { useCallback, useEffect, useRef, useState } from 'react';
import type { BiddingClient, BiddingResult } from './bidding-client';
import type { SellerOrganizationAdmin, WorkflowError } from './types';

const unknownError: WorkflowError = { kind: 'unknown', code: null, message: 'The SELLER administration request could not be completed. Please try again.' };
const statusLabel: Record<SellerOrganizationAdmin['organization_status'], string> = {
  active: 'Active',
  inactive: 'Inactive',
  suspended: 'Suspended',
};

export function SellerManagement({ client, membershipId, reloadVersion = 0, onAuthorizationFailure, onActiveOrganizationsChanged }: {
  client: BiddingClient;
  membershipId: string;
  reloadVersion?: number;
  onAuthorizationFailure: () => void;
  onActiveOrganizationsChanged: () => unknown;
}) {
  const listOperation = useRef(0);
  const mutationOperation = useRef(0);
  const [visible, setVisible] = useState(false);
  const [organizations, setOrganizations] = useState<SellerOrganizationAdmin[]>([]);
  const [name, setName] = useState('');
  const [armedOrganizationId, setArmedOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<WorkflowError | null>(null);

  const failClosed = useCallback((failure: WorkflowError) => {
    ++listOperation.current;
    ++mutationOperation.current;
    setOrganizations([]);
    setArmedOrganizationId(null);
    setLoading(false);
    setPending(false);
    setError(failure);
    onAuthorizationFailure();
  }, [onAuthorizationFailure]);

  const load = useCallback(async () => {
    const operation = ++listOperation.current;
    setArmedOrganizationId(null);
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
      else setError(result.error);
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

  return <section className="panel seller-management" aria-label="SELLER management">
    <div className="seller-management-heading">
      <div><p className="eyebrow">BUYER administration</p><h2>SELLER master management</h2></div>
      <button type="button" className="secondary" aria-expanded={visible} onClick={() => { setVisible((current) => !current); setArmedOrganizationId(null); }}>Manage SELLERs</button>
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
        const confirmationId = `seller-deactivation-${organization.organization_id}`;
        return <li key={organization.organization_id}>
          <div className="seller-list-row">
            <div><strong>{organization.organization_label}</strong><span className={`seller-status status-${organization.organization_status}`}>{statusLabel[organization.organization_status]}</span><small>{organization.active_trader_membership_count} active TRADER-user {organization.active_trader_membership_count === 1 ? 'membership' : 'memberships'}</small></div>
            {organization.organization_status === 'active' ? <button type="button" className="secondary" disabled={pending} aria-describedby={armed ? confirmationId : undefined} onClick={() => setArmedOrganizationId(organization.organization_id)}>Deactivate</button> : null}
          </div>
          {armed ? <div className="seller-deactivation-confirmation" id={confirmationId} role="alert">
            <strong>Deactivate {organization.organization_label}?</strong>
            <p>All users in this SELLER organization immediately lose application access. Existing BID scopes, quotes, awards and audit records are retained. Reactivation is not available from this screen.</p>
            <div className="seller-confirmation-actions">
              <button type="button" className="danger" disabled={pending} onClick={() => confirmDeactivation(organization.organization_id)}>Confirm deactivation</button>
              <button type="button" className="secondary" disabled={pending} onClick={() => setArmedOrganizationId(null)}>Keep active</button>
            </div>
          </div> : null}
        </li>;
      })}</ul>}
    </div> : null}
  </section>;
}
