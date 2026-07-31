import {
  type FormEvent,
  useState,
} from 'react';
import {
  getBrowserAccessConfiguration,
  type AccessClient,
} from './auth/access-client';
import { useAuthAccess } from './auth/use-auth-access';

type AppProps = {
  accessClient?: AccessClient;
  configurationError?: boolean;
};

function SignInForm({
  pending,
  message,
  onSignIn,
}: {
  pending: boolean;
  message?: string;
  onSignIn: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedPassword = password;

    try {
      await onSignIn(email, submittedPassword);
    } finally {
      setPassword('');
    }
  }

  return (
    <section className="panel auth-panel" aria-labelledby="sign-in-heading">
      <p className="eyebrow">Authorized access</p>
      <h1 id="sign-in-heading">Sign in</h1>
      <p className="lede">
        Use the account provided by your administrator. Authentication is followed
        by a server-verified membership check.
      </p>

      <form
        className="auth-form"
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          disabled={pending}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {message ? <p className="notice error" role="alert">{message}</p> : null}

        <button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </section>
  );
}

function LoadingView({ message }: { message: string }) {
  return (
    <section className="panel status-panel" aria-live="polite">
      <p className="eyebrow">Access check</p>
      <h1>{message}</h1>
      <p className="lede">Protected application content remains unavailable.</p>
    </section>
  );
}

export default function App({
  accessClient,
  configurationError = false,
}: AppProps) {
  const browserConfiguration = accessClient || configurationError
    ? null
    : getBrowserAccessConfiguration();
  const client = accessClient
    ?? (browserConfiguration?.status === 'configured' ? browserConfiguration.client : null);
  const hasConfigurationError = configurationError
    || browserConfiguration?.status === 'configuration_error';
  const {
    state,
    signIn,
    signOut,
    retry,
  } = useAuthAccess(client, hasConfigurationError);

  if (state.status === 'configuration_error') {
    return (
      <main className="app-shell">
        <section className="panel status-panel" role="alert">
          <p className="eyebrow">Configuration unavailable</p>
          <h1>Application access is unavailable</h1>
          <p className="lede">
            The application is not configured for secure sign-in. Contact an
            administrator.
          </p>
        </section>
      </main>
    );
  }

  if (state.status === 'loading_initial_session') {
    return (
      <main className="app-shell">
        <LoadingView message="Loading session…" />
      </main>
    );
  }

  if (state.status === 'signed_out' || state.status === 'signing_in') {
    return (
      <main className="app-shell">
        <SignInForm
          pending={state.status === 'signing_in'}
          message={state.status === 'signed_out' ? state.message : undefined}
          onSignIn={signIn}
        />
      </main>
    );
  }

  if (state.status === 'checking_server_access') {
    return (
      <main className="app-shell">
        <LoadingView message="Verifying server access…" />
      </main>
    );
  }

  if (state.status === 'access_denied') {
    return (
      <main className="app-shell">
        <section className="panel status-panel" aria-labelledby="access-denied-heading">
          <p className="eyebrow">Access denied</p>
          <h1 id="access-denied-heading">No active authorized membership</h1>
          <p className="lede">
            This account does not currently have an active authorized membership.
            Contact an administrator if you believe this is incorrect.
          </p>
          <button type="button" onClick={() => void signOut()}>Sign out</button>
        </section>
      </main>
    );
  }

  if (state.status === 'recoverable_error') {
    const canRetry = state.reason === 'access_context' || state.reason === 'sign_out';
    return (
      <main className="app-shell">
        <section className="panel status-panel" role="alert">
          <p className="eyebrow">Temporary error</p>
          <h1>Access could not be verified</h1>
          <p className="lede">
            A temporary error prevented the access check from completing. No
            protected content has been opened.
          </p>
          <div className="button-row">
            {canRetry ? (
              <button type="button" onClick={retry}>Try again</button>
            ) : null}
            <button type="button" className="secondary" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">SKRHAL Bunker Bidding</p>
        <h1>Authorized workspace</h1>
        <p className="lede">
          Access is based on active server-verified membership context, not on
          browser claims or frontend filtering.
        </p>
      </section>

      <section className="panel" aria-labelledby="access-summary-heading">
        <h2 id="access-summary-heading">Access summary</h2>
        <dl className="access-summary">
          <div>
            <dt>Signed-in email</dt>
            <dd>{state.session.email ?? 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Active contexts</dt>
            <dd>{state.contexts.length}</dd>
          </div>
        </dl>

        <ul className="context-list" aria-label="Active membership contexts">
          {state.contexts.map((context) => (
            <li key={context.membership_id}>
              <span>{context.organization_kind}</span>
              <strong>{context.membership_role}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" aria-labelledby="scope-heading">
        <h2 id="scope-heading">Current scope</h2>
        <p>Bid and quote workflows are not implemented.</p>
        <p>
          This frontend gate coordinates user experience only. Future protected
          data must remain authorized by RLS or server-side functions.
        </p>
      </section>

      <div className="shell-actions">
        <button type="button" className="secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </main>
  );
}
