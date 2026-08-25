import { ImapFlow } from 'imapflow';

export type ImapMailboxSnapshot = { uidValidity: bigint; uidNext: number };
export type ImapMessageMetadata = { uid: number; subject: string; internalDate: Date; bodyStructure: unknown };
export type GmailImapAdapter = {
  connect(): Promise<void>;
  openInboxReadOnly(): Promise<ImapMailboxSnapshot>;
  searchSnapshotUids(lowerUid: number, upperUid: number): Promise<number[]>;
  fetchMessageMetadata(uid: number): Promise<ImapMessageMetadata | null>;
  downloadPlainTextPart(uid: number, part: string, maxBytes: number): Promise<Uint8Array>;
  close(): Promise<void>;
};
export type GmailImapAdapterFactory = (credentials: { user: string; password: string }) => GmailImapAdapter;

export const GMAIL_IMAP_CONNECTION = {
  host: 'imap.gmail.com', port: 993, secure: true, mailbox: 'INBOX', readOnly: true,
} as const;

async function readBounded(stream: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new Error('download limit exceeded');
    chunks.push(chunk);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export const createGmailImapAdapter: GmailImapAdapterFactory = ({ user, password }) => {
  const client = new ImapFlow({
    host: GMAIL_IMAP_CONNECTION.host,
    port: GMAIL_IMAP_CONNECTION.port,
    secure: GMAIL_IMAP_CONNECTION.secure,
    auth: { user, pass: password },
  });
  let lock: { release(): void } | undefined;
  return {
    async connect() { await client.connect(); },
    async openInboxReadOnly() {
      lock = await client.getMailboxLock(GMAIL_IMAP_CONNECTION.mailbox, { readOnly: true });
      const mailbox = client.mailbox;
      if (!mailbox || mailbox.readOnly !== true) throw new Error('mailbox was not opened read-only');
      return { uidValidity: mailbox.uidValidity, uidNext: mailbox.uidNext };
    },
    async searchSnapshotUids(lowerUid, upperUid) {
      const result = await client.search({ uid: `${lowerUid}:${upperUid}` }, { uid: true });
      if (!result) throw new Error('UID search failed');
      return result;
    },
    async fetchMessageMetadata(uid) {
      const message = await client.fetchOne(String(uid), {
        uid: true, envelope: true, internalDate: true, bodyStructure: true,
      }, { uid: true });
      if (!message) return null;
      if (!message.internalDate || !message.bodyStructure) throw new Error('message metadata incomplete');
      return {
        uid: message.uid,
        subject: message.envelope?.subject ?? '',
        internalDate: message.internalDate instanceof Date ? message.internalDate : new Date(message.internalDate),
        bodyStructure: message.bodyStructure,
      };
    },
    async downloadPlainTextPart(uid, part, maxBytes) {
      const { content } = await client.download(String(uid), part, { uid: true, maxBytes });
      return readBounded(content, maxBytes);
    },
    async close() {
      try { lock?.release(); } finally {
        lock = undefined;
        try { await client.logout(); } catch { client.close(); }
      }
    },
  };
};
