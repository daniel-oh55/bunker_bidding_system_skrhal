import { parseBunkerRequest } from '../../../src/bidding/bid-intake.ts';

export const GMAIL_OAUTH_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const CONNECTOR_TRIGGER_HEADER = 'x-gmail-connector-secret';
export const MAX_DECODED_PLAIN_TEXT_BYTES = 256 * 1024;

const SOURCE_PROVIDER = 'gmail';
const MAX_SUBJECT_LENGTH = 512;
const MAX_CANDIDATE_LENGTH = 256;
const MAX_INGEST_ATTEMPTS = 3;
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GMAIL_API_ROOT = 'https://gmail.googleapis.com/gmail/v1/users/me';
const encoder = new TextEncoder();

type EnvironmentReader = (name: string) => string | undefined;

export type ConnectorDependencies = {
  env: EnvironmentReader;
  fetch: typeof fetch;
};

type ConnectorConfig = {
  oauthClientId: string;
  oauthClientSecret: string;
  oauthRefreshToken: string;
  accountEmail: string;
  mailboxKey: string;
  triggerSecret: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
};

type CursorState = {
  cursorValue: string;
  revision: number;
};

type GmailMessagePart = {
  mimeType?: unknown;
  filename?: unknown;
  headers?: unknown;
  body?: unknown;
  parts?: unknown;
};

class OperationalError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, httpStatus = 502) {
    super(code);
    this.name = 'OperationalError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function fixedErrorResponse(error: unknown): Response {
  if (error instanceof OperationalError) {
    return jsonResponse({ status: 'error', code: error.code }, error.httpStatus);
  }
  return jsonResponse({ status: 'error', code: 'connector_failed' }, 500);
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function requiredValue(env: EnvironmentReader, name: string): string {
  const value = env(name);
  if (!value || value.trim() === '') {
    throw new OperationalError('connector_configuration_invalid', 500);
  }
  return value;
}

function readSupabaseSecretKey(env: EnvironmentReader): string {
  const rawKeys = requiredValue(env, 'SUPABASE_SECRET_KEYS');
  try {
    const parsed = JSON.parse(rawKeys) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid key map');
    }
    const key = (parsed as Record<string, unknown>).default;
    if (typeof key !== 'string' || key.trim() === '') {
      throw new Error('missing default key');
    }
    return key;
  } catch {
    throw new OperationalError('connector_configuration_invalid', 500);
  }
}

function readConfig(env: EnvironmentReader, triggerSecret: string): ConnectorConfig {
  const mailboxKey = requiredValue(env, 'GMAIL_MAILBOX_KEY');
  if (
    mailboxKey !== mailboxKey.trim()
    || mailboxKey.length > 128
    || mailboxKey.includes('@')
  ) {
    throw new OperationalError('connector_configuration_invalid', 500);
  }

  const accountEmail = requiredValue(env, 'GMAIL_ACCOUNT_EMAIL');
  const supabaseUrl = requiredValue(env, 'SUPABASE_URL');
  try {
    const parsedUrl = new URL(supabaseUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('invalid protocol');
    }
  } catch {
    throw new OperationalError('connector_configuration_invalid', 500);
  }

  return {
    oauthClientId: requiredValue(env, 'GMAIL_OAUTH_CLIENT_ID'),
    oauthClientSecret: requiredValue(env, 'GMAIL_OAUTH_CLIENT_SECRET'),
    oauthRefreshToken: requiredValue(env, 'GMAIL_OAUTH_REFRESH_TOKEN'),
    accountEmail,
    mailboxKey,
    triggerSecret,
    supabaseUrl: supabaseUrl.replace(/\/$/, ''),
    supabaseSecretKey: readSupabaseSecretKey(env),
  };
}

async function responseJson(response: Response, code: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new OperationalError(code);
  }
}

function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperationalError(code);
  }
  return value as Record<string, unknown>;
}

async function refreshAccessToken(config: ConnectorConfig, fetcher: typeof fetch): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.oauthClientId,
    client_secret: config.oauthClientSecret,
    refresh_token: config.oauthRefreshToken,
    grant_type: 'refresh_token',
    scope: GMAIL_OAUTH_SCOPE,
  });
  let response: Response;
  try {
    response = await fetcher(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    throw new OperationalError('gmail_oauth_failed');
  }
  if (!response.ok) {
    throw new OperationalError('gmail_oauth_failed');
  }
  const payload = objectValue(await responseJson(response, 'gmail_oauth_failed'), 'gmail_oauth_failed');
  const accessToken = payload.access_token;
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new OperationalError('gmail_oauth_failed');
  }
  const returnedScope = payload.scope;
  if (typeof returnedScope !== 'string' || returnedScope.trim() === '') {
    throw new OperationalError('gmail_oauth_scope_invalid');
  }
  const returnedScopes = new Set(returnedScope.trim().split(/\s+/));
  if (returnedScopes.size !== 1 || !returnedScopes.has(GMAIL_OAUTH_SCOPE)) {
    throw new OperationalError('gmail_oauth_scope_invalid');
  }
  return accessToken;
}

