import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccessClient, AccessContext, AccessSession } from './access-client';

type RecoverableReason = 'initial_session' | 'access_context' | 'sign_out';
type SignedOutMessageKind = 'error' | 'success';
type RecoveryPhase = 'inactive' | 'recovering' | 'finalizing_sign_out' | 'terminated';

export type AuthAccessState =
  | { status: 'configuration_error' }
  | { status: 'loading_initial_session' }
  | { status: 'signed_out'; message?: string; messageKind?: SignedOutMessageKind }
  | { status: 'signing_in' }
  | { status: 'checking_server_access' }
  | { status: 'password_recovery'; session: AccessSession; message?: string }
  | { status: 'updating_password'; session: AccessSession }
  | { status: 'access_denied'; session: AccessSession }
  | { status: 'authorized'; session: AccessSession; contexts: AccessContext[] }
  | { status: 'recoverable_error'; reason: RecoverableReason; session: AccessSession | null };

const genericSignInError = 'Sign-in failed. Check your credentials and try again.';
const genericPasswordUpdateError = 'Password could not be updated. Please try again.';
const passwordUpdatedMessage = 'Password updated. Please sign in with your new password.';

export function useAuthAccess(client: AccessClient | null, configurationError: boolean) {
  const [state, setState] = useState<AuthAccessState>(
    configurationError || !client ? { status: 'configuration_error' } : { status: 'loading_initial_session' },
  );
  const operationRef = useRef(0);
  const mountedRef = useRef(false);
  const recoveryPhaseRef = useRef<RecoveryPhase>('inactive');
  const passwordUpdateSucceededRef = useRef(false);
  const stateRef = useRef(state);

  useEffect(() => { stateRef.current = state; }, [state]);
  const invalidatePendingWork = useCallback(() => { operationRef.current += 1; }, []);

  const setSignedOut = useCallback((message?: string, messageKind?: SignedOutMessageKind) => {
    invalidatePendingWork();
    if (mountedRef.current) {
      setState(message ? { status: 'signed_out', message, messageKind } : { status: 'signed_out' });
    }
  }, [invalidatePendingWork]);

  const enterPasswordRecovery = useCallback((session: AccessSession | null) => {
    if (!session) {
      setSignedOut();
      return;
    }
    if (recoveryPhaseRef.current === 'terminated') return;
    recoveryPhaseRef.current = 'recovering';
    invalidatePendingWork();
    if (mountedRef.current) setState({ status: 'password_recovery', session });
  }, [invalidatePendingWork, setSignedOut]);

  const verifyAccess = useCallback(async (session: AccessSession) => {
    if (!client || recoveryPhaseRef.current !== 'inactive') return;
    const operation = ++operationRef.current;
    if (mountedRef.current) setState({ status: 'checking_server_access' });
    let result;
    try { result = await client.getAccessContexts(); } catch { result = { data: [], error: true }; }
    if (!mountedRef.current || recoveryPhaseRef.current !== 'inactive' || operation !== operationRef.current) return;
    if (result.error) {
      setState({ status: 'recoverable_error', reason: 'access_context', session });
    } else if (result.data.length === 0) {
      setState({ status: 'access_denied', session });
    } else {
      setState({ status: 'authorized', session, contexts: result.data });
    }
  }, [client]);

  const handleAuthStateChange = useCallback((event: string, session: AccessSession | null) => {
    if (event === 'INITIAL_SESSION') return;
    if (event === 'PASSWORD_RECOVERY') {
      enterPasswordRecovery(session);
      return;
    }
    if (event === 'SIGNED_OUT' || !session) {
      if (
        passwordUpdateSucceededRef.current
        && recoveryPhaseRef.current === 'finalizing_sign_out'
      ) {
        passwordUpdateSucceededRef.current = false;
        recoveryPhaseRef.current = 'terminated';
        setSignedOut(passwordUpdatedMessage, 'success');
        return;
      }
      if (recoveryPhaseRef.current !== 'inactive') {
        recoveryPhaseRef.current = 'terminated';
      }
      setSignedOut();
      return;
    }
    if (recoveryPhaseRef.current !== 'inactive') return;
    void verifyAccess(session);
  }, [enterPasswordRecovery, setSignedOut, verifyAccess]);

  useEffect(() => {
    mountedRef.current = true;
    if (!client || configurationError) {
      invalidatePendingWork();
      setState({ status: 'configuration_error' });
      return () => { mountedRef.current = false; invalidatePendingWork(); };
    }
    passwordUpdateSucceededRef.current = false;
    recoveryPhaseRef.current = 'inactive';
    setState({ status: 'loading_initial_session' });
    const initialOperation = ++operationRef.current;
    let initialSessionResolved = false;
    const queuedAuthChange: { current: { event: string; session: AccessSession | null } | null } = { current: null };
    const unsubscribe = client.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        queuedAuthChange.current = null;
        enterPasswordRecovery(session);
        return;
      }
      if (event === 'SIGNED_OUT' || !session) {
        queuedAuthChange.current = null;
        handleAuthStateChange(event, session);
        return;
      }
      if (!initialSessionResolved) {
        queuedAuthChange.current = { event, session };
        return;
      }
      handleAuthStateChange(event, session);
    });
    void (async () => {
      let result;
      try { result = await client.getSession(); } catch { result = { data: null, error: true }; }
      initialSessionResolved = true;
      if (!mountedRef.current || recoveryPhaseRef.current !== 'inactive' || initialOperation !== operationRef.current) return;
      if (result.error) setState({ status: 'recoverable_error', reason: 'initial_session', session: null });
      else if (!result.data) setSignedOut();
      else void verifyAccess(result.data);
      if (queuedAuthChange.current) {
        const queued = queuedAuthChange.current;
        queuedAuthChange.current = null;
        handleAuthStateChange(queued.event, queued.session);
      }
    })();
    return () => { mountedRef.current = false; invalidatePendingWork(); unsubscribe(); };
  }, [client, configurationError, enterPasswordRecovery, handleAuthStateChange, invalidatePendingWork, setSignedOut, verifyAccess]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!client) return;
    const recoveryPhase = recoveryPhaseRef.current;
    const operation = ++operationRef.current;
    setState({ status: 'signing_in' });
    let result;
    try { result = await client.signInWithPassword(email, password); } catch { result = { data: null, error: true }; }
    if (!mountedRef.current || recoveryPhaseRef.current !== recoveryPhase || operation !== operationRef.current) return;
    if (result.error || !result.data) {
      setState({ status: 'signed_out', message: genericSignInError, messageKind: 'error' });
      return;
    }
    recoveryPhaseRef.current = 'inactive';
    passwordUpdateSucceededRef.current = false;
    void verifyAccess(result.data);
  }, [client, verifyAccess]);

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!client) return { error: true };
    try { return await client.requestPasswordReset(email); } catch { return { data: null, error: true }; }
  }, [client]);

  const signOut = useCallback(async () => {
    if (!client) return;
    const endsRecovery = recoveryPhaseRef.current !== 'inactive';
    if (endsRecovery) {
      recoveryPhaseRef.current = 'terminated';
      passwordUpdateSucceededRef.current = false;
    }
    const operation = ++operationRef.current;
    setState({ status: 'signed_out' });
    let result;
    try { result = await client.signOut(); } catch { result = { data: null, error: true }; }
    if (result.error && mountedRef.current && operation === operationRef.current) {
      setState({ status: 'recoverable_error', reason: 'sign_out', session: null });
    }
  }, [client]);

  const updatePassword = useCallback(async (password: string) => {
    if (!client || recoveryPhaseRef.current !== 'recovering' || stateRef.current.status !== 'password_recovery') return;
    const operation = ++operationRef.current;
    const recoverySession = stateRef.current.session;
    setState({ status: 'updating_password', session: recoverySession });
    let result;
    try { result = await client.updatePassword(password); } catch { result = { data: null, error: true }; }
    if (!mountedRef.current || operation !== operationRef.current || recoveryPhaseRef.current !== 'recovering') return;
    if (result.error) {
      setState({ status: 'password_recovery', session: recoverySession, message: genericPasswordUpdateError });
      return;
    }
    passwordUpdateSucceededRef.current = true;
    recoveryPhaseRef.current = 'finalizing_sign_out';
    const signOutOperation = ++operationRef.current;
    let signOutResult;
    try { signOutResult = await client.signOut(); } catch { signOutResult = { data: null, error: true }; }
    if (!mountedRef.current || signOutOperation !== operationRef.current) return;
    if (signOutResult.error) {
      passwordUpdateSucceededRef.current = false;
      recoveryPhaseRef.current = 'terminated';
      setState({ status: 'recoverable_error', reason: 'sign_out', session: null });
      return;
    }
    passwordUpdateSucceededRef.current = false;
    recoveryPhaseRef.current = 'terminated';
    setSignedOut(passwordUpdatedMessage, 'success');
  }, [client, setSignedOut]);

  const retry = useCallback(() => {
    const current = stateRef.current;
    if (current.status === 'recoverable_error' && current.reason === 'access_context' && current.session) void verifyAccess(current.session);
    else if (current.status === 'recoverable_error' && current.reason === 'sign_out') void signOut();
  }, [signOut, verifyAccess]);
  const recheckAccess = useCallback(() => {
    const current = stateRef.current;
    if (current.status === 'authorized') void verifyAccess(current.session);
  }, [verifyAccess]);
  return { state, signIn, signOut, requestPasswordReset, updatePassword, retry, recheckAccess };
}
