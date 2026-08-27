import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BiddingClient, BiddingResult } from './bidding-client';
import { SellerManagement } from './seller-management';
import type { SellerOrganizationAdmin } from './types';

const membershipId = '10000000-0000-4000-8000-000000000001';
const activeId = '20000000-0000-4000-8000-000000000001';
const inactiveId = '20000000-0000-4000-8000-000000000002';
const suspendedId = '20000000-0000-4000-8000-000000000003';
const now = '2026-08-27T03:00:00.000Z';
const ok = <T,>(data: T): BiddingResult<T> => ({ data, error: null });
const organization = (organization_id: string, organization_label: string, organization_status: SellerOrganizationAdmin['organization_status'], active_trader_membership_count: number): SellerOrganizationAdmin => ({
  organization_id, organization_label, organization_status, active_trader_membership_count, created_at: now, updated_at: now,
});
const organizations = [
  organization(activeId, 'Active Ocean', 'active', 2),
  organization(inactiveId, 'Inactive Harbor', 'inactive', 0),
  organization(suspendedId, 'Suspended Marine', 'suspended', 1),
];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function harness(rows: SellerOrganizationAdmin[] = organizations) {
  const listTraderOrganizationsForAdmin = vi.fn(() => Promise.resolve(ok(rows)));
  const createTraderOrganization = vi.fn((_membership: string, name: string) => Promise.resolve(ok(organization('20000000-0000-4000-8000-000000000004', name, 'active', 0))));
  const deactivateTraderOrganization = vi.fn((_membership: string, id: string) => Promise.resolve(ok(organization(id, 'Active Ocean', 'inactive', 2))));
  const client = { listTraderOrganizationsForAdmin, createTraderOrganization, deactivateTraderOrganization } as unknown as BiddingClient;
  return { client, listTraderOrganizationsForAdmin, createTraderOrganization, deactivateTraderOrganization };
}
function open(client: BiddingClient, onAuthorizationFailure = vi.fn(), onActiveOrganizationsChanged = vi.fn(() => Promise.resolve())) {
  const view = render(<SellerManagement client={client} membershipId={membershipId} onAuthorizationFailure={onAuthorizationFailure} onActiveOrganizationsChanged={onActiveOrganizationsChanged} />);
  fireEvent.click(screen.getByRole('button', { name: 'Manage SELLERs' }));
  return { ...view, onAuthorizationFailure, onActiveOrganizationsChanged };
}

