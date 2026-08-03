import { type FormEvent, useState } from 'react';
import { getBrowserAccessConfiguration, type AccessClient } from './auth/access-client';
import { useAuthAccess } from './auth/use-auth-access';
import type { BiddingClient } from './bidding/bidding-client';
import { ContextWorkspace } from './bidding/context-workspace';

type AppProps = { accessClient?: AccessClient; biddingClient?: BiddingClient; configurationError?: boolean };

function SignInForm({ pending, message, onSignIn }: { pending: boolean; message?: string; onSignIn: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); try { await onSignIn(email, password); } finally { setPassword(''); } };
  return <section className="panel auth-panel" aria-labelledby="sign-in-heading"><p className="eyebrow">Authorized access</p><h1 id="sign-in-heading">Sign in</h1><p className="lede">Use the account provided by your administrator. Authentication is followed by a server-verified membership check.</p><form className="auth-form" onSubmit={(event) => void submit(event)}><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required disabled={pending} value={email} onChange={(event) => setEmail(event.target.value)} /><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required disabled={pending} value={password} onChange={(event) => setPassword(event.target.value)} />{message ? <p className="notice error" role="alert">{message}</p> : null}<button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button></form></section>;
}

function LoadingView({ message }: { message: string }) { return <section className="panel status-panel" aria-live="polite"><p className="eyebrow">Access check</p><h1>{message}</h1><p className="lede">Protected application content remains unavailable.</p></section>; }

export default function App({ accessClient, biddingClient, configurationError = false }: AppProps) {
  const configuration = accessClient || biddingClient || configurationError ? null : getBrowserAccessConfiguration();
  const access = accessClient ?? (configuration?.status === 'configured' ? configuration.client : null);
  const bidding = biddingClient ?? (configuration?.status === 'configured' ? configuration.biddingClient : null);
  const hasConfigurationError = configurationError || configuration?.status === 'configuration_error' || !access || !bidding;
  const { state, signIn, signOut, retry, recheckAccess } = useAuthAccess(access, hasConfigurationError);
  if (state.status === 'configuration_error') return <main className="app-shell"><section className="panel status-panel" role="alert"><p className="eyebrow">Configuration unavailable</p><h1>Application access is unavailable</h1><p className="lede">The application is not configured for secure sign-in. Contact an administrator.</p></section></main>;
  if (state.status === 'loading_initial_session') return <main className="app-shell"><LoadingView message="Loading session…" /></main>;
  if (state.status === 'signed_out' || state.status === 'signing_in') return <main className="app-shell"><SignInForm pending={state.status === 'signing_in'} message={state.status === 'signed_out' ? state.message : undefined} onSignIn={signIn} /></main>;
  if (state.status === 'checking_server_access') return <main className="app-shell"><LoadingView message="Verifying server access…" /></main>;
  if (state.status === 'access_denied') return <main className="app-shell"><section className="panel status-panel"><p className="eyebrow">Access denied</p><h1>No active authorized membership</h1><button type="button" onClick={() => void signOut()}>Sign out</button></section></main>;
  if (state.status === 'recoverable_error') return <main className="app-shell"><section className="panel status-panel" role="alert"><p className="eyebrow">Temporary error</p><h1>Access could not be verified</h1><p className="lede">No protected content has been opened.</p><div className="button-row"><button type="button" onClick={retry}>Try again</button><button type="button" className="secondary" onClick={() => void signOut()}>Sign out</button></div></section></main>;
  return <main className="app-shell"><ContextWorkspace contexts={state.contexts} client={bidding!} recheck={recheckAccess} /><div className="shell-actions"><span>{state.session.email ?? 'Signed in'}</span><button type="button" className="secondary" onClick={() => void signOut()}>Sign out</button></div></main>;
}
