import {
  type AuthChangeEvent,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import {
  createSupabaseAccessClient,
  createOwnOriginPasswordRecoveryRedirect,
  type AccessClientResult,
  type AccessContext,
  type AccessSession,
} from './access-client';

type AuthCallback = (
  event: AuthChangeEvent,
  session: Session | null,
) => void;

const fullSession = {
  access_token: 'secret-access-token',
  refresh_token: 'secret-refresh-token',
  expires_in: 3_600,
  token_type: 'bearer',
  user: {
    email: 'operator@example.test',
    app_metadata: { role: 'server-only-role' },
    user_metadata: { organization_id: 'server-only-organization' },
  },
} as unknown as Session;

function createSupabaseHarness() {
  let authCallback: AuthCallback | undefined;
  let authCallbackActive = false;
  let accessResponse: { data: unknown; error: unknown } = { data: [], error: null };
  const rpcCallStates: boolean[] = [];
  const unsubscribe = vi.fn();
  const getSession = vi.fn(() => Promise.resolve({ data: { session: null }, error: null }));
  const signInWithPassword = vi.fn();
  const signOut = vi.fn(() => Promise.resolve({ error: null }));
  const resetPasswordForEmail = vi.fn(() => Promise.resolve({ error: null }));
  const updateUser = vi.fn(() => Promise.resolve({ error: null }));
  const overrideTypes = vi.fn(() => Promise.resolve(accessResponse));
  const rpc = vi.fn(() => {
    rpcCallStates.push(authCallbackActive);
    return { overrideTypes };
  });
  const onAuthStateChange = vi.fn((callback: AuthCallback) => {
    authCallback = callback;
    return {
      data: {
        subscription: { unsubscribe },
      },
    };
  });
  const client = {
    auth: { getSession, signInWithPassword, signOut, resetPasswordForEmail, updateUser, onAuthStateChange },
    rpc,
  } as unknown as SupabaseClient;

  return {
    client,
    emit(event: AuthChangeEvent, session: Session | null) {
      if (!authCallback) {
        throw new Error('Auth listener is not registered');
      }

      authCallbackActive = true;
      try {
        authCallback(event, session);
      } finally {
        authCallbackActive = false;
      }
    },
    onAuthStateChange,
    rpc,
    rpcCallStates,
    resetPasswordForEmail,
    updateUser,
    setAccessResponse(response: { data: unknown; error: unknown }) {
      accessResponse = response;
    },
    unsubscribe,
  };
}

describe('Supabase access client Auth adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defers reduced Auth events and access RPCs until after the Auth callback returns', async () => {
    const harness = createSupabaseHarness();
    const client = createSupabaseAccessClient(harness.client);
    let accessRequest:
      | Promise<AccessClientResult<AccessContext[]>>
      | undefined;
    let deliveredEvent: AuthChangeEvent | undefined;
    let deliveredSession: AccessSession | null | undefined;
    const consumer = vi.fn((
      event: AuthChangeEvent,
      session: AccessSession | null,
    ) => {
      deliveredEvent = event;
      deliveredSession = session;
      accessRequest = client.getAccessContexts();
    });

    client.onAuthStateChange(consumer);
    harness.emit('SIGNED_IN', fullSession);

    expect(consumer).not.toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    await accessRequest;

    expect(consumer).toHaveBeenCalledOnce();
    expect(consumer).toHaveBeenCalledWith(
      'SIGNED_IN',
      { email: 'operator@example.test' },
    );
    expect(deliveredEvent).toBe('SIGNED_IN');
    expect(harness.rpc).toHaveBeenCalledWith('current_access_context');
    expect(harness.rpcCallStates).toEqual([false]);

    expect(deliveredSession).toEqual({ email: 'operator@example.test' });
    expect(deliveredSession).not.toHaveProperty('access_token');
    expect(deliveredSession).not.toHaveProperty('refresh_token');
    expect(deliveredSession).not.toHaveProperty('user');
  });

  it('cancels a queued callback and unsubscribes the Supabase listener exactly once', async () => {
    const harness = createSupabaseHarness();
    const client = createSupabaseAccessClient(harness.client);
    const consumer = vi.fn();
    const unsubscribe = client.onAuthStateChange(consumer);

    harness.emit('SIGNED_OUT', null);
    expect(vi.getTimerCount()).toBe(1);

    unsubscribe();
    unsubscribe();

    expect(vi.getTimerCount()).toBe(0);
    expect(harness.unsubscribe).toHaveBeenCalledOnce();

    await vi.runAllTimersAsync();
    expect(consumer).not.toHaveBeenCalled();
  });

  it('cancels every queued Auth callback on unsubscribe', async () => {
    const harness = createSupabaseHarness();
    const client = createSupabaseAccessClient(harness.client);
    const consumer = vi.fn();
    const unsubscribe = client.onAuthStateChange(consumer);

    harness.emit('INITIAL_SESSION', fullSession);
    harness.emit('TOKEN_REFRESHED', fullSession);
    harness.emit('SIGNED_OUT', null);
    expect(vi.getTimerCount()).toBe(3);

    unsubscribe();

    expect(vi.getTimerCount()).toBe(0);
    await vi.runAllTimersAsync();
    expect(consumer).not.toHaveBeenCalled();
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });

  it('uses only an http(s) application origin root for password recovery redirects', () => {
    expect(createOwnOriginPasswordRecoveryRedirect('https://app.example.test')).toBe(
      'https://app.example.test/',
    );
    expect(createOwnOriginPasswordRecoveryRedirect('http://localhost:5173')).toBe(
      'http://localhost:5173/',
    );
    expect(createOwnOriginPasswordRecoveryRedirect('javascript:alert(1)')).toBeNull();
  });

  it('wraps password recovery operations without exposing session tokens', async () => {
    const harness = createSupabaseHarness();
    const client = createSupabaseAccessClient(harness.client, 'https://app.example.test/');

    await expect(client.requestPasswordReset('operator@example.test')).resolves.toEqual({ data: null, error: false });
    await expect(client.updatePassword('new-password')).resolves.toEqual({ data: null, error: false });

    expect(harness.resetPasswordForEmail).toHaveBeenCalledWith('operator@example.test', {
      redirectTo: 'https://app.example.test/',
    });
    expect(harness.updateUser).toHaveBeenCalledWith({ password: 'new-password' });
  });

  it('fails closed when a reset redirect is unavailable', async () => {
    const harness = createSupabaseHarness();
    const client = createSupabaseAccessClient(harness.client);
    await expect(client.requestPasswordReset('operator@example.test')).resolves.toEqual({ data: null, error: true });
    expect(harness.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('accepts the old four-field server shape during rollout', async () => {
    const harness = createSupabaseHarness();
    const client = createSupabaseAccessClient(harness.client);
    const context = {
      membership_id: '10000000-0000-4000-8000-000000000001',
      organization_id: '20000000-0000-4000-8000-000000000001',
      organization_kind: 'buyer',
      membership_role: 'buyer_operator',
    };
    harness.setAccessResponse({ data: [context], error: null });

    await expect(client.getAccessContexts()).resolves.toEqual({
      data: [context],
      error: false,
    });
  });

  it('retains a valid trusted organization label from the server', async () => {
    const harness = createSupabaseHarness();
    const client = createSupabaseAccessClient(harness.client);
    const context = {
      membership_id: '10000000-0000-4000-8000-000000000001',
      organization_id: '20000000-0000-4000-8000-000000000001',
      organization_kind: 'buyer',
      membership_role: 'buyer_admin',
      organization_label: 'Buyer Alpha',
    };
    harness.setAccessResponse({ data: [context], error: null });

    await expect(client.getAccessContexts()).resolves.toEqual({
      data: [context],
      error: false,
    });
  });

  it.each([
    ['blank', ''],
    ['whitespace-only', '   '],
    ['leading whitespace', ' Buyer Alpha'],
    ['trailing whitespace', 'Buyer Alpha '],
    ['null value', null],
    ['non-string', 42],
  ])('rejects a %s present organization label as a complete protocol failure', async (_case, organizationLabel) => {
    const harness = createSupabaseHarness();
    const client = createSupabaseAccessClient(harness.client);
    harness.setAccessResponse({
      data: [{
        membership_id: '10000000-0000-4000-8000-000000000001',
        organization_id: '20000000-0000-4000-8000-000000000001',
        organization_kind: 'buyer',
        membership_role: 'buyer_operator',
        organization_label: organizationLabel,
      }],
      error: null,
    });

    await expect(client.getAccessContexts()).resolves.toEqual({ data: [], error: true });
  });

  it('rejects duplicate server membership IDs as a complete access protocol failure', async () => {
    const harness = createSupabaseHarness();
    const client = createSupabaseAccessClient(harness.client);
    const context = { membership_id: '10000000-0000-4000-8000-000000000001', organization_id: '20000000-0000-4000-8000-000000000001', organization_kind: 'buyer', membership_role: 'buyer_operator', organization_label: 'Buyer Alpha' };
    harness.setAccessResponse({ data: [context, { ...context, organization_id: '20000000-0000-4000-8000-000000000002' }], error: null });

    await expect(client.getAccessContexts()).resolves.toEqual({ data: [], error: true });
  });
});
