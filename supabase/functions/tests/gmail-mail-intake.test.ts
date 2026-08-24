import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import {
  CONNECTOR_TRIGGER_HEADER,
  createGmailMailIntakeHandler,
  extractInlinePlainText,
  GMAIL_OAUTH_SCOPE,
  MAX_DECODED_PLAIN_TEXT_BYTES,
} from '../_shared/gmail-mail-intake.ts';

const TRIGGER_SECRET = 'fixture-trigger-value';
const ACCESS_TOKEN = 'fixture-access-value';
const CLIENT_SECRET = 'fixture-client-value';
const REFRESH_TOKEN = 'fixture-refresh-value';
const DATABASE_SECRET = 'fixture-database-value';

const baseEnvironment: Record<string, string> = {
  GMAIL_OAUTH_CLIENT_ID: 'fixture-client-id',
  GMAIL_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
  GMAIL_OAUTH_REFRESH_TOKEN: REFRESH_TOKEN,
  GMAIL_ACCOUNT_EMAIL: 'connector-mailbox@example.test',
  GMAIL_MAILBOX_KEY: 'gmail-bunker-primary',
  GMAIL_CONNECTOR_TRIGGER_SECRET: TRIGGER_SECRET,
  SUPABASE_URL: 'https://database.example.test',
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: DATABASE_SECRET }),
};

type FetchCall = {
  url: URL;
  init: RequestInit;
  body: unknown;
};

type HarnessOptions = {
  cursor?: { cursor_value: string; revision: number } | null;
  profile?: Record<string, unknown>;
  historyPages?: Record<string, Record<string, unknown>>;
  historyStatus?: number;
  messages?: Record<string, Record<string, unknown>>;
  messageStatuses?: Record<string, number>;
  ingestResults?: Array<'ok' | '40001' | 'failed'>;
  cursorCasResult?: 'ok' | '40001' | 'failed';
  oauthStatus?: number;
  oauthScope?: unknown;
};

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function plainMessage(
  id: string,
  body = 'PORT : TEST PORT\nDELIVERY WINDOW : 01-02 SEP 2026\nVLSFO : 25 MT',
  subject = 'TEST VESSEL 2601E / BUNKER REQUEST AT TEST PORT',
  internalDate = '1788134400000',
): Record<string, unknown> {
  return {
    id,
    internalDate,
    payload: {
      mimeType: 'multipart/alternative',
      headers: [{ name: 'Subject', value: subject }],
      parts: [
        { mimeType: 'text/plain', filename: '', body: { size: Buffer.byteLength(body), data: base64Url(body) } },
        { mimeType: 'text/html', filename: '', body: { data: base64Url('<b>ignored</b>') } },
      ],
    },
  };
}

class FetchHarness {
  readonly calls: FetchCall[] = [];
  readonly options: HarnessOptions;
  ingestAttempts = 0;