describe('SELLER management', () => {
  it('renders every admin status, membership count, and organization-only creation notice', async () => {
    const { client } = harness(); open(client);
    expect(await screen.findByText('Active Ocean')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByText('Suspended')).toBeInTheDocument();
    expect(screen.getByText('2 active TRADER-user memberships')).toBeInTheDocument();
    expect(screen.getByText('Creating a SELLER creates the organization only. It does not create a login account or invitation.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Deactivate' })).toHaveLength(1);
  });

  it('submits a trimmed nonempty name with exact arguments and refreshes admin and active lists', async () => {
    const { client, listTraderOrganizationsForAdmin, createTraderOrganization } = harness([]);
    const refreshActive = vi.fn(() => Promise.resolve()); open(client, vi.fn(), refreshActive);
    await waitFor(() => expect(listTraderOrganizationsForAdmin).toHaveBeenCalledOnce());
    const input = screen.getByRole('textbox', { name: 'SELLER organization name' });
    expect(screen.getByRole('button', { name: 'Add SELLER' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '  New Ocean  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add SELLER' }));
    await waitFor(() => expect(createTraderOrganization).toHaveBeenCalledWith(membershipId, 'New Ocean'));
    await waitFor(() => expect(listTraderOrganizationsForAdmin).toHaveBeenCalledTimes(2));
    expect(refreshActive).toHaveBeenCalledOnce();
    expect(input).toHaveValue('');
  });

  it('prevents duplicate submission while an add mutation is pending', async () => {
    const request = deferred<BiddingResult<SellerOrganizationAdmin>>();
    const { client, createTraderOrganization } = harness([]);
    createTraderOrganization.mockImplementation(() => request.promise);
    open(client); await waitFor(() => expect(screen.queryByText('Loading SELLER organizations')).not.toBeInTheDocument());
    fireEvent.change(screen.getByRole('textbox', { name: 'SELLER organization name' }), { target: { value: 'Pending Ocean' } });
    const button = screen.getByRole('button', { name: 'Add SELLER' });
    fireEvent.click(button); fireEvent.click(button);
    expect(createTraderOrganization).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    await act(async () => { request.resolve(ok(organization(activeId, 'Pending Ocean', 'active', 0))); await request.promise; });
  });

  it('binds two-step deactivation to the exact target and invalidates a stale target selection', async () => {
    const secondActive = organization(inactiveId, 'Second Active', 'active', 1);
    const { client, deactivateTraderOrganization } = harness([organizations[0]!, secondActive]); open(client);
    const firstRow = (await screen.findByText('Active Ocean')).closest('li')!;
    const secondRow = screen.getByText('Second Active').closest('li')!;
    fireEvent.click(within(firstRow).getByRole('button', { name: 'Deactivate' }));
    expect(deactivateTraderOrganization).not.toHaveBeenCalled();
    expect(within(firstRow).getByText('Deactivate Active Ocean?')).toBeInTheDocument();
    fireEvent.click(within(secondRow).getByRole('button', { name: 'Deactivate' }));
    expect(within(firstRow).queryByRole('button', { name: 'Confirm deactivation' })).not.toBeInTheDocument();
    expect(within(secondRow).getByText('Deactivate Second Active?')).toBeInTheDocument();
    fireEvent.click(within(secondRow).getByRole('button', { name: 'Confirm deactivation' }));
    await waitFor(() => expect(deactivateTraderOrganization).toHaveBeenCalledWith(membershipId, inactiveId));
  });

  it('shows the full retention/access warning and refreshes both lists after deactivation', async () => {
    const { client, listTraderOrganizationsForAdmin } = harness([organizations[0]!]);
    const refreshActive = vi.fn(() => Promise.resolve()); open(client, vi.fn(), refreshActive);
    const row = (await screen.findByText('Active Ocean')).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Deactivate' }));
    expect(within(row).getByText(/All users in this SELLER organization immediately lose application access/)).toHaveTextContent('Existing BID scopes, quotes, awards and audit records are retained. Reactivation is not available from this screen.');
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm deactivation' }));
    await waitFor(() => expect(listTraderOrganizationsForAdmin).toHaveBeenCalledTimes(2));
    expect(refreshActive).toHaveBeenCalledOnce();
  });

  it('fails closed on authorization errors but isolates non-authorization errors', async () => {
    const denied = harness([]); const recheck = vi.fn(); const view = open(denied.client, recheck);
    await waitFor(() => expect(denied.listTraderOrganizationsForAdmin).toHaveBeenCalledOnce());
    denied.listTraderOrganizationsForAdmin.mockResolvedValueOnce({ data: null, error: { kind: 'authorization', code: '42501', message: 'Authorization changed' } });
    view.rerender(<SellerManagement client={denied.client} membershipId={membershipId} reloadVersion={1} onAuthorizationFailure={recheck} onActiveOrganizationsChanged={vi.fn()} />);
    await waitFor(() => expect(recheck).toHaveBeenCalledOnce());
    expect(screen.queryByText('Active Ocean')).not.toBeInTheDocument();
    view.unmount();

    const local = harness([]); local.listTraderOrganizationsForAdmin.mockResolvedValueOnce({ data: null, error: { kind: 'unknown', code: null, message: 'Local list error' } });
    const localRecheck = vi.fn(); open(local.client, localRecheck);
    expect(await screen.findByRole('alert')).toHaveTextContent('Local list error');
    expect(localRecheck).not.toHaveBeenCalled();
  });

  it('refreshes a visible admin list on Realtime reloadVersion and ignores stale results', async () => {
    const first = deferred<BiddingResult<SellerOrganizationAdmin[]>>();
    const second = deferred<BiddingResult<SellerOrganizationAdmin[]>>();
    const { client, listTraderOrganizationsForAdmin } = harness();
    listTraderOrganizationsForAdmin.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const view = open(client);
    await waitFor(() => expect(listTraderOrganizationsForAdmin).toHaveBeenCalledOnce());
    view.rerender(<SellerManagement client={client} membershipId={membershipId} reloadVersion={1} onAuthorizationFailure={view.onAuthorizationFailure} onActiveOrganizationsChanged={view.onActiveOrganizationsChanged} />);
    await waitFor(() => expect(listTraderOrganizationsForAdmin).toHaveBeenCalledTimes(2));
    await act(async () => { second.resolve(ok([organization(activeId, 'Fresh Ocean', 'active', 1)])); await second.promise; });
    expect(await screen.findByText('Fresh Ocean')).toBeInTheDocument();
    await act(async () => { first.resolve(ok([organization(activeId, 'Stale Ocean', 'active', 1)])); await first.promise; });
    expect(screen.queryByText('Stale Ocean')).not.toBeInTheDocument();
  });
});
