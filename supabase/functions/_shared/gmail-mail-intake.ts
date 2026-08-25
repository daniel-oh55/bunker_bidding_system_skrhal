import { parseBunkerRequest } from '../../../src/bidding/bid-intake.ts';
import type { GmailImapAdapter, GmailImapAdapterFactory, ImapMailboxSnapshot, ImapMessageMetadata } from './gmail-imap-adapter.ts';

export const CONNECTOR_TRIGGER_HEADER = 'x-gmail-connector-secret';
export const MAX_DECODED_PLAIN_TEXT_BYTES = 256 * 1024;
const SOURCE_PROVIDER = 'gmail';
const ELIGIBLE_SUBJECT_PREFIX = '//SPOT//';
const MAX_SUBJECT_LENGTH = 512;
const MAX_CANDIDATE_LENGTH = 256;
const MAX_INGEST_ATTEMPTS = 3;
const MAX_SKIPPED_ABSENT_MESSAGES = 1_000;
const MAX_MIME_DEPTH = 50;
const MAX_MIME_PARTS = 1_000;
const encoder = new TextEncoder();

type EnvironmentReader = (name: string) => string | undefined;
export type ConnectorDependencies = { env: EnvironmentReader; fetch: typeof fetch; imapFactory: GmailImapAdapterFactory };
type ConnectorConfig = { imapUser: string; imapAppPassword: string; mailboxKey: string; supabaseUrl: string; supabaseSecretKey: string };
type CursorState = { cursorValue: string; revision: number };
type MessageResult = 'ingested' | 'filtered' | 'absent';
export type ImapCursor = { uidValidity: number; lastUid: number };