  constructor(options: HarnessOptions = {}) {
    this.options = options;
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    let body: unknown;
    if (typeof init.body === 'string' && init.headers && new Headers(init.headers).get('content-type') === 'application/json') {
      body = JSON.parse(init.body);
    } else {
      body = init.body;
    }
    this.calls.push({ url, init, body });

    if (url.href === 'https://oauth2.googleapis.com/token') {
      if (this.options.oauthStatus) {
        return json({ error: `${CLIENT_SECRET}-${REFRESH_TOKEN}-${ACCESS_TOKEN}` }, this.options.oauthStatus);
      }
      const payload: Record<string, unknown> = { access_token: ACCESS_TOKEN };
      if (this.options.oauthScope !== null) {
        payload.scope = this.options.oauthScope ?? GMAIL_OAUTH_SCOPE;
      }
      return json(payload);
    }
    if (url.pathname.endsWith('/profile')) {
      return json(this.options.profile ?? {
        emailAddress: baseEnvironment.GMAIL_ACCOUNT_EMAIL,
        historyId: '2000',
      });
    }
    if (url.pathname.endsWith('/rest/v1/rpc/get_mail_connector_cursor')) {
      const cursor = this.options.cursor === undefined
        ? { cursor_value: '1000', revision: 4 }
        : this.options.cursor;
      return json(cursor ? [cursor] : []);
    }
    if (url.pathname.endsWith('/rest/v1/rpc/compare_and_swap_mail_connector_cursor')) {
      if (this.options.cursorCasResult === '40001') return json({ code: '40001' }, 409);
      if (this.options.cursorCasResult === 'failed') return json({ code: 'XX000' }, 500);
      const parameters = body as Record<string, unknown>;
      return json([{
        cursor_value: parameters.p_cursor_value,
        revision: parameters.p_expected_revision === null ? 1 : Number(parameters.p_expected_revision) + 1,
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/rpc/ingest_mail_intake_item')) {
      const result = this.options.ingestResults?.[this.ingestAttempts] ?? 'ok';
      this.ingestAttempts += 1;
      if (result === '40001') return json({ code: '40001' }, 409);
      if (result === 'failed') return json({ code: 'XX000' }, 500);
      return json('00000000-0000-0000-0000-000000000001');
    }
    if (url.pathname.endsWith('/history')) {
      if (this.options.historyStatus) return json({ error: 'fixture history error' }, this.options.historyStatus);
      const pageKey = url.searchParams.get('pageToken') ?? '';
      return json(this.options.historyPages?.[pageKey] ?? { historyId: '2001', history: [] });
    }
    const messageMatch = url.pathname.match(/\/messages\/([^/]+)$/);
    if (messageMatch) {
      const id = decodeURIComponent(messageMatch[1]!);
      const status = this.options.messageStatuses?.[id];
      if (status) return json({ error: 'fixture message error' }, status);
      return json(this.options.messages?.[id] ?? plainMessage(id));
    }
    throw new Error(`Unexpected synthetic request: ${url.href}`);
  };

  callsFor(pathSuffix: string): FetchCall[] {
    return this.calls.filter((call) => call.url.pathname.endsWith(pathSuffix));
  }
}

function handlerFor(harness: FetchHarness, environment: Record<string, string> = baseEnvironment) {
  return createGmailMailIntakeHandler({
    env: (name) => environment[name],
    fetch: harness.fetch as typeof fetch,
  });
}

function authorizedRequest(secret = TRIGGER_SECRET): Request {
  return new Request('https://function.example.test/gmail-mail-intake', {
    method: 'POST',
    headers: { [CONNECTOR_TRIGGER_HEADER]: secret },
  });
}

function rpcBodies(harness: FetchHarness, functionName: string): Array<Record<string, unknown>> {
  return harness.callsFor(`/rest/v1/rpc/${functionName}`).map((call) => call.body as Record<string, unknown>);
}

describe('Gmail mail intake Edge Function', () => {
  it.each([undefined, 'wrong-trigger'])('rejects a %s trigger before any external or RPC work', async (secret) => {
    const harness = new FetchHarness();
    const request = secret === undefined
      ? new Request('https://function.example.test/gmail-mail-intake', { method: 'POST' })
      : authorizedRequest(secret);
    const response = await handlerFor(harness)(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: 'error', code: 'unauthorized' });
    expect(harness.calls).toHaveLength(0);
  });

  it('accepts POST only without treating a browser JWT as authority', async () => {
    const harness = new FetchHarness();
    const response = await handlerFor(harness)(new Request('https://function.example.test/gmail-mail-intake', {
      method: 'GET',
      headers: { authorization: 'Bearer fixture-user-jwt' },
    }));

    expect(response.status).toBe(405);
    expect(harness.calls).toHaveLength(0);
  });

  it('fails closed on missing server configuration after trigger authentication', async () => {
    const harness = new FetchHarness();
    const environment = { ...baseEnvironment };
    delete environment.GMAIL_OAUTH_CLIENT_ID;
    const response = await handlerFor(harness, environment)(authorizedRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ status: 'error', code: 'connector_configuration_invalid' });
    expect(harness.calls).toHaveLength(0);
  });

  it('uses only the exact readonly Gmail OAuth scope contract', () => {
    expect(GMAIL_OAUTH_SCOPE).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(GMAIL_OAUTH_SCOPE).not.toMatch(/gmail\.(?:modify|send|compose)|mail\.google\.com/);
  });

  it('refreshes OAuth using the refresh_token grant without returning credentials', async () => {
    const harness = new FetchHarness({ oauthStatus: 400 });
    const response = await handlerFor(harness)(authorizedRequest());
    const oauthCall = harness.calls[0]!;
    const parameters = new URLSearchParams(String(oauthCall.body));

    expect([...parameters.keys()].sort()).toEqual([
      'client_id',
      'client_secret',
      'grant_type',
      'refresh_token',
      'scope',
    ]);
    expect(parameters.get('client_id')).toBe(baseEnvironment.GMAIL_OAUTH_CLIENT_ID);
    expect(parameters.get('grant_type')).toBe('refresh_token');
    expect(parameters.get('client_secret')).toBe(CLIENT_SECRET);
    expect(parameters.get('refresh_token')).toBe(REFRESH_TOKEN);
    expect(parameters.get('scope')).toBe(GMAIL_OAUTH_SCOPE);
    const returned = JSON.stringify(await response.json());
    expect(returned).toBe('{"status":"error","code":"gmail_oauth_failed"}');
    for (const secret of [CLIENT_SECRET, REFRESH_TOKEN, ACCESS_TOKEN, DATABASE_SECRET, TRIGGER_SECRET]) {
      expect(returned).not.toContain(secret);
    }
  });

  it('accepts an OAuth success response with exactly gmail.readonly', async () => {
    const harness = new FetchHarness({ cursor: null, oauthScope: GMAIL_OAUTH_SCOPE });
    const response = await handlerFor(harness)(authorizedRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'initialized', discovered: 0, ingested: 0 });
    expect(harness.callsFor('/profile')).toHaveLength(1);
  });

  it('fails closed when the OAuth success response omits scope', async () => {
    const harness = new FetchHarness({ oauthScope: null });
    const response = await handlerFor(harness)(authorizedRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ status: 'error', code: 'gmail_oauth_scope_invalid' });
    expect(harness.callsFor('/profile')).toHaveLength(0);
    expect(harness.callsFor('/rest/v1/rpc/get_mail_connector_cursor')).toHaveLength(0);
  });

