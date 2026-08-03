import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {
  AccessClient,
  AccessContext,
  AccessSession,
} from './access-client';

type RecoverableReason = 'initial_session' | 'access_context' | 'sign_out';

export type AuthAccessState =
  | { status: 'configuration_error' }
  | { status: 'loading_initial_session' }
  | { status: 'signed_out'; message?: string }
  | { status: 'signing_in' }
  | { status: 'checking_server_access' }
  | { status: 'access_denied'; session: AccessSession }
  | {
    status: 'authorized';
    session: AccessSession;
    contexts: AccessContext[];
  }
  | {
    status: 'recoverable_error';
    reason: RecoverableReason;
    session: AccessSession | null;
  };

const genericSignInError = 'Sign-in failed. Check your credentials and try again.';

export function useAuthAccess(
  client: AccessClient | null,
  configurationError: boolean,
) {
  const [state, setState] = useState<AuthAccessState>(
    configurationError || !client
      ? { status: 'configuration_error' }
      : { status: 'loading_initial_session' },
  );
  const operationRef = useRef(0);
  const mountedRef = useRef(false);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const invalidatePendingWork = useCallback(() => {
    operationRef.current += 1;
  }, []);

  const setSignedOut = useCallback((message?: string) => {
    invalidatePendingWork();
    if (mountedRef.current) {
      setState(message ? { status: 'signed_out', message } : { status: 'signed_out' });
    }
  }, [invalidatePendingWork]);

  const verifyAccess = useCallback(async (session: AccessSession) => {
    if (!client) {
      return;
    }

    const operation = ++operationRef.current;
    if (mountedRef.current) {
      setState({ status: 'checking_server_access' });
    }

    let result;
    try {
      result = await client.getAccessContexts();
    } catch {
      result = { data: [], error: true };
    }

    if (!mountedRef.current || operation !== operationRef.current) {
      return;
    }

    if (result.error) {
      setState({
        status: 'recoverable_error',
        reason: 'access_context',
        session,
      });
      return;
    }

    if (result.data.length === 0) {
      setState({ status: 'access_denied', session });
      return;
    }

    setState({
      status: 'authorized',
      session,
      contexts: result.data,
    });
  }, [client]);

  const handleAuthStateChange = useCallback((
    event: string,
    session: AccessSession | null,
  ) => {
    if (event === 'INITIAL_SESSION') {
      return;
    }

    if (event === 'SIGNED_OUT' || !session) {
      setSignedOut();
      return;
    }

    void verifyAccess(session);
  }, [setSignedOut, verifyAccess]);

  useEffect(() => {
    mountedRef.current = true;

    if (!client || configurationError) {
      invalidatePendingWork();
      setState({ status: 'configuration_error' });
      return () => {
        mountedRef.current = false;
        invalidatePendingWork();
      };
    }

    setState({ status: 'loading_initial_session' });
    const initialOperation = ++operationRef.current;
    let initialSessionResolved = false;
    const queuedAuthChange: {
      current: { event: string; session: AccessSession | null } | null;
    } = { current: null };

    const unsubscribe = client.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        queuedAuthChange.current = null;
        handleAuthStateChange(event, session);
        return;
      }

      if (!initialSessionResolved && event !== 'INITIAL_SESSION') {
        queuedAuthChange.current = { event, session };
        return;
      }

      handleAuthStateChange(event, session);
    });

    void (async () => {
      let result;
      try {
        result = await client.getSession();
      } catch {
        result = { data: null, error: true };
      }

      initialSessionResolved = true;
      if (!mountedRef.current || initialOperation !== operationRef.current) {
        return;
      }

      if (result.error) {
        setState({
          status: 'recoverable_error',
          reason: 'initial_session',
          session: null,
        });
      } else if (!result.data) {
        setSignedOut();
      } else {
        void verifyAccess(result.data);
      }

      if (queuedAuthChange.current) {
        const queued = queuedAuthChange.current;
        queuedAuthChange.current = null;
        handleAuthStateChange(queued.event, queued.session);
      }
    })();

    return () => {
      mountedRef.current = false;
      invalidatePendingWork();
      unsubscribe();
    };
  }, [
    client,
    configurationError,
    handleAuthStateChange,
    invalidatePendingWork,
    setSignedOut,
    verifyAccess,
  ]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!client) {
      return;
    }

    const operation = ++operationRef.current;
    setState({ status: 'signing_in' });

    let result;
    try {
      result = await client.signInWithPassword(email, password);
    } catch {
      result = { data: null, error: true };
    }

    if (!mountedRef.current || operation !== operationRef.current) {
      return;
    }

    if (result.error || !result.data) {
      setState({ status: 'signed_out', message: genericSignInError });
      return;
    }

    void verifyAccess(result.data);
  }, [client, verifyAccess]);

  const signOut = useCallback(async () => {
    if (!client) {
      return;
    }

    const operation = ++operationRef.current;
    setState({ status: 'signed_out' });

    let result;
    try {
      result = await client.signOut();
    } catch {
      result = { data: null, error: true };
    }

    if (
      result.error
      && mountedRef.current
      && operation === operationRef.current
    ) {
      setState({
        status: 'recoverable_error',
        reason: 'sign_out',
        session: null,
      });
    }
  }, [client]);

  const retry = useCallback(() => {
    const currentState = stateRef.current;
    if (
      currentState.status === 'recoverable_error'
      && currentState.reason === 'access_context'
      && currentState.session
    ) {
      void verifyAccess(currentState.session);
    } else if (
      currentState.status === 'recoverable_error'
      && currentState.reason === 'sign_out'
    ) {
      void signOut();
    }
  }, [signOut, verifyAccess]);

  const recheckAccess = useCallback(() => {
    const currentState = stateRef.current;
    if (currentState.status === 'authorized') {
      void verifyAccess(currentState.session);
    }
  }, [verifyAccess]);

  return {
    state,
    signIn,
    signOut,
    retry,
    recheckAccess,
  };
}
