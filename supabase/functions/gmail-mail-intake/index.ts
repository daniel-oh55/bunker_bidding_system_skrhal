import { createGmailMailIntakeHandler } from '../_shared/gmail-mail-intake.ts';
import { createGmailImapAdapter } from '../_shared/gmail-imap-adapter.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
};

export default {
  fetch: createGmailMailIntakeHandler({
    env: (name) => Deno.env.get(name),
    fetch: globalThis.fetch,
    imapFactory: createGmailImapAdapter,
  }),
};
