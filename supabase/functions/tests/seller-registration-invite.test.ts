import { describe, expect, it, vi } from 'vitest';
import { createSellerRegistrationInviteHandler } from '../_shared/seller-registration-invite.ts';

const environment = (name: string) => name === 'SUPABASE_URL' ? 'http://127.0.0.1:54321' : name === 'SUPABASE_SECRET_KEYS' ? '{"default":"test-secret"}' : undefined;
const request = (body: unknown, method = 'POST') => new Request('http://local/invite', {
  method,
  headers: { authorization: 'Bearer caller-jwt', 'content-type': 'application/json' },
  ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(body) }),
});

describe('seller registration invitation', () => {
  it('authorizes with the caller JWT before using the server credential for Auth Admin', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('[]', { status: 200 })).mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const response = await createSellerRegistrationInviteHandler({ env: environment, fetch })(request({ actor_membership_id: 'actor', email: 'Candidate@Example.test' }));
    expect(await response.json()).toEqual({ status: 'sent' });
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: 'Bearer caller-jwt' });
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/rpc/authorize_seller_registration_invite');
    expect(String(fetch.mock.calls[1]?.[0])).toContain('/auth/v1/invite');
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: 'Bearer test-secret' });
    expect(fetch.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ email: 'candidate@example.test' }));
  });
  it('does not call Auth Admin when a buyer operator authorization fails', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 403 }));
    const response = await createSellerRegistrationInviteHandler({ env: environment, fetch })(request({ actor_membership_id: 'operator', email: 'candidate@example.test' }));
    expect(response.status).toBe(403); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('fails closed for malformed requests and methods', async () => {
    const fetch = vi.fn(); const handler = createSellerRegistrationInviteHandler({ env: environment, fetch });
    expect((await handler(request({ actor_membership_id: 'actor', email: 'bad' }))).status).toBe(400);
    expect((await handler(request({}, 'GET'))).status).toBe(405);
    expect((await handler(request({}, 'HEAD'))).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });
});
