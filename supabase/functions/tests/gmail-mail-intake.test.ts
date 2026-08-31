import { describe, expect, it } from 'vitest';
import { GMAIL_IMAP_CLIENT_OPTIONS, GMAIL_IMAP_CONNECTION } from '../_shared/gmail-imap-adapter.ts';
import type { GmailImapAdapter, ImapMessageMetadata } from '../_shared/gmail-imap-adapter.ts';
import { CONNECTOR_TRIGGER_HEADER, createGmailMailIntakeHandler, MAX_DECODED_PLAIN_TEXT_BYTES, parseImapCursor } from '../_shared/gmail-mail-intake.ts';

const trigger = 'synthetic-trigger';
const env: Record<string, string> = {
  GMAIL_CONNECTOR_TRIGGER_SECRET: trigger,
  GMAIL_IMAP_USER: 'synthetic-user',
  GMAIL_IMAP_APP_PASSWORD: 'synthetic-app-password',
  GMAIL_MAILBOX_KEY: 'gmail-bunker-primary',
  SUPABASE_URL: 'https://database.example.test',
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'synthetic-database-key' }),
};
const structure = { type: 'multipart/alternative', childNodes: [{ part: '1', type: 'text/plain' }, { part: '2', type: 'text/html' }] };

type Options = {
  cursor?: { cursor_value: string; revision: number } | null;
  uidValidity?: bigint;
  uidNext?: number;
  uids?: number[];
  messages?: Record<number, ImapMessageMetadata | null>;
  parts?: Record<string, Uint8Array>;
  connectError?: boolean;
  downloadError?: boolean;
  ingestFailure?: boolean;
  ingestResults?: Array<'40001' | 'success'>;
  casConflict?: boolean;
};
class Harness {
  calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  factoryCalls = 0;
  imap: FakeImap;
  constructor(readonly options: Options = {}) { this.imap = new FakeImap(options); }
  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
    this.calls.push({ path: url.pathname, body });
    if (url.pathname.endsWith('/get_mail_connector_cursor')) return Response.json(this.options.cursor === undefined ? [{ cursor_value: 'imap-v1:100:500', revision: 4 }] : this.options.cursor ? [this.options.cursor] : []);
    if (url.pathname.endsWith('/compare_and_swap_mail_connector_cursor')) {
      if (this.options.casConflict) return Response.json({ code: '40001' }, { status: 409 });
      return Response.json([{ cursor_value: body.p_cursor_value, revision: body.p_expected_revision === null ? 1 : Number(body.p_expected_revision) + 1 }]);
    }
    if (url.pathname.endsWith('/ingest_mail_intake_item')) {
      const result = this.options.ingestResults?.[this.rpc('ingest_mail_intake_item').length - 1];
      if (result === '40001') return Response.json({ code: '40001' }, { status: 409 });
      return this.options.ingestFailure ? Response.json({ code: 'XX000' }, { status: 500 }) : Response.json('00000000-0000-0000-0000-000000000001');
    }
    throw new Error('unexpected synthetic request');
  };
  handler(environment = env) {
    return createGmailMailIntakeHandler({ env: (name) => environment[name], fetch: this.fetch as typeof fetch, imapFactory: () => { this.factoryCalls += 1; return this.imap; } });
  }
  rpc(name: string) { return this.calls.filter((call) => call.path.endsWith(`/${name}`)); }
}
class FakeImap implements GmailImapAdapter {
  connects = 0; opens = 0; closes = 0; searches: Array<[number, number]> = []; fetched: number[] = []; downloads: Array<[number, string, number]> = [];
  constructor(private readonly options: Options) {}
  async connect() { this.connects += 1; if (this.options.connectError) throw new Error('synthetic'); }
  async openInboxReadOnly() { this.opens += 1; return { uidValidity: this.options.uidValidity ?? 100n, uidNext: this.options.uidNext ?? 504 }; }
  async searchSnapshotUids(lower: number, upper: number) { this.searches.push([lower, upper]); return this.options.uids ?? [501, 502, 503]; }
  async fetchMessageMetadata(uid: number) {
    this.fetched.push(uid);
    return this.options.messages && Object.hasOwn(this.options.messages, uid) ? this.options.messages[uid]! : message(uid);
  }
  async downloadPlainTextPart(uid: number, part: string, max: number) { this.downloads.push([uid, part, max]); if (this.options.downloadError) throw new Error('synthetic'); return this.options.parts?.[part] ?? new TextEncoder().encode('PORT : TEST PORT\nVLSFO : 25 MT'); }
  async close() { this.closes += 1; }
}
function message(uid: number, subject = '//SPOT// TEST VESSEL 2601E / BUNKER REQUEST AT TEST PORT'): ImapMessageMetadata {
  return { uid, subject, internalDate: new Date('2026-09-01T00:00:00.000Z'), bodyStructure: structure };
}
function request(secret = trigger) { return new Request('https://function.example.test/gmail-mail-intake', { method: 'POST', headers: { [CONNECTOR_TRIGGER_HEADER]: secret } }); }

