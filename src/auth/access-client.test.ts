import {
  type AuthChangeEvent,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import {
  createSupabaseAccessClient,
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
  const rpcCallStates: boolean[] = [];
  const unsubscribe = vi.fn();
  const overrideTypes = vi.fn(() => Promise.resolve({
    data: [],
    error: null,
  }));
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
    auth: { onAuthStateChange },
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
});