async function gmailGet(
  fetcher: typeof fetch,
  accessToken: string,
  url: URL,
  errorCode: string,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new OperationalError(errorCode);
  }
  if (!response.ok) {
    if (errorCode === 'gmail_history_failed' && response.status === 404) {
      throw new OperationalError('gmail_history_stale', 409);
    }
    throw new OperationalError(errorCode);
  }
  return objectValue(await responseJson(response, errorCode), errorCode);
}

async function supabaseRpc(
  config: ConnectorConfig,
  fetcher: typeof fetch,
  functionName: string,
  parameters: Record<string, unknown>,
  errorCode: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: {
        apikey: config.supabaseSecretKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(parameters),
    });
  } catch {
    throw new OperationalError(errorCode);
  }
  if (!response.ok) {
    let code: unknown;
    try {
      const errorPayload = objectValue(await response.json(), errorCode);
      code = errorPayload.code;
    } catch {
      code = undefined;
    }
    if (code === '40001') {
      throw new OperationalError('serialization_failure', 409);
    }
    throw new OperationalError(errorCode);
  }
  return responseJson(response, errorCode);
}

function cursorRow(value: unknown, allowMissing: boolean): CursorState | null {
  if (!Array.isArray(value)) {
    throw new OperationalError('cursor_read_failed');
  }
  if (value.length === 0 && allowMissing) return null;
  if (value.length !== 1) {
    throw new OperationalError('cursor_read_failed');
  }
  const row = objectValue(value[0], 'cursor_read_failed');
  if (
    typeof row.cursor_value !== 'string'
    || row.cursor_value === ''
    || !Number.isSafeInteger(row.revision)
    || Number(row.revision) < 1
  ) {
    throw new OperationalError('cursor_read_failed');
  }
  return { cursorValue: row.cursor_value, revision: Number(row.revision) };
}

async function getCursor(config: ConnectorConfig, fetcher: typeof fetch): Promise<CursorState | null> {
  const payload = await supabaseRpc(config, fetcher, 'get_mail_connector_cursor', {
    p_source_provider: SOURCE_PROVIDER,
    p_source_mailbox_key: config.mailboxKey,
  }, 'cursor_read_failed');
  return cursorRow(payload, true);
}

async function compareAndSwapCursor(
  config: ConnectorConfig,
  fetcher: typeof fetch,
  expectedRevision: number | null,
  cursorValue: string,
): Promise<void> {
  try {
    const payload = await supabaseRpc(config, fetcher, 'compare_and_swap_mail_connector_cursor', {
      p_source_provider: SOURCE_PROVIDER,
      p_source_mailbox_key: config.mailboxKey,
      p_expected_revision: expectedRevision,
      p_cursor_value: cursorValue,
    }, 'cursor_write_failed');
    cursorRow(payload, false);
  } catch (error) {
    if (error instanceof OperationalError && error.code === 'serialization_failure') {
      throw new OperationalError('cursor_conflict', 409);
    }
    throw error;
  }
}

function base64UrlBytes(data: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(data)) return null;
  const paddingLength = (4 - (data.length % 4)) % 4;
  try {
    const decoded = atob(`${data.replaceAll('-', '+').replaceAll('_', '/')}${'='.repeat(paddingLength)}`);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function stringProperty(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function extractInlinePlainText(payload: unknown): { body: string; warnings: string[] } {
  const root = objectValue(payload, 'gmail_message_invalid') as GmailMessagePart;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let plainPartCount = 0;
  let incomplete = false;
  let oversize = false;
  let visitedParts = 0;

  const visit = (part: GmailMessagePart, depth: number): void => {
    visitedParts += 1;
    if (visitedParts > 1_000 || depth > 50) {
      incomplete = true;
      return;
    }

    const filename = stringProperty(part.filename) ?? '';
    const body = part.body && typeof part.body === 'object' && !Array.isArray(part.body)
      ? part.body as Record<string, unknown>
      : {};
    if (filename !== '' || typeof body.attachmentId === 'string') return;

    if ((stringProperty(part.mimeType) ?? '').toLowerCase() === 'text/plain') {
      plainPartCount += 1;
      const data = stringProperty(body.data);
      if (data === undefined) {
        incomplete = true;
        return;
      }
      const estimatedBytes = Math.floor((data.length * 3) / 4);
      if (estimatedBytes > MAX_DECODED_PLAIN_TEXT_BYTES - totalBytes) {
        oversize = true;
        return;
      }
      const bytes = base64UrlBytes(data);
      if (!bytes) {
        incomplete = true;
        return;
      }
      if (bytes.byteLength > MAX_DECODED_PLAIN_TEXT_BYTES - totalBytes) {
        oversize = true;
        return;
      }
      const declaredSize = body.size;
      if (typeof declaredSize === 'number' && declaredSize > bytes.byteLength) incomplete = true;
      if (chunks.length > 0) {
        if (totalBytes === MAX_DECODED_PLAIN_TEXT_BYTES) {
          oversize = true;
          return;
        }
        chunks.push(Uint8Array.of(10));
        totalBytes += 1;
      }
      chunks.push(bytes);
      totalBytes += bytes.byteLength;
    }

    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          visit(child as GmailMessagePart, depth + 1);
        } else {
          incomplete = true;
        }
      }
    }
  };

  visit(root, 0);
  if (oversize) {
    return {
      body: '',
      warnings: ['Plain-text content exceeded the connector size limit and was not analyzed.'],
    };
  }

  const warnings: string[] = [];
  if (plainPartCount === 0) {
    warnings.push('No inline plain-text content was available for analysis.');
  } else if (incomplete) {
    warnings.push('Plain-text content was unavailable or incomplete and was not fully analyzed.');
  }
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: new TextDecoder().decode(combined), warnings };
}

