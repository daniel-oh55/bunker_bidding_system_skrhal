import {
  StrictMode,
  type ReactNode,
} from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { AuthChangeEvent } from '@supabase/supabase-js';
import App from './App';
import {
  createBrowserAccessConfiguration,
  type AccessClient,
  type AccessClientResult,
  type AccessContext,
  type AccessSession,
} from './auth/access-client';
import type { BiddingClient } from './bidding/bidding-client';

const session: AccessSession = { email: 'operator@example.test' };
const buyerContext: AccessContext = {
  membership_id: '10000000-0000-4000-8000-000000000001',
  organization_id: '20000000-0000-4000-8000-000000000001',
  organization_kind: 'buyer',
  membership_role: 'buyer_operator',
};
const traderContext: AccessContext = {
  membership_id: '10000000-0000-4000-8000-000000000002',
  organization_id: '20000000-0000-4000-8000-000000000002',
  organization_kind: 'trader',
  membership_role: 'trader',
};

const fakeBiddingClient = {
  listActiveBuyers: vi.fn(() => Promise.resolve({ data: [], error: null })),
  listBids: vi.fn(() => Promise.resolve({ data: [], error: null })),
  listActiveTraderOrganizations: vi.fn(() => Promise.resolve({ data: [], error: null })),
  listTraderBids: vi.fn(() => Promise.resolve({ data: [], error: null })),
  listMyQuotes: vi.fn(() => Promise.resolve({ data: [], error: null })),
} as unknown as BiddingClient;

function success<T>(data: T): AccessClientResult<T> {
  return { data, error: false };
}

function failure<T>(data: T): AccessClientResult<T> {
  return { data, error: true };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });

  return { promise, resolve };
}

class FakeAccessClient implements AccessClient {
  sessionResult: AccessClientResult<AccessSession | null> = success(null);
  signInResult: AccessClientResult<AccessSession | null> = success(session);
  signOutResult: AccessClientResult<null> = success(null);
  passwordResetResult: AccessClientResult<null> = success(null);
  passwordUpdateResult: AccessClientResult<null> = success(null);
  accessResults: Array<
    AccessClientResult<AccessContext[]> | Promise<AccessClientResult<AccessContext[]>>
  > = [success([buyerContext])];
  listeners = new Set<
    (event: AuthChangeEvent, currentSession: AccessSession | null) => void
  >();
  unsubscribeCount = 0;

  getSession = vi.fn(() => Promise.resolve(this.sessionResult));

  signInWithPassword = vi.fn(() => Promise.resolve(this.signInResult));

  signOut = vi.fn(() => Promise.resolve(this.signOutResult));

  requestPasswordReset = vi.fn(() => Promise.resolve(this.passwordResetResult));

  updatePassword = vi.fn(() => Promise.resolve(this.passwordUpdateResult));

  getAccessContexts = vi.fn(async () => {
    const next = this.accessResults.shift();
    return await (next ?? success([]));
  });

  onAuthStateChange = vi.fn((
    callback: (event: AuthChangeEvent, currentSession: AccessSession | null) => void,
  ) => {
    this.listeners.add(callback);
    return () => {
      this.unsubscribeCount += 1;
      this.listeners.delete(callback);
    };
  });

  emit(event: AuthChangeEvent, currentSession: AccessSession | null) {
    for (const listener of this.listeners) {
      listener(event, currentSession);
    }
  }
}

function renderWithClient(client: FakeAccessClient, wrapper?: (children: ReactNode) => ReactNode) {
  return render(
    wrapper
      ? wrapper(<App accessClient={client} biddingClient={fakeBiddingClient} />)
      : <App accessClient={client} biddingClient={fakeBiddingClient} />,
  );
}

async function waitForSignIn() {
  expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument();
}

async function waitForAuthorized() {
  expect(
    await screen.findByRole('heading', { name: /authorized workspace/i }),
  ).toBeInTheDocument();
}

