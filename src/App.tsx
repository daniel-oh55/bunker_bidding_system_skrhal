import { type FormEvent, useEffect, useState } from 'react';
import { getBrowserAccessConfiguration, type AccessClient } from './auth/access-client';
import { useAuthAccess } from './auth/use-auth-access';
import type { BiddingClient } from './bidding/bidding-client';
import { ContextWorkspace } from './bidding/context-workspace';
import type { AccessContext, AccessSession } from './auth/access-client';
import type { RealtimeInvalidationClient } from './realtime/realtime-client';

type AppProps = { accessClient?: AccessClient; biddingClient?: BiddingClient; realtimeClient?: RealtimeInvalidationClient; configurationError?: boolean };
type Notice = { text: string; kind: 'error' | 'success' };

function SignInForm({ pending, message, messageKind, onSignIn, onForgotPassword }: {
  pending: boolean; message?: string; messageKind?: 'error' | 'success'; onSignIn: (email: string, password: string) => Promise<void>; onForgotPassword: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); try { await onSignIn(email, password); } finally { setPassword(''); } };
  return <section className="panel auth-panel" aria-labelledby="sign-in-heading"><p className="eyebrow">Authorized access</p><h1 id="sign-in-heading">Sign in</h1><p className="lede">Use the account provided by your administrator. Authentication is followed by a server-verified membership check.</p><form className="auth-form" onSubmit={(event) => void submit(event)}><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required disabled={pending} value={email} onChange={(event) => setEmail(event.target.value)} /><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required disabled={pending} value={password} onChange={(event) => setPassword(event.target.value)} />{message ? <p className={`notice ${messageKind ?? 'error'}`} role={messageKind === 'success' ? 'status' : 'alert'}>{message}</p> : null}<button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button><button type="button" className="link-button" disabled={pending} onClick={onForgotPassword}>Forgot password?</button></form></section>;
}

function PasswordResetRequestForm({ onCancel, requestPasswordReset }: { onCancel: () => void; requestPasswordReset: (email: string) => Promise<{ error: boolean }> }) {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setPending(true); setNotice(null);
    const result = await requestPasswordReset(email);
    setPending(false);
    setNotice(result.error
      ? { kind: 'error', text: 'Unable to send password reset instructions. Please try again.' }
      : { kind: 'success', text: 'If an account exists for this email, password reset instructions have been sent.' });
  };
  return <section className="panel auth-panel" aria-labelledby="reset-request-heading"><p className="eyebrow">Password recovery</p><h1 id="reset-request-heading">Reset your password</h1><p className="lede">Enter your email address to receive password reset instructions.</p><form className="auth-form" onSubmit={(event) => void submit(event)}><label htmlFor="reset-email">Email</label><input id="reset-email" type="email" autoComplete="email" required disabled={pending} value={email} onChange={(event) => setEmail(event.target.value)} />{notice ? <p className={`notice ${notice.kind}`} role={notice.kind === 'success' ? 'status' : 'alert'}>{notice.text}</p> : null}<button type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send reset instructions'}</button><button type="button" className="secondary" disabled={pending} onClick={onCancel}>Back to sign in</button></form></section>;
}

function PasswordRecoveryForm({ pending, message, onUpdate, onCancel }: { pending: boolean; message?: string; onUpdate: (password: string) => Promise<void>; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password || password !== confirmation) { setLocalError(password ? 'Passwords do not match.' : 'Enter and confirm your new password.'); return; }
    setLocalError(null); await onUpdate(password); setPassword(''); setConfirmation('');
  };
  return <section className="panel auth-panel" aria-labelledby="new-password-heading"><p className="eyebrow">Password recovery</p><h1 id="new-password-heading">Choose a new password</h1><p className="lede">After updating your password, sign in again before accessing any workspace.</p><form className="auth-form" onSubmit={(event) => void submit(event)}><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" required disabled={pending} value={password} onChange={(event) => setPassword(event.target.value)} /><label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" type="password" autoComplete="new-password" required disabled={pending} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />{localError || message ? <p className="notice error" role="alert">{localError ?? message}</p> : null}<button type="submit" disabled={pending}>{pending ? 'Updating…' : 'Update password'}</button><button type="button" className="secondary" onClick={onCancel}>Cancel and sign out</button></form></section>;
}