describe('Gmail IMAP mail intake', () => {
  it('rejects unauthorized calls before IMAP construction or Supabase RPC', async () => {
    const harness = new Harness(); const response = await harness.handler()(request('wrong'));
    expect(response.status).toBe(401); expect(harness.factoryCalls).toBe(0); expect(harness.calls).toHaveLength(0);
  });
  it('is POST-only and browser JWT is not connector authority', async () => {
    const harness = new Harness(); const response = await harness.handler()(new Request('https://function.example.test', { headers: { authorization: 'Bearer synthetic-browser-jwt' } }));
    expect(response.status).toBe(405); expect(harness.factoryCalls).toBe(0); expect(harness.calls).toHaveLength(0);
  });
  it('fails closed when IMAP configuration is absent and has no OAuth requirement', async () => {
    const harness = new Harness(); const missing = { ...env }; delete missing.GMAIL_IMAP_APP_PASSWORD;
    const response = await harness.handler(missing)(request());
    expect(response.status).toBe(500); expect(harness.factoryCalls).toBe(0); expect(harness.calls).toHaveLength(0);
  });
  it('initializes first run at UIDNEXT minus one and imports zero history', async () => {
    const harness = new Harness({ cursor: null, uidValidity: 100n, uidNext: 501 }); const response = await harness.handler()(request());
    expect(await response.json()).toEqual({ status: 'initialized', discovered: 0, ingested: 0, skipped_absent: 0 });
    expect(harness.imap.searches).toEqual([]); expect(harness.imap.fetched).toEqual([]); expect(harness.rpc('ingest_mail_intake_item')).toEqual([]);
    expect(harness.rpc('compare_and_swap_mail_connector_cursor')[0]?.body.p_cursor_value).toBe('imap-v1:100:500');
  });
  it('initializes an empty inbox at UID 0', async () => {
    const harness = new Harness({ cursor: null, uidNext: 1 }); await harness.handler()(request());
    expect(harness.rpc('compare_and_swap_mail_connector_cursor')[0]?.body.p_cursor_value).toBe('imap-v1:100:0');
  });
  it('does not search or revise a cursor when no mail is newer than UIDNEXT minus one', async () => {
    const harness = new Harness({ cursor: { cursor_value: 'imap-v1:100:503', revision: 8 }, uidNext: 504 }); await harness.handler()(request());
    expect(harness.imap.searches).toEqual([]); expect(harness.rpc('compare_and_swap_mail_connector_cursor')).toEqual([]);
  });
  it('captures a bounded snapshot, processes ascending UIDs, and uses UIDVALIDITY-aware identity', async () => {
    const harness = new Harness({ uids: [503, 501, 502], uidNext: 504 }); await harness.handler()(request());
    expect(harness.imap.searches).toEqual([[501, 503]]); expect(harness.imap.fetched).toEqual([501, 502, 503]);
    expect(harness.rpc('ingest_mail_intake_item').map((call) => call.body.p_source_message_id)).toEqual(['100:501', '100:502', '100:503']);
    expect(harness.rpc('compare_and_swap_mail_connector_cursor')[0]?.body.p_cursor_value).toBe('imap-v1:100:503');
  });
  it.each([
    '//SPOT// TEST VESSEL 001E / BUNKER REQUEST AT BUSAN',
    '//SPOT//TEST VESSEL 001E / BUNKER REQUEST AT BUSAN',
  ])('ingests an exact leading marker while preserving stored subject and excluding it from parser candidates: %s', async (subject) => {
    const harness = new Harness({ uidNext: 502, uids: [501], messages: { 501: message(501, subject) } });
    const response = await harness.handler()(request());

    expect(await response.json()).toEqual({ status: 'completed', discovered: 1, ingested: 1, skipped_absent: 0 });
    expect(harness.imap.downloads).toHaveLength(1);
    expect(harness.rpc('ingest_mail_intake_item')).toHaveLength(1);
    const ingress = harness.rpc('ingest_mail_intake_item')[0]?.body;
    expect(ingress?.p_subject).toBe(subject);
    expect(ingress?.p_vessel_voyage).toBe('TEST VESSEL 001E');
    expect(String(ingress?.p_vessel_voyage)).not.toContain('//SPOT//');
  });
  it('ingests a synthetic operational exact-marker shape as normalized review-only candidates', async () => {
    const subject = '//SPOT// Synthetic bunker request (TEST STAR 2609E / 02~07th Sep 2026 / TEST PORT, KOREA)';
    const body = [
      '- VSL : TEST STAR 2609E',
      '- PORT / TERMINAL : TEST PORT, KOREA / TEST TERMINAL',
      '- ETA : 01st Sep 2026',
      '- HSHFO RMG380 : ISO 8217 specification',
      '- HSHFO RMG380 : 700 MT',
      '- LSMGO DMA : ISO 8217 specification',
      '- LSMGO DMA : 50 M/T',
    ].join('\n');
    const harness = new Harness({
      uidNext: 502,
      uids: [501],
      messages: { 501: message(501, subject) },
      parts: { '1': new TextEncoder().encode(body) },
    });
    const response = await harness.handler()(request());

    expect(await response.json()).toEqual({ status: 'completed', discovered: 1, ingested: 1, skipped_absent: 0 });
    const ingress = harness.rpc('ingest_mail_intake_item')[0]?.body;
    expect(ingress).toMatchObject({
      p_subject: subject,
      p_vessel_voyage: 'TEST STAR 2609E',
      p_port_name: 'TEST PORT, KOREA / TEST TERMINAL',
      p_delivery_window: '02~07th Sep 2026',
      p_fuel_items: [
        { grade: 'hsfo', quantity: 700 },
        { grade: 'lsmgo', quantity: 50 },
      ],
      p_warnings: [],
    });
    expect(String(ingress?.p_subject).startsWith('//SPOT//')).toBe(true);
    expect(ingress?.p_warnings).not.toContainEqual(expect.stringContaining('Invalid HSHFO quantity'));
    expect(ingress?.p_warnings).not.toContainEqual(expect.stringContaining('Invalid LSMGO quantity'));
    expect(ingress).not.toHaveProperty('p_deadline_at');
    expect(ingress).not.toHaveProperty('p_responsible_buyer');
    expect(ingress).not.toHaveProperty('p_raw_body');
  });
  it('ingests supported quantity ranges with lower-bound candidates and verification warnings', async () => {
    const subject = '//SPOT// TEST RANGE VESSEL / BUNKER REQUEST AT TEST PORT';
    const body = [
      'VLSFO : 40-50 MT',
      'LSMGO : 100 ~ 150 M/T',
    ].join('\n');
    const harness = new Harness({
      uidNext: 502,
      uids: [501],
      messages: { 501: message(501, subject) },
      parts: { '1': new TextEncoder().encode(body) },
    });
    const response = await harness.handler()(request());

    expect(await response.json()).toEqual({ status: 'completed', discovered: 1, ingested: 1, skipped_absent: 0 });
    const ingress = harness.rpc('ingest_mail_intake_item')[0]?.body;
    expect(ingress?.p_fuel_items).toEqual([
      { grade: 'vlsfo', quantity: 40 },
      { grade: 'lsmgo', quantity: 100 },
    ]);
    expect(ingress?.p_warnings).toEqual([
      'VLSFO quantity range was imported using its lower bound; verify before creating the bid.',
      'LSMGO quantity range was imported using its lower bound; verify before creating the bid.',
    ]);
    expect(ingress?.p_warnings).not.toContainEqual(expect.stringContaining('Invalid VLSFO quantity was not imported'));
    expect(ingress?.p_warnings).not.toContainEqual(expect.stringContaining('Invalid LSMGO quantity was not imported'));
  });
  it('filters an ordinary subject before body download without treating it as absent', async () => {
    const harness = new Harness({ uidNext: 502, uids: [501], messages: { 501: message(501, 'BUNKER REQUEST AT BUSAN') } });
    const response = await harness.handler()(request());

    expect(await response.json()).toEqual({ status: 'completed', discovered: 1, ingested: 0, skipped_absent: 0 });
    expect(harness.imap.fetched).toEqual([501]);
    expect(harness.imap.downloads).toEqual([]);
    expect(harness.rpc('ingest_mail_intake_item')).toEqual([]);
    expect(harness.rpc('compare_and_swap_mail_connector_cursor')).toHaveLength(1);
  });
  it.each([
    'RE: //SPOT// TEST VESSEL 001E / BUNKER REQUEST AT BUSAN',
    ' //SPOT// TEST VESSEL 001E / BUNKER REQUEST AT BUSAN',
    '//spot// TEST VESSEL 001E / BUNKER REQUEST AT BUSAN',
  ])('filters a non-exact subject prefix before body download: %s', async (subject) => {
    const harness = new Harness({ uidNext: 502, uids: [501], messages: { 501: message(501, subject) } });
    const response = await harness.handler()(request());

    expect(await response.json()).toEqual({ status: 'completed', discovered: 1, ingested: 0, skipped_absent: 0 });
    expect(harness.imap.downloads).toEqual([]);
    expect(harness.rpc('ingest_mail_intake_item')).toEqual([]);
    expect(harness.rpc('compare_and_swap_mail_connector_cursor')).toHaveLength(1);
  });
  it('handles exact-prefix, filtered, and definitively absent messages in one snapshot before one cursor advance', async () => {
    const harness = new Harness({
      uidNext: 505,
      uids: [504, 502, 503, 501],
      messages: {
        501: message(501, '//SPOT// FIRST VESSEL 001E / BUNKER REQUEST AT BUSAN'),
        502: message(502, 'RE: //SPOT// FILTERED'),
        503: null,
        504: message(504, '//SPOT//SECOND VESSEL 002W / BUNKER REQUEST AT ULSAN'),
      },
    });
    const response = await harness.handler()(request());

    expect(await response.json()).toEqual({ status: 'completed', discovered: 4, ingested: 2, skipped_absent: 1 });
    expect(harness.imap.fetched).toEqual([501, 502, 503, 504]);
    expect(harness.imap.downloads.map(([uid]) => uid)).toEqual([501, 504]);
    expect(harness.rpc('ingest_mail_intake_item').map((call) => call.body.p_source_message_id)).toEqual(['100:501', '100:504']);
    expect(harness.rpc('compare_and_swap_mail_connector_cursor')).toHaveLength(1);
    expect(harness.rpc('compare_and_swap_mail_connector_cursor')[0]?.body.p_cursor_value).toBe('imap-v1:100:504');
  });
  it('fails closed without ingest or cursor reset when UIDVALIDITY changes', async () => {
    const harness = new Harness({ uidValidity: 101n }); const response = await harness.handler()(request());
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ status: 'error', code: 'gmail_imap_uidvalidity_changed' });
    expect(harness.rpc('ingest_mail_intake_item')).toEqual([]); expect(harness.rpc('compare_and_swap_mail_connector_cursor')).toEqual([]);
  });
  it('continues after definitive absence, reports only an aggregate, then advances once', async () => {
    const harness = new Harness({ uids: [501, 502], uidNext: 503, messages: { 501: null, 502: message(502) } }); const response = await harness.handler()(request());
    const payload = await response.json();
    expect(payload).toEqual({ status: 'completed', discovered: 2, ingested: 1, skipped_absent: 1 }); expect(harness.rpc('ingest_mail_intake_item')).toHaveLength(1); expect(harness.rpc('compare_and_swap_mail_connector_cursor')).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain('501');
  });
  it.each(['connectError', 'downloadError', 'ingestFailure'] as const)('does not advance cursor after %s', async (failure) => {
    const harness = new Harness({ [failure]: true }); const response = await harness.handler()(request());
    expect(response.status).toBeGreaterThanOrEqual(500); expect(harness.rpc('compare_and_swap_mail_connector_cursor')).toEqual([]); expect(harness.imap.closes).toBe(1);
  });
  it('keeps the fixed TLS endpoint and the adapter exposes no mutation operation', () => {
    expect(GMAIL_IMAP_CONNECTION).toEqual({ host: 'imap.gmail.com', port: 993, secure: true, mailbox: 'INBOX', readOnly: true });
    expect(GMAIL_IMAP_CLIENT_OPTIONS).toEqual({ host: 'imap.gmail.com', port: 993, secure: true, logger: false, disableAutoIdle: true });
    expect(Object.keys(new FakeImap({}))).not.toContain('messageFlagsAdd');
  });
  it('retries ingest serialization failures twice before completing and advances the cursor once', async () => {
    const harness = new Harness({ uidNext: 502, uids: [501], ingestResults: ['40001', '40001', 'success'] });
    const response = await harness.handler()(request());

    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: 'completed', discovered: 1, ingested: 1, skipped_absent: 0 });
    expect(harness.rpc('ingest_mail_intake_item')).toHaveLength(3); expect(harness.rpc('compare_and_swap_mail_connector_cursor')).toHaveLength(1);
  });
  it('fails after three ingest serialization failures without advancing the cursor', async () => {
    const harness = new Harness({ uidNext: 502, uids: [501], ingestResults: ['40001', '40001', '40001'] });
    const response = await harness.handler()(request());

    expect(response.status).toBe(502); expect(await response.json()).toEqual({ status: 'error', code: 'ingest_failed' });
    expect(harness.rpc('ingest_mail_intake_item')).toHaveLength(3); expect(harness.rpc('compare_and_swap_mail_connector_cursor')).toHaveLength(0);
  });
  it('downloads only inline text/plain parts, never HTML, attachments, or filename-bearing parts', async () => {
    const mixed = { type: 'multipart/mixed', childNodes: [{ part: '1', type: 'text/plain' }, { part: '2', type: 'text/html' }, { part: '3', type: 'text/plain', disposition: 'attachment' }, { part: '4', type: 'text/plain', parameters: { name: 'request.txt' } }] };
    const harness = new Harness({ uidNext: 502, uids: [501], messages: { 501: { ...message(501), bodyStructure: mixed } } }); await harness.handler()(request());
    expect(harness.imap.downloads.map((call) => call[1])).toEqual(['1']);
  });
  it('downloads a single-part root plaintext body as IMAP part 1 and ingests it once', async () => {
    const rootPlainText = { type: 'text/plain', parameters: { charset: 'UTF-8' }, encoding: '7bit', size: 42 };
    const harness = new Harness({ uidNext: 505, uids: [504], messages: { 504: { ...message(504), internalDate: new Date('2026-10-03T04:05:06.000Z'), bodyStructure: rootPlainText } }, parts: { '1': new TextEncoder().encode('PORT : ROOT TEST PORT\nVLSFO : 25 MT') } });
    const response = await harness.handler()(request());

    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: 'completed', discovered: 1, ingested: 1, skipped_absent: 0 });
    expect(harness.imap.downloads).toEqual([[504, '1', MAX_DECODED_PLAIN_TEXT_BYTES + 1]]);
    expect(harness.imap.downloads.every(([, part]) => typeof part === 'string' && part !== '')).toBe(true);
    expect(harness.rpc('ingest_mail_intake_item')).toHaveLength(1);
    expect(harness.rpc('ingest_mail_intake_item')[0]?.body).toMatchObject({ p_source_message_id: '100:504', p_received_at: '2026-10-03T04:05:06.000Z', p_port_name: 'ROOT TEST PORT' });
    expect(harness.rpc('compare_and_swap_mail_connector_cursor')).toHaveLength(1);
    expect(harness.rpc('compare_and_swap_mail_connector_cursor')[0]?.body.p_cursor_value).toBe('imap-v1:100:504');
  });
  it('fails closed when an eligible non-root plaintext node has no part', async () => {
    const malformedNestedPlainText = { type: 'multipart/mixed', childNodes: [{ type: 'text/plain' }] };
    const harness = new Harness({ uidNext: 502, uids: [501], messages: { 501: { ...message(501), bodyStructure: malformedNestedPlainText } } });
    const response = await harness.handler()(request());

    expect(response.status).toBe(502); expect(await response.json()).toEqual({ status: 'error', code: 'gmail_message_invalid' });
    expect(harness.imap.downloads).toEqual([]); expect(harness.rpc('ingest_mail_intake_item')).toEqual([]); expect(harness.rpc('compare_and_swap_mail_connector_cursor')).toEqual([]);
  });
  it('does not hard-fail or download a single-part root HTML body without a part', async () => {
    const rootHtml = { type: 'text/html', parameters: { charset: 'UTF-8' }, encoding: '7bit', size: 42 };
    const harness = new Harness({ uidNext: 502, uids: [501], messages: { 501: { ...message(501), bodyStructure: rootHtml } } });
    const response = await harness.handler()(request());

    expect(response.status).toBe(200); expect(harness.imap.downloads).toEqual([]);
    expect(harness.rpc('ingest_mail_intake_item')[0]?.body.p_warnings).toContain('No inline plain-text content was available for analysis.');
  });
  it.each([
    { type: 'text/plain', disposition: 'attachment' },
    { type: 'text/plain', parameters: { name: 'request.txt' } },
    { type: 'text/plain', dispositionParameters: { filename: 'request.txt' } },
  ])('excludes root attachment or filename-bearing plaintext without a part: %o', async (rootPlainText) => {
    const harness = new Harness({ uidNext: 502, uids: [501], messages: { 501: { ...message(501), bodyStructure: rootPlainText } } });
    const response = await harness.handler()(request());

    expect(response.status).toBe(200); expect(harness.imap.downloads).toEqual([]);
    expect(harness.rpc('ingest_mail_intake_item')[0]?.body.p_warnings).toContain('No inline plain-text content was available for analysis.');
  });
  it('rejects oversized aggregate plain text without partial business analysis', async () => {
    const oversized = new Uint8Array(MAX_DECODED_PLAIN_TEXT_BYTES + 1); oversized.fill('x'.charCodeAt(0));
    const harness = new Harness({ uidNext: 502, uids: [501], parts: { '1': oversized } }); await harness.handler()(request());
    const ingress = harness.rpc('ingest_mail_intake_item')[0]?.body; expect(ingress?.p_fuel_items).toEqual([]); expect(ingress?.p_warnings).toContain('Plain-text content exceeded the connector size limit and was not analyzed.');
  });
  it.each(['A😀'.repeat(300), 'bad\ud800subject', 'bad\udc00subject'])('normalizes Unicode subjects safely before ingress', async (subject) => {
    const harness = new Harness({ uidNext: 502, uids: [501], messages: { 501: message(501, `//SPOT// ${subject}`) } }); await harness.handler()(request());
    const ingress = harness.rpc('ingest_mail_intake_item')[0]?.body; expect(ingress?.p_subject).not.toContain('\ud800'); expect(ingress?.p_subject).not.toContain('\udc00');
  });
  it('uses IMAP INTERNALDATE rather than an envelope Date header', async () => {
    const harness = new Harness({ uidNext: 502, uids: [501], messages: { 501: { ...message(501), internalDate: new Date('2026-10-02T03:04:05.000Z') } } }); await harness.handler()(request());
    expect(harness.rpc('ingest_mail_intake_item')[0]?.body.p_received_at).toBe('2026-10-02T03:04:05.000Z');
  });
  it('fails closed on a stale cursor CAS and strictly rejects malformed cursor state', async () => {
    const harness = new Harness({ casConflict: true }); const response = await harness.handler()(request());
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ status: 'error', code: 'cursor_conflict' });
    for (const value of ['100:5', 'imap-v1:0:5', 'imap-v1:01:5', 'imap-v1:1:-1', `imap-v1:${'9'.repeat(40)}:1`]) expect(() => parseImapCursor(value)).toThrow();
  });
});