function normalizeBounded(value: string | undefined, limit: number): string | null {
  if (value === undefined) return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized === '' || normalized.length > limit) return null;
  return normalized;
}

function normalizedSubject(payload: GmailMessagePart): { subject: string; warning?: string } {
  if (!Array.isArray(payload.headers)) return { subject: '' };
  const header = payload.headers.find((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    return stringProperty((candidate as Record<string, unknown>).name)?.toLowerCase() === 'subject';
  }) as Record<string, unknown> | undefined;
  const raw = stringProperty(header?.value) ?? '';
  const normalized = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_SUBJECT_LENGTH) return { subject: normalized };
  return {
    subject: normalized.slice(0, MAX_SUBJECT_LENGTH).trimEnd(),
    warning: 'Subject exceeded the connector size limit and was truncated.',
  };
}

function boundedWarnings(values: string[]): string[] {
  return [...new Set(values)]
    .filter((value) => value.trim() !== '')
    .map((value) => value.slice(0, 300))
    .slice(0, 20);
}

function receivedAt(internalDate: unknown): string {
  if (typeof internalDate !== 'string' || !/^\d{1,16}$/.test(internalDate)) {
    throw new OperationalError('gmail_message_invalid');
  }
  const milliseconds = Number(internalDate);
  const date = new Date(milliseconds);
  if (!Number.isSafeInteger(milliseconds) || !Number.isFinite(date.getTime())) {
    throw new OperationalError('gmail_message_invalid');
  }
  return date.toISOString();
}

