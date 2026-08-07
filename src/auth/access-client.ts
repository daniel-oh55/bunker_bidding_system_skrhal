import {
  createClient,
  type AuthChangeEvent,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { createSupabaseBiddingClient, type BiddingClient } from '../bidding/bidding-client';

export type AccessContext = {
  membership_id: string;
  organization_id: string;
  organization_kind: 'buyer' | 'trader';
  membership_role: 'buyer_admin' | 'buyer_operator' | 'trader';
  organization_label?: string;
};

export type AccessSession = {
  email: string | null;
};

export type AccessClientResult<T> = {
  data: T;
  error: boolean;
};

export interface AccessClient {
  getSession(): Promise<AccessClientResult<AccessSession | null>>;
  signInWithPassword(
    email: string,
    password: string,
  ): Promise<AccessClientResult<AccessSession | null>>;
  signOut(): Promise<AccessClientResult<null>>;
  requestPasswordReset(email: string): Promise<AccessClientResult<null>>;
  updatePassword(password: string): Promise<AccessClientResult<null>>;
  getAccessContexts(): Promise<AccessClientResult<AccessContext[]>>;
  onAuthStateChange(
    callback: (event: AuthChangeEvent, session: AccessSession | null) => void,
  ): () => void;
}

type BrowserEnvironment = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
};

export type BrowserAccessConfiguration =
  | { status: 'configured'; client: AccessClient; biddingClient: BiddingClient }
  | { status: 'configuration_error'; client: null; biddingClient: null };

export function createOwnOriginPasswordRecoveryRedirect(origin: string): string | null {
  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
      return null;
    }
    return new URL('/', parsedOrigin).toString();
  } catch {
    return null;
  }
}

const organizationKinds = new Set(['buyer', 'trader']);
const membershipRoles = new Set(['buyer_admin', 'buyer_operator', 'trader']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toAccessSession(session: Session | null): AccessSession | null {
  if (!session) {
    return null;
  }

  return {
    email: session.user.email ?? null,
  };
}

function parseAccessContexts(value: unknown): AccessContext[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const contexts: AccessContext[] = [];
  const membershipIds = new Set<string>();

  for (const candidate of value) {
    if (
      typeof candidate !== 'object'
      || candidate === null
    ) {
      return null;
    }

    const record = candidate as Record<string, unknown>;
    const membershipId = record.membership_id;
    const organizationId = record.organization_id;
    const organizationKind = record.organization_kind;
    const membershipRole = record.membership_role;
    const hasOrganizationLabel = Object.prototype.hasOwnProperty.call(
      record,
      'organization_label',
    );
    const organizationLabel = record.organization_label;

    if (
      typeof membershipId !== 'string'
      || typeof organizationId !== 'string'
      || typeof organizationKind !== 'string'
      || typeof membershipRole !== 'string'
      || !uuid.test(membershipId)
      || !uuid.test(organizationId)
      || !organizationKinds.has(organizationKind)
      || !membershipRoles.has(membershipRole)
      || (organizationKind === 'buyer' && membershipRole === 'trader')
      || (organizationKind === 'trader' && membershipRole !== 'trader')
      || (hasOrganizationLabel && (
        typeof organizationLabel !== 'string'
        || organizationLabel.length === 0
        || organizationLabel !== organizationLabel.trim()
      ))
      || membershipIds.has(membershipId)
    ) {
      return null;
    }

    membershipIds.add(membershipId);

    contexts.push({
      membership_id: membershipId,
      organization_id: organizationId,
      organization_kind: organizationKind as AccessContext['organization_kind'],
      membership_role: membershipRole as AccessContext['membership_role'],
      ...(hasOrganizationLabel
        ? { organization_label: organizationLabel as string }
        : {}),
    });
  }

  return contexts;
}

export function createSupabaseAccessClient(
  client: SupabaseClient,
  passwordRecoveryRedirectTo?: string,
): AccessClient {
  return {
    async getSession() {
      const { data, error } = await client.auth.getSession();
      return {
        data: error ? null : toAccessSession(data.session),
        error: Boolean(error),
      };
    },

    async signInWithPassword(email, password) {
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      return {
        data: error ? null : toAccessSession(data.session),
        error: Boolean(error),
      };
    },

    async signOut() {
      const { error } = await client.auth.signOut({ scope: 'local' });
      return {
        data: null,
        error: Boolean(error),
      };
    },

    async requestPasswordReset(email) {
      if (!passwordRecoveryRedirectTo) {
        return { data: null, error: true };
      }

      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: passwordRecoveryRedirectTo,
      });
      return { data: null, error: Boolean(error) };
    },

    async updatePassword(password) {
      const { error } = await client.auth.updateUser({ password });
      return { data: null, error: Boolean(error) };
    },

    async getAccessContexts() {
      const { data, error } = await client
        .rpc('current_access_context')
        .overrideTypes<AccessContext[], { merge: false }>();
      const contexts = error ? null : parseAccessContexts(data);

      return {
        data: contexts ?? [],
        error: Boolean(error) || contexts === null,
      };
    },

    onAuthStateChange(callback) {
      const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
      let active = true;

      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((event, session) => {
        const accessSession = toAccessSession(session);
        const timer = setTimeout(() => {
          pendingTimers.delete(timer);
          if (active) {
            callback(event, accessSession);
          }
        }, 0);

        pendingTimers.add(timer);
      });

      return () => {
        if (!active) {
          return;
        }

        active = false;

        for (const timer of pendingTimers) {
          clearTimeout(timer);
        }

        pendingTimers.clear();
        subscription.unsubscribe();
      };
    },
  };
}

export function createBrowserAccessConfiguration(
  environment: BrowserEnvironment,
): BrowserAccessConfiguration {
  const url = environment.VITE_SUPABASE_URL?.trim();
  const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    return { status: 'configuration_error', client: null, biddingClient: null };
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return { status: 'configuration_error', client: null, biddingClient: null };
    }

    const passwordRecoveryRedirectTo = createOwnOriginPasswordRecoveryRedirect(
      window.location.origin,
    );
    if (!passwordRecoveryRedirectTo) {
      return { status: 'configuration_error', client: null, biddingClient: null };
    }

    const client = createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    return {
      status: 'configured',
      client: createSupabaseAccessClient(client, passwordRecoveryRedirectTo),
      biddingClient: createSupabaseBiddingClient(client),
    };
  } catch {
    return { status: 'configuration_error', client: null, biddingClient: null };
  }
}

let browserConfiguration: BrowserAccessConfiguration | undefined;

export function getBrowserAccessConfiguration(): BrowserAccessConfiguration {
  browserConfiguration ??= createBrowserAccessConfiguration(import.meta.env);
  return browserConfiguration;
}