class OperationalError extends Error {
  constructor(readonly code: string, readonly httpStatus = 502) { super(code); this.name = 'OperationalError'; }
}
function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
function fixedErrorResponse(error: unknown): Response {
  return error instanceof OperationalError ? jsonResponse({ status: 'error', code: error.code }, error.httpStatus) : jsonResponse({ status: 'error', code: 'connector_failed' }, 500);
}
function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left); const rightBytes = encoder.encode(right); const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  return difference === 0;
}
function requiredValue(env: EnvironmentReader, name: string): string {
  const value = env(name); if (!value || value.trim() === '') throw new OperationalError('connector_configuration_invalid', 500); return value;
}
function readSupabaseSecretKey(env: EnvironmentReader): string {
  try {
    const parsed = JSON.parse(requiredValue(env, 'SUPABASE_SECRET_KEYS')) as Record<string, unknown>;
    if (!parsed || Array.isArray(parsed) || typeof parsed.default !== 'string' || parsed.default.trim() === '') throw new Error();
    return parsed.default;
  } catch { throw new OperationalError('connector_configuration_invalid', 500); }
}
function readConfig(env: EnvironmentReader): ConnectorConfig {
  const mailboxKey = requiredValue(env, 'GMAIL_MAILBOX_KEY');
  if (mailboxKey !== mailboxKey.trim() || mailboxKey.length > 128 || mailboxKey.includes('@')) throw new OperationalError('connector_configuration_invalid', 500);
  const rawUrl = requiredValue(env, 'SUPABASE_URL');
  try { const parsed = new URL(rawUrl); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); } catch { throw new OperationalError('connector_configuration_invalid', 500); }
  return { imapUser: requiredValue(env, 'GMAIL_IMAP_USER'), imapAppPassword: requiredValue(env, 'GMAIL_IMAP_APP_PASSWORD'), mailboxKey, supabaseUrl: rawUrl.replace(/\/$/, ''), supabaseSecretKey: readSupabaseSecretKey(env) };
}
function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OperationalError(code); return value as Record<string, unknown>;
}
async function responseJson(response: Response, code: string): Promise<unknown> { try { return await response.json(); } catch { throw new OperationalError(code); } }
async function supabaseRpc(config: ConnectorConfig, fetcher: typeof fetch, functionName: string, parameters: Record<string, unknown>, errorCode: string): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/${functionName}`, { method: 'POST', headers: { apikey: config.supabaseSecretKey, 'content-type': 'application/json' }, body: JSON.stringify(parameters) }); } catch { throw new OperationalError(errorCode); }
  if (!response.ok) {
    let code: unknown; try { code = objectValue(await response.json(), errorCode).code; } catch { code = undefined; }
    if (code === '40001') throw new OperationalError('serialization_failure', 409); throw new OperationalError(errorCode);
  }
  return responseJson(response, errorCode);
}
function cursorRow(value: unknown, allowMissing: boolean): CursorState | null {
  if (!Array.isArray(value)) throw new OperationalError('cursor_read_failed');
  if (allowMissing && value.length === 0) return null;
  if (value.length !== 1) throw new OperationalError('cursor_read_failed');
  const row = objectValue(value[0], 'cursor_read_failed');
  if (typeof row.cursor_value !== 'string' || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1) throw new OperationalError('cursor_read_failed');
  return { cursorValue: row.cursor_value, revision: Number(row.revision) };
}
async function getCursor(config: ConnectorConfig, fetcher: typeof fetch): Promise<CursorState | null> {
  return cursorRow(await supabaseRpc(config, fetcher, 'get_mail_connector_cursor', { p_source_provider: SOURCE_PROVIDER, p_source_mailbox_key: config.mailboxKey }, 'cursor_read_failed'), true);
}
async function compareAndSwapCursor(config: ConnectorConfig, fetcher: typeof fetch, expectedRevision: number | null, value: string): Promise<void> {
  try { cursorRow(await supabaseRpc(config, fetcher, 'compare_and_swap_mail_connector_cursor', { p_source_provider: SOURCE_PROVIDER, p_source_mailbox_key: config.mailboxKey, p_expected_revision: expectedRevision, p_cursor_value: value }, 'cursor_write_failed'), false); }
  catch (error) { if (error instanceof OperationalError && error.code === 'serialization_failure') throw new OperationalError('cursor_conflict', 409); throw error; }
}
function validDecimal(value: unknown, minimum: number): number | null {
  if (typeof value === 'bigint') return value >= BigInt(minimum) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : null;
}
function mailboxCursor(snapshot: ImapMailboxSnapshot): { uidValidity: number; uidNext: number } {
  const uidValidity = validDecimal(snapshot.uidValidity, 1); const uidNext = validDecimal(snapshot.uidNext, 1);
  if (uidValidity === null || uidNext === null) throw new OperationalError('gmail_imap_failed'); return { uidValidity, uidNext };
}
function cursorValue(uidValidity: number, lastUid: number): string { return `imap-v1:${uidValidity}:${lastUid}`; }
export function parseImapCursor(value: string): ImapCursor {
  const match = /^imap-v1:([1-9]\d*):(0|[1-9]\d*)$/.exec(value);
  if (!match) throw new OperationalError('cursor_read_failed');
  const uidValidity = Number(match[1]); const lastUid = Number(match[2]);
  if (!Number.isSafeInteger(uidValidity) || uidValidity < 1 || !Number.isSafeInteger(lastUid) || lastUid < 0) throw new OperationalError('cursor_read_failed');
  return { uidValidity, lastUid };
}
function wellFormedUnicode(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(index + 1); if (next >= 0xdc00 && next <= 0xdfff) { result += value.charAt(index) + value.charAt(++index); } else result += '\ufffd'; }
    else if (unit >= 0xdc00 && unit <= 0xdfff) result += '\ufffd'; else result += value.charAt(index);
  }
  return result;
}
function normalizedSubject(subject: unknown): { subject: string; warning?: string } {
  if (typeof subject !== 'string') throw new OperationalError('gmail_message_invalid');
  const normalized = wellFormedUnicode(subject).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim(); const points = [...normalized];
  return points.length <= MAX_SUBJECT_LENGTH ? { subject: normalized } : { subject: points.slice(0, MAX_SUBJECT_LENGTH).join('').trimEnd(), warning: 'Subject exceeded the connector size limit and was truncated.' };
}
function selectInlinePlainParts(bodyStructure: unknown): string[] {
  const selected: string[] = []; let visited = 0;
  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > MAX_MIME_DEPTH || ++visited > MAX_MIME_PARTS) throw new OperationalError('gmail_message_invalid');
    const value = node as Record<string, unknown>; const type = typeof value.type === 'string' ? value.type.toLowerCase() : ''; const disposition = typeof value.disposition === 'string' ? value.disposition.toLowerCase() : '';
    const parameters = value.parameters && typeof value.parameters === 'object' && !Array.isArray(value.parameters) ? value.parameters as Record<string, unknown> : {};
    const dispositionParameters = value.dispositionParameters && typeof value.dispositionParameters === 'object' && !Array.isArray(value.dispositionParameters) ? value.dispositionParameters as Record<string, unknown> : {};
    const filename = parameters.name ?? dispositionParameters.filename;
    if (type === 'text/plain' && disposition !== 'attachment' && (filename === undefined || filename === '')) {
      if (typeof value.part === 'string' && value.part !== '') selected.push(value.part);
      else if (depth === 0 && value.part === undefined) selected.push('1');
      else throw new OperationalError('gmail_message_invalid');
    }
    if (value.childNodes !== undefined) { if (!Array.isArray(value.childNodes)) throw new OperationalError('gmail_message_invalid'); for (const child of value.childNodes) visit(child, depth + 1); }
  };
  visit(bodyStructure, 0); return selected;
}
async function inlinePlainText(adapter: GmailImapAdapter, uid: number, structure: unknown): Promise<{ body: string; warnings: string[] }> {
  const parts = selectInlinePlainParts(structure); if (parts.length === 0) return { body: '', warnings: ['No inline plain-text content was available for analysis.'] };
  const chunks: Uint8Array[] = []; let total = 0;
  for (const part of parts) {
    const available = MAX_DECODED_PLAIN_TEXT_BYTES - total - (chunks.length > 0 ? 1 : 0); const maxBytes = available + 1; let bytes: Uint8Array;
    try { bytes = await adapter.downloadPlainTextPart(uid, part, maxBytes); } catch { throw new OperationalError('gmail_imap_failed'); }
    if (bytes.byteLength > maxBytes || bytes.byteLength > available) return { body: '', warnings: ['Plain-text content exceeded the connector size limit and was not analyzed.'] };
    if (chunks.length > 0) { if (total >= MAX_DECODED_PLAIN_TEXT_BYTES) return { body: '', warnings: ['Plain-text content exceeded the connector size limit and was not analyzed.'] }; chunks.push(Uint8Array.of(10)); total += 1; }
    chunks.push(bytes); total += bytes.byteLength;
  }
  const combined = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return { body: new TextDecoder().decode(combined), warnings: [] };
}
function normalizeBounded(value: string | undefined, limit: number): string | null {
  if (value === undefined) return null; const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim(); return normalized !== '' && normalized.length <= limit ? normalized : null;
}
function boundedWarnings(values: string[]): string[] { return [...new Set(values)].filter((value) => value.trim() !== '').map((value) => value.slice(0, 300)).slice(0, 20); }
function receivedAt(value: unknown): string { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new OperationalError('gmail_message_invalid'); return value.toISOString(); }
async function processMessage(config: ConnectorConfig, fetcher: typeof fetch, adapter: GmailImapAdapter, uidValidity: number, uid: number): Promise<MessageResult> {
  let message: ImapMessageMetadata | null; try { message = await adapter.fetchMessageMetadata(uid); } catch { throw new OperationalError('gmail_imap_failed'); }
  if (!message) return 'absent'; if (message.uid !== uid) throw new OperationalError('gmail_message_invalid');
  if (typeof message.subject !== 'string') throw new OperationalError('gmail_message_invalid');
  if (!message.subject.startsWith(ELIGIBLE_SUBJECT_PREFIX)) return 'filtered';
  const subject = normalizedSubject(message.subject); const plain = await inlinePlainText(adapter, uid, message.bodyStructure);
  const parserSubject = subject.subject.slice(ELIGIBLE_SUBJECT_PREFIX.length).trimStart(); const parsed = parseBunkerRequest({ subject: parserSubject, body: plain.body });
  const warnings = [...plain.warnings, ...parsed.warnings]; if (subject.warning) warnings.push(subject.warning);
  const vesselVoyage = normalizeBounded(parsed.vesselVoyage, MAX_CANDIDATE_LENGTH); const portName = normalizeBounded(parsed.portName, MAX_CANDIDATE_LENGTH); const deliveryWindow = normalizeBounded(parsed.deliveryWindow, MAX_CANDIDATE_LENGTH);
  if (parsed.vesselVoyage && !vesselVoyage) warnings.push('Vessel/voyage candidate exceeded the connector limit and was omitted.');
  if (parsed.portName && !portName) warnings.push('Port candidate exceeded the connector limit and was omitted.');
  if (parsed.deliveryWindow && !deliveryWindow) warnings.push('Delivery-window candidate exceeded the connector limit and was omitted.');
  const parameters = { p_source_provider: SOURCE_PROVIDER, p_source_mailbox_key: config.mailboxKey, p_source_message_id: `${uidValidity}:${uid}`, p_received_at: receivedAt(message.internalDate), p_subject: subject.subject, p_vessel_voyage: vesselVoyage, p_port_name: portName, p_delivery_window: deliveryWindow, p_fuel_items: parsed.fuelItems, p_warnings: boundedWarnings(warnings) };
  for (let attempt = 1; attempt <= MAX_INGEST_ATTEMPTS; attempt += 1) {
    try { await supabaseRpc(config, fetcher, 'ingest_mail_intake_item', parameters, 'ingest_failed'); return 'ingested'; }
    catch (error) { if (!(error instanceof OperationalError) || error.code !== 'serialization_failure' || attempt === MAX_INGEST_ATTEMPTS) throw error instanceof OperationalError && error.code === 'serialization_failure' ? new OperationalError('ingest_failed') : error; }
  }
  throw new OperationalError('ingest_failed');
}
function sortedSnapshotUids(values: number[], lowerUid: number, upperUid: number): number[] {
  const seen = new Set<number>(); for (const value of values) { if (!Number.isSafeInteger(value) || value < lowerUid || value > upperUid || seen.has(value)) throw new OperationalError('gmail_imap_failed'); seen.add(value); } return [...seen].sort((a, b) => a - b);
}
async function runConnector(config: ConnectorConfig, fetcher: typeof fetch, imapFactory: GmailImapAdapterFactory): Promise<Response> {
  const cursor = await getCursor(config, fetcher); if (cursor) parseImapCursor(cursor.cursorValue);
  let adapter: GmailImapAdapter;
  try { adapter = imapFactory({ user: config.imapUser, password: config.imapAppPassword }); } catch { throw new OperationalError('gmail_imap_failed'); }
  try {
    let snapshot: ImapMailboxSnapshot; try { await adapter.connect(); snapshot = await adapter.openInboxReadOnly(); } catch { throw new OperationalError('gmail_imap_failed'); }
    const mailbox = mailboxCursor(snapshot);
    if (!cursor) { await compareAndSwapCursor(config, fetcher, null, cursorValue(mailbox.uidValidity, mailbox.uidNext - 1)); return jsonResponse({ status: 'initialized', discovered: 0, ingested: 0, skipped_absent: 0 }, 200); }
    const parsed = parseImapCursor(cursor.cursorValue); if (parsed.uidValidity !== mailbox.uidValidity) throw new OperationalError('gmail_imap_uidvalidity_changed', 409);
    const upperUid = mailbox.uidNext - 1; if (upperUid <= parsed.lastUid) return jsonResponse({ status: 'completed', discovered: 0, ingested: 0, skipped_absent: 0 }, 200);
    let discovered: number[]; try { discovered = sortedSnapshotUids(await adapter.searchSnapshotUids(parsed.lastUid + 1, upperUid), parsed.lastUid + 1, upperUid); } catch (error) { if (error instanceof OperationalError) throw error; throw new OperationalError('gmail_imap_failed'); }
    let ingested = 0; let skippedAbsent = 0;
    for (const uid of discovered) {
      const result = await processMessage(config, fetcher, adapter, mailbox.uidValidity, uid);
      if (result === 'ingested') ingested += 1;
      else if (result === 'absent') skippedAbsent = Math.min(skippedAbsent + 1, MAX_SKIPPED_ABSENT_MESSAGES);
    }
    await compareAndSwapCursor(config, fetcher, cursor.revision, cursorValue(mailbox.uidValidity, upperUid));
    return jsonResponse({ status: 'completed', discovered: discovered.length, ingested, skipped_absent: skippedAbsent }, 200);
  } finally { try { await adapter.close(); } catch { /* cleanup errors are deliberately nonsensitive */ } }
}
export function createGmailMailIntakeHandler(dependencies: ConnectorDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return jsonResponse({ status: 'error', code: 'method_not_allowed' }, 405);
    const configuredTriggerSecret = dependencies.env('GMAIL_CONNECTOR_TRIGGER_SECRET');
    if (!configuredTriggerSecret || configuredTriggerSecret.trim() === '') return jsonResponse({ status: 'error', code: 'connector_configuration_invalid' }, 500);
    if (!constantTimeEqual(request.headers.get(CONNECTOR_TRIGGER_HEADER) ?? '', configuredTriggerSecret)) return jsonResponse({ status: 'error', code: 'unauthorized' }, 401);
    try { return await runConnector(readConfig(dependencies.env), dependencies.fetch, dependencies.imapFactory); } catch (error) { return fixedErrorResponse(error); }
  };
}
