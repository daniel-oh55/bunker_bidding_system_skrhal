type EnvironmentReader = (name: string) => string | undefined;
type Dependencies = { env: EnvironmentReader; fetch: typeof fetch };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function response(status: number, body: Record<string, string>): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function secretKey(env: EnvironmentReader): string | null {
  try {
    const parsed = JSON.parse(env('SUPABASE_SECRET_KEYS') ?? '') as Record<string, unknown>;
    return typeof parsed.default === 'string' && parsed.default.trim() !== '' ? parsed.default : null;
  } catch { return null; }
}

function config(env: EnvironmentReader): { url: string; secret: string } | null {
  const url = env('SUPABASE_URL')?.replace(/\/$/, '');
  const secret = secretKey(env);
  try { if (!url || !secret || !['http:', 'https:'].includes(new URL(url).protocol)) return null; } catch { return null; }
  return { url, secret };
}

function email(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 254 && emailPattern.test(normalized) ? normalized : null;
}

export function createSellerRegistrationInviteHandler({ env, fetch }: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return response(405, { status: 'error' });
    const configuration = config(env);
    const authorization = request.headers.get('authorization');
    if (!configuration || !authorization?.startsWith('Bearer ') || authorization.length <= 7) return response(401, { status: 'error' });
    let body: Record<string, unknown>;
    try { const value: unknown = await request.json(); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); body = value as Record<string, unknown>; } catch { return response(400, { status: 'error' }); }
    const actorMembershipId = typeof body.actor_membership_id === 'string' ? body.actor_membership_id : null;
    const recipient = email(body.email);
    if (!actorMembershipId || !recipient) return response(400, { status: 'error' });
    let authorized: Response;
    try {
      authorized = await fetch(`${configuration.url}/rest/v1/rpc/authorize_seller_registration_invite`, {
        method: 'POST', headers: { apikey: configuration.secret, authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ p_actor_membership_id: actorMembershipId }),
      });
    } catch { return response(503, { status: 'error' }); }
    if (!authorized.ok) return response(403, { status: 'error' });
    let invited: Response;
    try {
      invited = await fetch(`${configuration.url}/auth/v1/invite`, {
        method: 'POST', headers: { apikey: configuration.secret, authorization: `Bearer ${configuration.secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ email: recipient }),
      });
    } catch { return response(503, { status: 'error' }); }
    return invited.ok ? response(200, { status: 'sent' }) : response(502, { status: 'error' });
  };
}
