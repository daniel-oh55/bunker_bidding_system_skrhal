import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PublicSellerRegistration, SellerCandidateRegistration, sellerRegistrationEnabled } from './seller-registration';
import type { AccessClient, AccessSession } from './access-client';
import type { BiddingClient, BiddingResult } from '../bidding/bidding-client';
import type { SellerRegistrationRequest } from '../bidding/types';
import type { RealtimeInvalidationClient } from '../realtime/realtime-client';

const session: AccessSession = { email: 'seller@example.test', userId: '90000000-0000-4000-8000-000000000001' };
const request = (status: SellerRegistrationRequest['status']): SellerRegistrationRequest => ({
  request_id: '10000000-0000-4000-8000-000000000001',
  source: 'self_signup',
  requested_organization_name: 'Candidate Marine',
  status,
  revision: status === 'pending' ? 1 : 2,
  submitted_at: '2026-09-17T01:00:00.000Z',
  decided_at: status === 'pending' ? null : '2026-09-17T02:00:00.000Z',
  mapped_trader_organization_id: status === 'approved' ? '20000000-0000-4000-8000-000000000001' : null,
});
const result = <T,>(data: T): BiddingResult<T> => ({ data, error: null });
function accessClient(): AccessClient {
  return { signOut: vi.fn(() => Promise.resolve({ data: null, error: false })), updatePassword: vi.fn(() => Promise.resolve({ data: null, error: false })) } as unknown as AccessClient;
}
function renderCandidate(getMySellerRegistrationRequest: BiddingClient['getMySellerRegistrationRequest'], options: { realtimeClient?: RealtimeInvalidationClient; recheckAccess?: () => void } = {}) {
  const client = accessClient(); const recheckAccess = options.recheckAccess ?? vi.fn();
  const biddingClient = { getMySellerRegistrationRequest, submitSellerRegistrationRequest: vi.fn() } as unknown as BiddingClient;
  const view = render(<SellerCandidateRegistration session={session} client={client} biddingClient={biddingClient} realtimeClient={options.realtimeClient} recheckAccess={recheckAccess} />);
  return { ...view, client, biddingClient, recheckAccess };
}