async function ingestMessage(
  config: ConnectorConfig,
  fetcher: typeof fetch,
  accessToken: string,
  messageId: string,
): Promise<void> {
  const url = new URL(`${GMAIL_API_ROOT}/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set('format', 'full');
  const message = await gmailGet(fetcher, accessToken, url, 'gmail_message_failed');
  if (message.id !== messageId || !message.payload) {
    throw new OperationalError('gmail_message_invalid');
  }

  const payload = objectValue(message.payload, 'gmail_message_invalid') as GmailMessagePart;
  const subjectResult = normalizedSubject(payload);
  const plainText = extractInlinePlainText(payload);
  const parsed = parseBunkerRequest({ subject: subjectResult.subject, body: plainText.body });
  const warnings = [...plainText.warnings, ...parsed.warnings];
  if (subjectResult.warning) warnings.push(subjectResult.warning);

  const vesselVoyage = normalizeBounded(parsed.vesselVoyage, MAX_CANDIDATE_LENGTH);
  const portName = normalizeBounded(parsed.portName, MAX_CANDIDATE_LENGTH);
  const deliveryWindow = normalizeBounded(parsed.deliveryWindow, MAX_CANDIDATE_LENGTH);
  if (parsed.vesselVoyage && !vesselVoyage) warnings.push('Vessel/voyage candidate exceeded the connector limit and was omitted.');
  if (parsed.portName && !portName) warnings.push('Port candidate exceeded the connector limit and was omitted.');
  if (parsed.deliveryWindow && !deliveryWindow) warnings.push('Delivery-window candidate exceeded the connector limit and was omitted.');

  const parameters = {
    p_source_provider: SOURCE_PROVIDER,
    p_source_mailbox_key: config.mailboxKey,
    p_source_message_id: messageId,
    p_received_at: receivedAt(message.internalDate),
    p_subject: subjectResult.subject,
    p_vessel_voyage: vesselVoyage,
    p_port_name: portName,
    p_delivery_window: deliveryWindow,
    p_fuel_items: parsed.fuelItems,
    p_warnings: boundedWarnings(warnings),
  };

  for (let attempt = 1; attempt <= MAX_INGEST_ATTEMPTS; attempt += 1) {
    try {
      await supabaseRpc(config, fetcher, 'ingest_mail_intake_item', parameters, 'ingest_failed');
      return;
    } catch (error) {
      if (!(error instanceof OperationalError) || error.code !== 'serialization_failure') throw error;
      if (attempt === MAX_INGEST_ATTEMPTS) throw new OperationalError('ingest_failed');
    }
  }
}

async function discoverMessageIds(
  fetcher: typeof fetch,
  accessToken: string,
  startHistoryId: string,
): Promise<{ messageIds: string[]; currentHistoryId: string }> {
  const messageIds = new Set<string>();
  const seenPageTokens = new Set<string>();
  let pageToken: string | undefined;
  let currentHistoryId: string | undefined;

  do {
    const url = new URL(`${GMAIL_API_ROOT}/history`);
    url.searchParams.set('startHistoryId', startHistoryId);
    url.searchParams.set('historyTypes', 'messageAdded');
    url.searchParams.set('labelId', 'INBOX');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const page = await gmailGet(fetcher, accessToken, url, 'gmail_history_failed');
    if (typeof page.historyId !== 'string' || page.historyId === '') {
      throw new OperationalError('gmail_history_failed');
    }
    currentHistoryId = page.historyId;
    if (Array.isArray(page.history)) {
      for (const historyEntry of page.history) {
        if (!historyEntry || typeof historyEntry !== 'object' || Array.isArray(historyEntry)) continue;
        const additions = (historyEntry as Record<string, unknown>).messagesAdded;
        if (!Array.isArray(additions)) continue;
        for (const addition of additions) {
          if (!addition || typeof addition !== 'object' || Array.isArray(addition)) continue;
          const message = (addition as Record<string, unknown>).message;
          if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
          const row = message as Record<string, unknown>;
          const id = stringProperty(row.id);
          const labels = row.labelIds;
          const isInbox = !Array.isArray(labels) || labels.includes('INBOX');
          if (id && isInbox) messageIds.add(id);
        }
      }
    }

    const nextPageToken = stringProperty(page.nextPageToken);
    if (nextPageToken) {
      if (seenPageTokens.has(nextPageToken)) throw new OperationalError('gmail_history_failed');
      seenPageTokens.add(nextPageToken);
    }
    pageToken = nextPageToken;
  } while (pageToken);

  if (!currentHistoryId) throw new OperationalError('gmail_history_failed');
  return { messageIds: [...messageIds], currentHistoryId };
}

async function runConnector(config: ConnectorConfig, fetcher: typeof fetch): Promise<Response> {
  const accessToken = await refreshAccessToken(config, fetcher);
  const profile = await gmailGet(fetcher, accessToken, new URL(`${GMAIL_API_ROOT}/profile`), 'gmail_profile_failed');
  if (profile.emailAddress !== config.accountEmail) throw new OperationalError('gmail_profile_mismatch', 409);
  if (typeof profile.historyId !== 'string' || profile.historyId === '') {
    throw new OperationalError('gmail_profile_failed');
  }

  const cursor = await getCursor(config, fetcher);
  if (!cursor) {
    await compareAndSwapCursor(config, fetcher, null, profile.historyId);
    return jsonResponse({ status: 'initialized', discovered: 0, ingested: 0 }, 200);
  }

  const discovery = await discoverMessageIds(fetcher, accessToken, cursor.cursorValue);
  let ingested = 0;
  for (const messageId of discovery.messageIds) {
    await ingestMessage(config, fetcher, accessToken, messageId);
    ingested += 1;
  }
  await compareAndSwapCursor(config, fetcher, cursor.revision, discovery.currentHistoryId);
  return jsonResponse({ status: 'completed', discovered: discovery.messageIds.length, ingested }, 200);
}

export function createGmailMailIntakeHandler(dependencies: ConnectorDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') {
      return jsonResponse({ status: 'error', code: 'method_not_allowed' }, 405);
    }

    const configuredTriggerSecret = dependencies.env('GMAIL_CONNECTOR_TRIGGER_SECRET');
    if (!configuredTriggerSecret || configuredTriggerSecret.trim() === '') {
      return jsonResponse({ status: 'error', code: 'connector_configuration_invalid' }, 500);
    }
    const suppliedTriggerSecret = request.headers.get(CONNECTOR_TRIGGER_HEADER) ?? '';
    if (!constantTimeEqual(suppliedTriggerSecret, configuredTriggerSecret)) {
      return jsonResponse({ status: 'error', code: 'unauthorized' }, 401);
    }

    try {
      const config = readConfig(dependencies.env, configuredTriggerSecret);
      return await runConnector(config, dependencies.fetch);
    } catch (error) {
      return fixedErrorResponse(error);
    }
  };
}