describe('frontend Auth access gate', () => {
  it('fails closed when browser configuration is missing', () => {
    expect(createBrowserAccessConfiguration({})).toEqual({
      status: 'configuration_error',
      client: null,
      biddingClient: null,
    });

    render(<App configurationError />);
    expect(
      screen.getByRole('heading', { name: /application access is unavailable/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('loads the initial session and renders the signed-out state', async () => {
    const client = new FakeAccessClient();
    renderWithClient(client);

    expect(screen.getByText(/loading session/i)).toBeInTheDocument();
    await waitForSignIn();
    expect(client.getSession).toHaveBeenCalledTimes(1);
    expect(client.getAccessContexts).not.toHaveBeenCalled();
  });

  it('authorizes only after a valid session returns active context', async () => {
    const client = new FakeAccessClient();
    client.sessionResult = success(session);
    renderWithClient(client);

    await waitForAuthorized();
    expect(client.getSession).toHaveBeenCalledTimes(1);
    expect(client.getAccessContexts).toHaveBeenCalledTimes(1);
    expect(screen.getByText('operator@example.test')).toBeInTheDocument();
  });

  it('denies a valid session with zero active contexts', async () => {
    const client = new FakeAccessClient();
    client.sessionResult = success(session);
    client.accessResults = [success([])];
    renderWithClient(client);

    expect(
      await screen.findByRole('heading', { name: /no active authorized membership/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText('operator@example.test')).not.toBeInTheDocument();
  });

  it('shows a recoverable error when the context RPC fails', async () => {
    const client = new FakeAccessClient();
    client.sessionResult = success(session);
    client.accessResults = [failure([])];
    renderWithClient(client);

    expect(
      await screen.findByRole('heading', { name: /access could not be verified/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/authorized workspace/i)).not.toBeInTheDocument();
  });

  it('retries a transient context RPC failure', async () => {
    const client = new FakeAccessClient();
    client.sessionResult = success(session);
    client.accessResults = [failure([]), success([buyerContext])];
    renderWithClient(client);

    fireEvent.click(
      await screen.findByRole('button', { name: /try again/i }),
    );

    await waitForAuthorized();
    expect(client.getAccessContexts).toHaveBeenCalledTimes(2);
  });

  it('verifies context after a successful sign-in', async () => {
    const client = new FakeAccessClient();
    client.signInResult = success(session);
    client.accessResults = [success([buyerContext])];
    renderWithClient(client);
    await waitForSignIn();

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'operator@example.test' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'correct-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitForAuthorized();
    expect(client.signInWithPassword).toHaveBeenCalledWith(
      'operator@example.test',
      'correct-password',
    );
    expect(client.getAccessContexts).toHaveBeenCalledTimes(1);
  });

  it('shows a generic sign-in failure and clears the password', async () => {
    const client = new FakeAccessClient();
    client.signInResult = failure(null);
    renderWithClient(client);
    await waitForSignIn();

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'operator@example.test' },
    });
    const passwordInput = screen.getByLabelText(/password/i);
    fireEvent.change(passwordInput, { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/sign-in failed/i);
    expect(passwordInput).toHaveValue('');
  });

  it('clears authorized content immediately on sign-out', async () => {
    const client = new FakeAccessClient();
    client.sessionResult = success(session);
    renderWithClient(client);
    await waitForAuthorized();

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitForSignIn();
    expect(client.signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/authorized workspace/i)).not.toBeInTheDocument();
  });

  it('preserves every active context returned by the RPC', async () => {
    const client = new FakeAccessClient();
    client.sessionResult = success(session);
    client.accessResults = [success([buyerContext, traderContext])];
    renderWithClient(client);

    await waitForAuthorized();
    const selector = screen.getByRole('combobox', { name: /membership context/i });
    expect(selector).toHaveValue(buyerContext.membership_id);
    expect(selector.querySelectorAll('option')).toHaveLength(2);
    expect(screen.getByRole('option', { name: /buyer.*buyer_operator/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /trader.*trader/i })).toBeInTheDocument();
  });

  it('revalidates access on an Auth state change', async () => {
    const client = new FakeAccessClient();
    client.accessResults = [success([traderContext])];
    renderWithClient(client);
    await waitForSignIn();

    act(() => {
      client.emit('SIGNED_IN', session);
    });

    await waitForAuthorized();
    expect(client.getAccessContexts).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/trader.*trader/i)).toBeInTheDocument();
  });

  it('cleans up subscriptions under React Strict Mode and on unmount', async () => {
    const client = new FakeAccessClient();
    const view = renderWithClient(
      client,
      (children) => <StrictMode>{children}</StrictMode>,
    );

    await waitForSignIn();
    expect(client.onAuthStateChange).toHaveBeenCalledTimes(2);
    expect(client.unsubscribeCount).toBe(1);

    view.unmount();
    expect(client.unsubscribeCount).toBe(2);
    expect(client.listeners.size).toBe(0);
  });

  it('does not let a stale context result authorize after sign-out', async () => {
    const pendingContext = deferred<AccessClientResult<AccessContext[]>>();
    const client = new FakeAccessClient();
    client.sessionResult = success(session);
    client.accessResults = [pendingContext.promise];
    renderWithClient(client);

    expect(
      await screen.findByRole('heading', { name: /verifying server access/i }),
    ).toBeInTheDocument();
    act(() => {
      client.emit('SIGNED_OUT', null);
    });
    await waitForSignIn();

    act(() => {
      pendingContext.resolve(success([buyerContext]));
    });
    await waitFor(() => {
      expect(screen.queryByText(/authorized workspace/i)).not.toBeInTheDocument();
    });
  });

  it('does not expose a signup control', async () => {
    const client = new FakeAccessClient();
    renderWithClient(client);
    await waitForSignIn();

    expect(screen.queryByRole('button', { name: /sign up|register/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/create account/i)).not.toBeInTheDocument();
  });

  it('does not expose a role or organization selector', async () => {
    const client = new FakeAccessClient();
    renderWithClient(client);
    await waitForSignIn();

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/role|organization/i)).not.toBeInTheDocument();
  });

  it('keeps authorized content absent while context verification is pending', async () => {
    const pendingContext = deferred<AccessClientResult<AccessContext[]>>();
    const client = new FakeAccessClient();
    client.sessionResult = success(session);
    client.accessResults = [pendingContext.promise];
    renderWithClient(client);

    expect(
      await screen.findByRole('heading', { name: /verifying server access/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/authorized workspace/i)).not.toBeInTheDocument();
    expect(screen.queryByText('operator@example.test')).not.toBeInTheDocument();

    pendingContext.resolve(success([buyerContext]));
    await waitForAuthorized();
  });

  it('requests a password reset with generic non-enumerating feedback and no access check', async () => {
    const client = new FakeAccessClient();
    renderWithClient(client);
    await waitForSignIn();
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'operator@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset instructions/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/if an account exists/i);
    expect(client.requestPasswordReset).toHaveBeenCalledWith('operator@example.test');
    expect(client.getAccessContexts).not.toHaveBeenCalled();
    expect(screen.queryByText(/authorized workspace/i)).not.toBeInTheDocument();
  });

  it('preempts initial access verification for a password recovery session', async () => {
    const initial = deferred<AccessClientResult<AccessSession | null>>();
    const client = new FakeAccessClient();
    client.getSession = vi.fn(() => initial.promise);
    renderWithClient(client);
    act(() => { client.emit('PASSWORD_RECOVERY', session); });
    expect(await screen.findByRole('heading', { name: /choose a new password/i })).toBeInTheDocument();
    expect(client.getAccessContexts).not.toHaveBeenCalled();
    act(() => { initial.resolve(success(session)); });
    await waitFor(() => expect(screen.queryByText(/authorized workspace/i)).not.toBeInTheDocument());
    expect(client.getAccessContexts).not.toHaveBeenCalled();
  });

  it('does not let other Auth events escape password recovery mode', async () => {
    const client = new FakeAccessClient();
    renderWithClient(client);
    await waitForSignIn();
    act(() => { client.emit('PASSWORD_RECOVERY', session); });
    await screen.findByRole('heading', { name: /choose a new password/i });
    act(() => { client.emit('USER_UPDATED', session); client.emit('TOKEN_REFRESHED', session); });
    await waitFor(() => expect(screen.getByRole('heading', { name: /choose a new password/i })).toBeInTheDocument());
    expect(client.getAccessContexts).not.toHaveBeenCalled();
  });

  it('keeps a failed password update in recovery with a generic error', async () => {
    const client = new FakeAccessClient();
    client.passwordUpdateResult = failure(null);
    renderWithClient(client);
    await waitForSignIn();
    act(() => { client.emit('PASSWORD_RECOVERY', session); });
    await screen.findByRole('heading', { name: /choose a new password/i });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/password could not be updated/i);
    expect(screen.getByRole('heading', { name: /choose a new password/i })).toBeInTheDocument();
  });

  it('signs out after a successful password update before returning to sign in', async () => {
    const client = new FakeAccessClient();
    renderWithClient(client);
    await waitForSignIn();
    act(() => { client.emit('PASSWORD_RECOVERY', session); });
    await screen.findByRole('heading', { name: /choose a new password/i });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));
    expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument();
    expect(client.updatePassword).toHaveBeenCalledWith('new-password');
    expect(client.signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(/password updated/i);
    expect(screen.queryByText(/authorized workspace/i)).not.toBeInTheDocument();
  });

  it('invalidates a pending password update when recovery is cancelled', async () => {
    const pendingUpdate = deferred<AccessClientResult<null>>();
    const client = new FakeAccessClient();
    client.updatePassword = vi.fn(() => pendingUpdate.promise);
    renderWithClient(client);
    await waitForSignIn();
    act(() => { client.emit('PASSWORD_RECOVERY', session); });
    await screen.findByRole('heading', { name: /choose a new password/i });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel and sign out/i }));
    await waitForSignIn();
    act(() => { pendingUpdate.resolve(success(null)); });
    await waitFor(() => expect(screen.queryByText(/password updated/i)).not.toBeInTheDocument());
  });
});