  it.each([
    `${GMAIL_OAUTH_SCOPE} https://www.googleapis.com/auth/gmail.modify`,
    'https://www.googleapis.com/auth/gmail.modify',
  ])('fails closed on a non-exact OAuth scope response', async (oauthScope) => {
    const harness = new FetchHarness({ oauthScope });
    const response = await handlerFor(harness)(authorizedRequest());
    const returned = JSON.stringify(await response.json());

    expect(response.status).toBe(502);
    expect(returned).toBe('{"status":"error","code":"gmail_oauth_scope_invalid"}');
    expect(returned).not.toContain(oauthScope);
    for (const secret of [CLIENT_SECRET, REFRESH_TOKEN, ACCESS_TOKEN, DATABASE_SECRET, TRIGGER_SECRET]) {
      expect(returned).not.toContain(secret);
    }
    expect(harness.callsFor('/profile')).toHaveLength(0);
    expect(harness.callsFor('/rest/v1/rpc/get_mail_connector_cursor')).toHaveLength(0);
  });

  it('requires the Gmail profile account to match exactly before cursor work', async () => {
    const harness = new FetchHarness({
      profile: { emailAddress: 'different-mailbox@example.test', historyId: '2000' },
    });
    const response = await handlerFor(harness)(authorizedRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ status: 'error', code: 'gmail_profile_mismatch' });
    expect(harness.callsFor('/rest/v1/rpc/get_mail_connector_cursor')).toHaveLength(0);
  });

  it('initializes the current profile historyId on first run and ingests zero history', async () => {
    const harness = new FetchHarness({ cursor: null });
    const response = await handlerFor(harness)(authorizedRequest());

    expect(await response.json()).toEqual({ status: 'initialized', discovered: 0, ingested: 0 });
    expect(harness.callsFor('/history')).toHaveLength(0);
    expect(harness.calls.filter((call) => call.url.pathname.includes('/messages/'))).toHaveLength(0);
    expect(rpcBodies(harness, 'ingest_mail_intake_item')).toHaveLength(0);
    expect(rpcBodies(harness, 'compare_and_swap_mail_connector_cursor')).toEqual([{
      p_source_provider: 'gmail',
      p_source_mailbox_key: 'gmail-bunker-primary',
      p_expected_revision: null,
      p_cursor_value: '2000',
    }]);
  });

  it('uses the final Gmail history page cursor after complete messageAdded INBOX pagination', async () => {
    const harness = new FetchHarness({
      historyPages: {
        '': {
          historyId: '2001',
          nextPageToken: 'next-page',
          history: [
            { messagesAdded: [{ message: { id: 'message-a', labelIds: ['INBOX'] } }] },
            { messages: [{ id: 'ignored-non-added' }] },
          ],
        },
        'next-page': {
          historyId: '2002',
          history: [
            { messagesAdded: [
              { message: { id: 'message-a', labelIds: ['INBOX'] } },
              { message: { id: 'ignored-sent', labelIds: ['SENT'] } },
              { message: { id: 'message-b', labelIds: ['INBOX'] } },
            ] },
          ],
        },
      },
    });
    const response = await handlerFor(harness)(authorizedRequest());
    const historyCalls = harness.callsFor('/history');

    expect(await response.json()).toEqual({ status: 'completed', discovered: 2, ingested: 2, skipped_absent: 0 });
    expect(historyCalls).toHaveLength(2);
    expect(historyCalls[0]!.url.searchParams.get('startHistoryId')).toBe('1000');
    expect(historyCalls[0]!.url.searchParams.get('historyTypes')).toBe('messageAdded');
    expect(historyCalls[0]!.url.searchParams.get('labelId')).toBe('INBOX');
    expect(historyCalls[1]!.url.searchParams.get('pageToken')).toBe('next-page');
    expect(rpcBodies(harness, 'ingest_mail_intake_item').map((body) => body.p_source_message_id)).toEqual(['message-a', 'message-b']);
    // Gmail instructs clients to persist the historyId returned after the final page.
    expect(rpcBodies(harness, 'compare_and_swap_mail_connector_cursor')[0]!.p_cursor_value).toBe('2002');
  });

  it('gets messages in full format, never raw, and never calls the attachment API', async () => {
    const message = plainMessage('message-a');
    (message.payload as Record<string, unknown>).parts = [
      { mimeType: 'text/plain', filename: 'request.txt', body: { attachmentId: 'attachment-fixture', size: 10 } },
      { mimeType: 'text/plain', filename: '', body: { data: base64Url('VLSFO : 20 MT') } },
    ];
    const harness = new FetchHarness({
      historyPages: { '': { historyId: '2001', history: [{ messagesAdded: [{ message: { id: 'message-a', labelIds: ['INBOX'] } }] }] } },
      messages: { 'message-a': message },
    });
    await handlerFor(harness)(authorizedRequest());
    const messageCalls = harness.calls.filter((call) => call.url.pathname.includes('/messages/'));

    expect(messageCalls).toHaveLength(1);
    expect(messageCalls[0]!.url.searchParams.get('format')).toBe('full');
    expect(messageCalls[0]!.url.searchParams.get('format')).not.toBe('raw');
    expect(harness.calls.some((call) => call.url.pathname.includes('/attachments/'))).toBe(false);
  });

  it('does not parse HTML-only content as bunker business text', async () => {
    const harness = new FetchHarness({
      historyPages: { '': { historyId: '2001', history: [{ messagesAdded: [{ message: { id: 'html-only', labelIds: ['INBOX'] } }] }] } },
      messages: {
        'html-only': {
          id: 'html-only',
          internalDate: '1788134400000',
          payload: {
            mimeType: 'text/html',
            headers: [{ name: 'Subject', value: 'Ordinary correspondence' }],
            body: { data: base64Url('<p>PORT : HTML PORT</p><p>VLSFO : 999 MT</p>') },
          },
        },
      },
    });
    await handlerFor(harness)(authorizedRequest());
    const ingress = rpcBodies(harness, 'ingest_mail_intake_item')[0]!;

    expect(ingress.p_port_name).toBeNull();
    expect(ingress.p_fuel_items).toEqual([]);
    expect(ingress.p_warnings).toContain('No inline plain-text content was available for analysis.');
  });

  it('decodes base64url plain text and reuses existing advisory parser semantics in exact ingress mapping', async () => {
    const harness = new FetchHarness({
      historyPages: { '': { historyId: '2001', history: [{ messagesAdded: [{ message: { id: 'message-map', labelIds: ['INBOX'] } }] }] } },
      messages: { 'message-map': plainMessage('message-map') },
    });
    await handlerFor(harness)(authorizedRequest());
    const ingress = rpcBodies(harness, 'ingest_mail_intake_item')[0]!;

    expect(ingress).toMatchObject({
      p_source_provider: 'gmail',
      p_source_mailbox_key: 'gmail-bunker-primary',
      p_source_message_id: 'message-map',
      p_received_at: '2026-08-31T00:00:00.000Z',
      p_subject: 'TEST VESSEL 2601E / BUNKER REQUEST AT TEST PORT',
      p_vessel_voyage: 'TEST VESSEL 2601E',
      p_port_name: 'TEST PORT',
      p_delivery_window: '01-02 SEP 2026',
      p_fuel_items: [{ grade: 'vlsfo', quantity: 25 }],
    });
    expect(ingress).not.toHaveProperty('p_deadline_at');
    expect(ingress).not.toHaveProperty('p_responsible_buyer');
    expect(ingress).not.toHaveProperty('sender');
    expect(ingress).not.toHaveProperty('recipient');
  });

  it('truncates an astral Subject character on a code-point boundary before ingress', async () => {
    const subject = `${'A'.repeat(511)}😀A`;
    const harness = new FetchHarness({
      historyPages: { '': { historyId: '2001', history: [{ messagesAdded: [{ message: { id: 'message-unicode', labelIds: ['INBOX'] } }] }] } },
      messages: { 'message-unicode': plainMessage('message-unicode', undefined, subject) },
    });
    await handlerFor(harness)(authorizedRequest());
    const ingressSubject = String(rpcBodies(harness, 'ingest_mail_intake_item')[0]!.p_subject);

    expect([...ingressSubject]).toHaveLength(512);
    expect(ingressSubject.endsWith('😀')).toBe(true);
    expect(rpcBodies(harness, 'ingest_mail_intake_item')[0]!.p_warnings)
      .toContain('Subject exceeded the connector size limit and was truncated.');
  });

  it('replaces a lone Subject surrogate before ingress', async () => {
    const harness = new FetchHarness({
      historyPages: { '': { historyId: '2001', history: [{ messagesAdded: [{ message: { id: 'message-malformed-subject', labelIds: ['INBOX'] } }] }] } },
      messages: { 'message-malformed-subject': plainMessage('message-malformed-subject', undefined, 'TEST\ud800SUBJECT') },
    });
    await handlerFor(harness)(authorizedRequest());
    const ingressSubject = String(rpcBodies(harness, 'ingest_mail_intake_item')[0]!.p_subject);

    expect(ingressSubject).toBe('TEST\ufffdSUBJECT');
    expect(ingressSubject).not.toContain('\ud800');
  });

  it('enforces the strict total decoded plain-text size bound', () => {
    const oversizedData = Buffer.alloc(MAX_DECODED_PLAIN_TEXT_BYTES + 1, 65).toString('base64url');
    const extracted = extractInlinePlainText({
      mimeType: 'text/plain',
      filename: '',
      body: { size: MAX_DECODED_PLAIN_TEXT_BYTES + 1, data: oversizedData },
    });

    expect(extracted.body).toBe('');
    expect(extracted.warnings).toEqual(['Plain-text content exceeded the connector size limit and was not analyzed.']);
  });

  it('warns on unavailable or truncated inline plain text without retaining MIME data', () => {
    const extracted = extractInlinePlainText({
      mimeType: 'text/plain',
      filename: '',
      body: { size: 100, data: base64Url('short') },
    });

    expect(extracted.body).toBe('short');
    expect(extracted.warnings).toEqual(['Plain-text content was unavailable or incomplete and was not fully analyzed.']);
  });

  it('advances the cursor exactly once only after the entire successful batch', async () => {
    const harness = new FetchHarness({
      historyPages: { '': { historyId: '2999', history: [{ messagesAdded: [
        { message: { id: 'message-a', labelIds: ['INBOX'] } },
        { message: { id: 'message-b', labelIds: ['INBOX'] } },
      ] }] } },
    });
    await handlerFor(harness)(authorizedRequest());

    expect(rpcBodies(harness, 'ingest_mail_intake_item')).toHaveLength(2);
    expect(rpcBodies(harness, 'compare_and_swap_mail_connector_cursor')).toEqual([{
      p_source_provider: 'gmail',
      p_source_mailbox_key: 'gmail-bunker-primary',
      p_expected_revision: 4,
      p_cursor_value: '2999',
    }]);
    const callPaths = harness.calls.map((call) => call.url.pathname);
    expect(callPaths.lastIndexOf('/rest/v1/rpc/compare_and_swap_mail_connector_cursor'))
      .toBeGreaterThan(callPaths.lastIndexOf('/rest/v1/rpc/ingest_mail_intake_item'));
  });

  it('skips only terminal messages.get 404 responses and advances after all remaining messages ingest', async () => {
    const harness = new FetchHarness({
      historyPages: { '': { historyId: '2001', history: [{ messagesAdded: [
        { message: { id: 'message-a', labelIds: ['INBOX'] } },
        { message: { id: 'message-b', labelIds: ['INBOX'] } },
      ] }] } },
      messageStatuses: { 'message-a': 404 },
    });
    const response = await handlerFor(harness)(authorizedRequest());
    const payload = await response.json();

    expect(payload).toEqual({ status: 'completed', discovered: 2, ingested: 1, skipped_absent: 1 });
    expect(JSON.stringify(payload)).not.toContain('message-a');
    expect(rpcBodies(harness, 'ingest_mail_intake_item').map((body) => body.p_source_message_id)).toEqual(['message-b']);
    expect(rpcBodies(harness, 'compare_and_swap_mail_connector_cursor')[0]!.p_cursor_value).toBe('2001');
  });

  it('does not advance the cursor after a partial message retrieval failure', async () => {
    const harness = new FetchHarness({
      historyPages: { '': { historyId: '2001', history: [{ messagesAdded: [
        { message: { id: 'message-a', labelIds: ['INBOX'] } },
        { message: { id: 'message-b', labelIds: ['INBOX'] } },
      ] }] } },
      messageStatuses: { 'message-b': 500 },
    });
    const response = await handlerFor(harness)(authorizedRequest());

    expect(await response.json()).toEqual({ status: 'error', code: 'gmail_message_failed' });
    expect(rpcBodies(harness, 'ingest_mail_intake_item')).toHaveLength(1);
    expect(rpcBodies(harness, 'compare_and_swap_mail_connector_cursor')).toHaveLength(0);
  });

  it.each([401, 403, 429])('does not skip messages.get HTTP %i failures or advance the cursor', async (status) => {
    const harness = new FetchHarness({
      historyPages: { '': { historyId: '2001', history: [{ messagesAdded: [{ message: { id: 'message-a', labelIds: ['INBOX'] } }] }] } },
      messageStatuses: { 'message-a': status },
    });
    const response = await handlerFor(harness)(authorizedRequest());

    expect(await response.json()).toEqual({ status: 'error', code: 'gmail_message_failed' });
    expect(rpcBodies(harness, 'ingest_mail_intake_item')).toHaveLength(0);
    expect(rpcBodies(harness, 'compare_and_swap_mail_connector_cursor')).toHaveLength(0);
  });

  it('does not advance the cursor after an ingest failure', async () => {
    const harness = new FetchHarness({
      historyPages: { '': { historyId: '2001', history: [{ messagesAdded: [{ message: { id: 'message-a', labelIds: ['INBOX'] } }] }] } },
      ingestResults: ['failed'],
    });
    const response = await handlerFor(harness)(authorizedRequest());

    expect(await response.json()).toEqual({ status: 'error', code: 'ingest_failed' });
    expect(rpcBodies(harness, 'compare_and_swap_mail_connector_cursor')).toHaveLength(0);
  });

  it('retries ingest SQLSTATE 40001 only within the bounded attempt limit', async () => {
    const successHarness = new FetchHarness({
      historyPages: { '': { historyId: '2001', history: [{ messagesAdded: [{ message: { id: 'message-a', labelIds: ['INBOX'] } }] }] } },
      ingestResults: ['40001', '40001', 'ok'],
    });
    const successResponse = await handlerFor(successHarness)(authorizedRequest());
    expect(successResponse.status).toBe(200);
    expect(successHarness.ingestAttempts).toBe(3);

    const failureHarness = new FetchHarness({
      historyPages: { '': { historyId: '2001', history: [{ messagesAdded: [{ message: { id: 'message-a', labelIds: ['INBOX'] } }] }] } },
      ingestResults: ['40001', '40001', '40001', 'ok'],
    });
    const failureResponse = await handlerFor(failureHarness)(authorizedRequest());
    expect(await failureResponse.json()).toEqual({ status: 'error', code: 'ingest_failed' });
    expect(failureHarness.ingestAttempts).toBe(3);
    expect(rpcBodies(failureHarness, 'compare_and_swap_mail_connector_cursor')).toHaveLength(0);
  });

  it('fails closed on stale Gmail history 404 without reset, advance, or historical scan', async () => {
    const harness = new FetchHarness({ historyStatus: 404 });
    const response = await handlerFor(harness)(authorizedRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ status: 'error', code: 'gmail_history_stale' });
    expect(rpcBodies(harness, 'compare_and_swap_mail_connector_cursor')).toHaveLength(0);
    expect(harness.calls.some((call) => call.url.pathname.endsWith('/messages'))).toBe(false);
  });

  it('surfaces cursor CAS conflicts without retrying or silently overwriting', async () => {
    const harness = new FetchHarness({ cursorCasResult: '40001' });
    const response = await handlerFor(harness)(authorizedRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ status: 'error', code: 'cursor_conflict' });
    expect(rpcBodies(harness, 'compare_and_swap_mail_connector_cursor')).toHaveLength(1);
  });

  it('never logs or returns configured credentials when an unexpected fetch error occurs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = createGmailMailIntakeHandler({
      env: (name) => baseEnvironment[name],
      fetch: (() => { throw new Error(`${CLIENT_SECRET}-${REFRESH_TOKEN}-${DATABASE_SECRET}`); }) as typeof fetch,
    });
    const response = await handler(authorizedRequest());
    const returned = JSON.stringify(await response.json());

    expect(returned).toBe('{"status":"error","code":"gmail_oauth_failed"}');
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    for (const secret of [CLIENT_SECRET, REFRESH_TOKEN, ACCESS_TOKEN, DATABASE_SECRET, TRIGGER_SECRET]) {
      expect(returned).not.toContain(secret);
    }
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