describe('SELLER registration presentation flag', () => {
  it.each([[undefined, false], ['', false], ['false', false], ['TRUE', false], ['true ', false], ['true', true]] as const)('accepts only exact true: %s', (value, expected) => expect(sellerRegistrationEnabled(value)).toBe(expected));

  it('submits only email/password and shows confirmation guidance', async () => {
    const signUpSeller = vi.fn(() => Promise.resolve({ data: null, error: false }));
    const client = { signUpSeller, verifySellerInvite: vi.fn(), inviteSellerRegistration: vi.fn(), updatePassword: vi.fn(), signOut: vi.fn() } as unknown as AccessClient;
    render(<PublicSellerRegistration client={client} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create SELLER account' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'seller@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create SELLER account' }));
    await waitFor(() => expect(signUpSeller).toHaveBeenCalledExactlyOnceWith('seller@example.test', 'password'));
    expect(await screen.findByText('Check your email to confirm your address, then return to sign in.')).toBeInTheDocument();
    expect(screen.getByText(/does not choose a company or grant a BUYER role/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /BUYER role/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/role|organization/i)).not.toBeInTheDocument();
  });

  it('requires exactly six digits before using the invite verification flow', async () => {
    const verifySellerInvite = vi.fn(() => Promise.resolve({ data: null, error: false }));
    const client = { ...accessClient(), signUpSeller: vi.fn(), verifySellerInvite } as AccessClient;
    render(<PublicSellerRegistration client={client} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use invitation code' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'seller@example.test' } });
    const code = screen.getByLabelText('6-digit invitation code');
    fireEvent.change(code, { target: { value: '12345' } });
    fireEvent.submit(code.closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the 6-digit invitation code.');
    expect(verifySellerInvite).not.toHaveBeenCalled();
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.submit(code.closest('form')!);
    await waitFor(() => expect(verifySellerInvite).toHaveBeenCalledExactlyOnceWith('seller@example.test', '123456'));
  });

  it('requires password setup after invite verification and does not mount a workspace', async () => {
    const client = { ...accessClient(), signUpSeller: vi.fn(), verifySellerInvite: vi.fn(() => Promise.resolve({ data: null, error: false })) } as AccessClient;
    render(<PublicSellerRegistration client={client} onBack={vi.fn()} onInviteVerified={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use invitation code' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'seller@example.test' } });
    fireEvent.change(screen.getByLabelText('6-digit invitation code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify invitation' }));
    expect(await screen.findByRole('heading', { name: 'Set your password' })).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeRequired();
    expect(screen.queryByRole('heading', { name: /Bunker Bidding/i })).not.toBeInTheDocument();
  });
});

describe('SELLER candidate registration', () => {
  it('renders the submission form when no request exists', async () => {
    renderCandidate(vi.fn(() => Promise.resolve(result(null))));
    expect(await screen.findByRole('heading', { name: 'Request SELLER registration' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Organization / company name' })).toBeInTheDocument();
  });

  it('renders a pending request without a new submission control', async () => {
    renderCandidate(vi.fn(() => Promise.resolve(result(request('pending')))));
    expect(await screen.findByRole('heading', { name: 'Pending BUYER approval' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Organization / company name' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument();
  });

  it('allows a rejected candidate to submit a new request', async () => {
    renderCandidate(vi.fn(() => Promise.resolve(result(request('rejected')))));
    expect(await screen.findByRole('heading', { name: 'Registration was not approved' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit new request' })).toBeInTheDocument();
  });

  it('keeps an approved candidate with zero active access out of the workspace', async () => {
    const recheckAccess = vi.fn(); renderCandidate(vi.fn(() => Promise.resolve(result(request('approved')))), { recheckAccess });
    expect(await screen.findByRole('heading', { name: 'Approval recorded but no active access is available' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Bunker Bidding/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry access verification' }));
    expect(recheckAccess).toHaveBeenCalledOnce();
  });

  it('fails closed when registration status cannot be parsed', async () => {
    const protocolFailure: BiddingResult<SellerRegistrationRequest | null> = {
      data: null,
      error: { kind: 'protocol', code: null, message: 'invalid' },
    };
    renderCandidate(vi.fn(() => Promise.resolve(protocolFailure)));
    expect(await screen.findByRole('heading', { name: 'Registration status unavailable' })).toBeInTheDocument();
    expect(screen.getByText('No workspace has been opened.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Organization / company name' })).not.toBeInTheDocument();
  });

  it('refreshes registration status and rechecks access on access_changed', async () => {
    let invalidate: (() => void) | undefined;
    const subscribeToAccessInvalidations = vi.fn<RealtimeInvalidationClient['subscribeToAccessInvalidations']>(
      (_userId, callback) => { invalidate = callback; return vi.fn(); },
    );
    const subscribeToWorkspaceInvalidations = vi.fn<RealtimeInvalidationClient['subscribeToWorkspaceInvalidations']>(
      () => vi.fn(),
    );
    const realtimeClient: RealtimeInvalidationClient = {
      subscribeToAccessInvalidations,
      subscribeToWorkspaceInvalidations,
    };
    const getRequest = vi.fn()
      .mockResolvedValueOnce(result(request('pending')))
      .mockResolvedValueOnce(result(request('rejected')));
    const recheckAccess = vi.fn(); renderCandidate(getRequest, { realtimeClient, recheckAccess });
    await screen.findByRole('heading', { name: 'Pending BUYER approval' });
    act(() => invalidate?.());
    expect(await screen.findByRole('heading', { name: 'Registration was not approved' })).toBeInTheDocument();
    expect(getRequest).toHaveBeenCalledTimes(2);
    expect(recheckAccess).toHaveBeenCalledOnce();
  });
});