function LoadingView({ message }: { message: string }) { return <section className="panel status-panel" aria-live="polite"><p className="eyebrow">Access check</p><h1>{message}</h1><p className="lede">Protected application content remains unavailable.</p></section>; }

function AuthorizedWorkspace({ session, contexts, client, realtimeClient, recheck }: { session: AccessSession; contexts: AccessContext[]; client: BiddingClient; realtimeClient?: RealtimeInvalidationClient; recheck: () => void }) {
  useEffect(() => realtimeClient?.subscribeToAccessInvalidations(session.userId, recheck), [realtimeClient, recheck, session.userId]);
  return <ContextWorkspace contexts={contexts} client={client} recheck={recheck} realtimeClient={realtimeClient} />;
}

export default function App({ accessClient, biddingClient, realtimeClient, configurationError = false }: AppProps) {
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const configuration = accessClient || biddingClient || configurationError ? null : getBrowserAccessConfiguration();
  const access = accessClient ?? (configuration?.status === 'configured' ? configuration.client : null);
  const bidding = biddingClient ?? (configuration?.status === 'configured' ? configuration.biddingClient : null);
  const realtime = realtimeClient ?? (configuration?.status === 'configured' ? configuration.realtimeClient : undefined);
  const hasConfigurationError = configurationError || configuration?.status === 'configuration_error' || !access || !bidding;
  const { state, signIn, signOut, requestPasswordReset, updatePassword, retry, recheckAccess } = useAuthAccess(access, hasConfigurationError);
  if (state.status === 'configuration_error') return <main className="app-shell"><section className="panel status-panel" role="alert"><p className="eyebrow">Configuration unavailable</p><h1>Application access is unavailable</h1><p className="lede">The application is not configured for secure sign-in. Contact an administrator.</p></section></main>;
  if (state.status === 'loading_initial_session') return <main className="app-shell"><LoadingView message="Loading session…" /></main>;
  if (state.status === 'password_recovery' || state.status === 'updating_password') return <main className="app-shell"><PasswordRecoveryForm pending={state.status === 'updating_password'} message={state.status === 'password_recovery' ? state.message : undefined} onUpdate={updatePassword} onCancel={() => void signOut()} /></main>;
  if (state.status === 'signed_out' || state.status === 'signing_in') return <main className="app-shell">{showPasswordReset ? <PasswordResetRequestForm onCancel={() => setShowPasswordReset(false)} requestPasswordReset={requestPasswordReset} /> : <SignInForm pending={state.status === 'signing_in'} message={state.status === 'signed_out' ? state.message : undefined} messageKind={state.status === 'signed_out' ? state.messageKind : undefined} onSignIn={signIn} onForgotPassword={() => setShowPasswordReset(true)} />}</main>;
  if (state.status === 'checking_server_access') return <main className="app-shell"><LoadingView message="Verifying server access…" /></main>;
  if (state.status === 'access_denied') return <main className="app-shell"><section className="panel status-panel"><p className="eyebrow">Access denied</p><h1>No active authorized membership</h1><button type="button" onClick={() => void signOut()}>Sign out</button></section></main>;
  if (state.status === 'recoverable_error') return <main className="app-shell"><section className="panel status-panel" role="alert"><p className="eyebrow">Temporary error</p><h1>Access could not be verified</h1><p className="lede">No protected content has been opened.</p><div className="button-row"><button type="button" onClick={retry}>Try again</button><button type="button" className="secondary" onClick={() => void signOut()}>Sign out</button></div></section></main>;
  return <main className="app-shell"><AuthorizedWorkspace session={state.session} contexts={state.contexts} client={bidding!} realtimeClient={realtime} recheck={recheckAccess} /><div className="shell-actions"><span>{state.session.email ?? 'Signed in'}</span><button type="button" className="secondary" onClick={() => void signOut()}>Sign out</button></div></main>;
}
