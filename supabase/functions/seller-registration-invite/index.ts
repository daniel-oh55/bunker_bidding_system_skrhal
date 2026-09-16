import { createSellerRegistrationInviteHandler } from '../_shared/seller-registration-invite.ts';

declare const Deno: { env: { get(name: string): string | undefined } };

export default { fetch: createSellerRegistrationInviteHandler({ env: (name) => Deno.env.get(name), fetch: globalThis.fetch }) };
