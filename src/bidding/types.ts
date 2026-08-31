export type FuelGrade = 'vlsfo' | 'hsfo' | 'ulsfo' | 'lsfo' | 'lsmgo';
export const fuelGrades: FuelGrade[] = ['vlsfo', 'hsfo', 'ulsfo', 'lsfo', 'lsmgo'];
export type BidStatus = 'open' | 'closed' | 'cancelled' | 'awarded';
export type EffectiveBidStatus = 'open' | 'closed' | 'cancelled' | 'awarded';

export type BidFuelItem = { fuel_grade: FuelGrade; quantity_mt: number };
export type QuoteFuelPrice = { fuel_grade: FuelGrade; unit_price: number };
export type MailIntakeFuelItem = { grade: FuelGrade; quantity: number };
export type MailIntakeItem = {
  id: string;
  received_at: string;
  subject: string;
  vessel_voyage: string | null;
  port_name: string | null;
  delivery_window: string | null;
  fuel_items: MailIntakeFuelItem[];
  warnings: string[];
  status: 'pending' | 'dismissed';
  revision: number;
  created_at: string;
  updated_at: string;
  dismissed_at: string | null;
};
export type Bid = {
  id: string; vessel_voyage: string; port_name: string; delivery_window: string;
  bid_date: string;
  deadline_at: string | null; raw_status: BidStatus; effective_status: EffectiveBidStatus;
  revision: number; created_by: string; created_by_label: string;
  responsible_buyer_user_id: string; responsible_buyer_label: string;
  fuel_items: BidFuelItem[]; created_at: string; updated_at: string;
  closed_at: string | null; cancelled_at: string | null;
  awarded_quote_id: string | null; awarded_trader_organization_id: string | null;
  awarded_trader_organization_label: string | null; awarded_total_amount: number | null;
  awarded_at: string | null;
};
export type TraderBid = Omit<Bid, 'bid_date' | 'created_by' | 'created_by_label' | 'responsible_buyer_user_id' | 'responsible_buyer_label' | 'awarded_quote_id' | 'awarded_trader_organization_id' | 'awarded_trader_organization_label' | 'awarded_total_amount' | 'awarded_at'>;
export type ActiveBuyer = { user_id: string; display_label: string; active_buyer_membership_count: number };
export type TraderOrganization = { organization_id: string; organization_label: string };
export type SellerOrganizationAdmin = {
  organization_id: string;
  organization_label: string;
  organization_status: 'active' | 'inactive' | 'suspended';
  active_trader_membership_count: number;
  created_at: string;
  updated_at: string;
};
export type BidTraderAccess = { bid_id: string; trader_organization_id: string; trader_organization_label: string; granted_at: string; granted_by_user_id: string; granted_by_membership_id: string };
export type Quote = { id: string; bid_id: string; trader_organization_id: string; trader_organization_label: string; revision: number; created_by: string; fuel_prices: QuoteFuelPrice[]; barge_fee: number; total_amount: number; created_at: string; updated_at: string; access_active: boolean; organization_active: boolean; eligible_for_award: boolean; is_awarded: boolean };
export type BuyerSellerComparison = { bid_id: string; trader_organization_id: string; trader_organization_label: string; access_active: boolean; organization_active: boolean; quote: Quote | null };
export type BidAuditEvent = { id: string; bid_id: string; event_type: string; actor_user_id: string; actor_membership_id: string; actor_organization_id: string; actor_role: 'buyer_admin' | 'buyer_operator' | 'trader'; occurred_at: string; prior_revision: number | null; resulting_revision: number; prior_status: BidStatus | null; resulting_status: BidStatus; prior_responsible_buyer_user_id: string | null; resulting_responsible_buyer_user_id: string; before_snapshot: Record<string, unknown> | null; after_snapshot: Record<string, unknown> };
export type WorkflowErrorKind = 'authorization' | 'conflict' | 'lifecycle' | 'validation' | 'not_found' | 'duplicate' | 'unknown' | 'protocol';
export type WorkflowError = { kind: WorkflowErrorKind; code: string | null; message: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const grades = new Set<FuelGrade>(['vlsfo', 'hsfo', 'ulsfo', 'lsfo', 'lsmgo']);
const statuses = new Set<BidStatus>(['open', 'closed', 'cancelled', 'awarded']);
const roles = new Set<BidAuditEvent['actor_role']>(['buyer_admin', 'buyer_operator', 'trader']);
const auditEvents = new Set(['created', 'details_updated', 'responsible_buyer_changed', 'closed', 'reopened', 'cancelled', 'trader_access_granted', 'trader_access_revoked', 'awarded']);

function record(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function text(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function id(value: unknown): string | null { const candidate = text(value); return candidate && uuid.test(candidate) ? candidate : null; }
function finite(value: unknown): number | null { const candidate = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN; return Number.isFinite(candidate) ? candidate : null; }
function revision(value: unknown): number | null { const candidate = finite(value); return candidate !== null && Number.isInteger(candidate) && candidate >= 1 ? candidate : null; }
function date(value: unknown, nullable = false): string | null | undefined { if (value === null && nullable) return null; const candidate = text(value); return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : undefined; }
function nullableId(value: unknown): string | null | undefined { if (value === null) return null; return id(value) ?? undefined; }
function nullableNumber(value: unknown): number | null | undefined { if (value === null) return null; return finite(value) ?? undefined; }
function nullableDate(value: unknown): string | null | undefined { return date(value, true); }
function bool(value: unknown): boolean | null { return typeof value === 'boolean' ? value : null; }

export function parseBidDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1]! ? value : null;
}

const mailIntakeKeys = new Set([
  'id', 'received_at', 'subject', 'vessel_voyage', 'port_name', 'delivery_window',
  'fuel_items', 'warnings', 'status', 'revision', 'created_at', 'updated_at', 'dismissed_at',
]);
const sellerOrganizationAdminKeys = new Set([
  'organization_id', 'organization_label', 'organization_status',
  'active_trader_membership_count', 'created_at', 'updated_at',
]);
const quoteKeys = new Set([
  'id', 'bid_id', 'trader_organization_id', 'trader_organization_label', 'revision', 'created_by',
  'fuel_prices', 'barge_fee', 'total_amount', 'created_at', 'updated_at', 'access_active',
  'organization_active', 'eligible_for_award', 'is_awarded',
]);
const buyerSellerComparisonKeys = new Set([
  'bid_id', 'trader_organization_id', 'trader_organization_label', 'access_active',
  'organization_active', 'quote',
]);
function exactKeys(value: Record<string, unknown>, allowed: Set<string>): boolean { return Object.keys(value).length === allowed.size && Object.keys(value).every((key) => allowed.has(key)); }
function boundedText(value: unknown, maximum: number, allowEmpty = false): string | null {
  const candidate = text(value);
  return candidate !== null && candidate === candidate.trim() && candidate.length <= maximum && (allowEmpty || candidate.length > 0) ? candidate : null;
}
function nullableBoundedText(value: unknown, maximum: number): string | null | undefined { return value === null ? null : boundedText(value, maximum) ?? undefined; }
function mailIntakeRevision(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null; }
function mailIntakeTimestamp(value: unknown): string | null {
  const candidate = text(value);
  const match = candidate?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/);
  if (!candidate || !match || !Number.isFinite(Date.parse(candidate))) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const hour = Number(match[4]); const minute = Number(match[5]); const second = Number(match[6]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]! || hour > 23 || minute > 59 || second > 59) return null;
  if (match[7] !== 'Z') { const offsetHour = Number(match[7]!.slice(1, 3)); const offsetMinute = Number(match[7]!.slice(4, 6)); if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return null; }
  return candidate;
}
function nullableMailIntakeTimestamp(value: unknown): string | null | undefined { return value === null ? null : mailIntakeTimestamp(value) ?? undefined; }
function mailIntakeFuelItems(value: unknown): MailIntakeFuelItem[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const found = new Set<FuelGrade>(); const output: MailIntakeFuelItem[] = [];
  for (const candidate of value) {
    const item = record(candidate);
    if (!item || Object.keys(item).length !== 2 || !Object.hasOwn(item, 'grade') || !Object.hasOwn(item, 'quantity')) return null;
    const grade = text(item.grade); const quantity = item.quantity;
    if (!grade || !grades.has(grade as FuelGrade) || found.has(grade as FuelGrade) || typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) return null;
    found.add(grade as FuelGrade); output.push({ grade: grade as FuelGrade, quantity });
  }
  return output;
}
function mailIntakeWarnings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const output: string[] = [];
  for (const candidate of value) { const warning = boundedText(candidate, 300); if (warning === null) return null; output.push(warning); }
  return output;
}
function parseMailIntakeItem(value: unknown, expectedStatus: MailIntakeItem['status']): MailIntakeItem | null {
  const r = record(value);
  if (!r || !exactKeys(r, mailIntakeKeys) || !id(r.id) || !mailIntakeTimestamp(r.received_at) || boundedText(r.subject, 512, true) === null || nullableBoundedText(r.vessel_voyage, 256) === undefined || nullableBoundedText(r.port_name, 256) === undefined || nullableBoundedText(r.delivery_window, 256) === undefined || !mailIntakeFuelItems(r.fuel_items) || !mailIntakeWarnings(r.warnings) || r.status !== expectedStatus || mailIntakeRevision(r.revision) === null || !mailIntakeTimestamp(r.created_at) || !mailIntakeTimestamp(r.updated_at) || nullableMailIntakeTimestamp(r.dismissed_at) === undefined) return null;
  if ((expectedStatus === 'pending' && r.dismissed_at !== null) || (expectedStatus === 'dismissed' && r.dismissed_at === null)) return null;
  return {
    id: r.id as string,
    received_at: r.received_at as string,
    subject: r.subject as string,
    vessel_voyage: r.vessel_voyage as string | null,
    port_name: r.port_name as string | null,
    delivery_window: r.delivery_window as string | null,
    fuel_items: mailIntakeFuelItems(r.fuel_items)!,
    warnings: mailIntakeWarnings(r.warnings)!,
    status: expectedStatus,
    revision: mailIntakeRevision(r.revision)!,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    dismissed_at: r.dismissed_at as string | null,
  };
}
export function parsePendingMailIntakeItem(value: unknown): MailIntakeItem | null { return parseMailIntakeItem(value, 'pending'); }
export function parseDismissedMailIntakeItem(value: unknown): MailIntakeItem | null { return parseMailIntakeItem(value, 'dismissed'); }
export function parseSellerOrganizationAdmin(value: unknown): SellerOrganizationAdmin | null {
  const r = record(value);
  if (
    !r
    || !exactKeys(r, sellerOrganizationAdminKeys)
    || !id(r.organization_id)
    || boundedText(r.organization_label, 120) === null
    || !['active', 'inactive', 'suspended'].includes(r.organization_status as string)
    || typeof r.active_trader_membership_count !== 'number'
    || !Number.isSafeInteger(r.active_trader_membership_count)
    || r.active_trader_membership_count < 0
    || !mailIntakeTimestamp(r.created_at)
    || !mailIntakeTimestamp(r.updated_at)
  ) return null;
  return {
    organization_id: r.organization_id as string,
    organization_label: r.organization_label as string,
    organization_status: r.organization_status as SellerOrganizationAdmin['organization_status'],
    active_trader_membership_count: r.active_trader_membership_count,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}

function fuelItems(value: unknown): BidFuelItem[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) return null;
  const found = new Set<string>(); const output: BidFuelItem[] = [];
  for (const candidate of value) { const item = record(candidate); const grade = item && text(item.fuel_grade); const quantity = item && finite(item.quantity_mt); if (!item || !grade || !grades.has(grade as FuelGrade) || quantity === null || quantity <= 0 || found.has(grade)) return null; found.add(grade); output.push({ fuel_grade: grade as FuelGrade, quantity_mt: quantity }); }
  return output;
}
function fuelPrices(value: unknown): QuoteFuelPrice[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) return null;
  const found = new Set<string>(); const output: QuoteFuelPrice[] = [];
  for (const candidate of value) { const item = record(candidate); const grade = item && text(item.fuel_grade); const price = item && finite(item.unit_price); if (!item || !grade || !grades.has(grade as FuelGrade) || price === null || price <= 0 || found.has(grade)) return null; found.add(grade); output.push({ fuel_grade: grade as FuelGrade, unit_price: price }); }
  return output;
}
function objectOrNull(value: unknown): Record<string, unknown> | null | undefined { if (value === null) return null; return record(value) ?? undefined; }

export function parseBid(value: unknown): Bid | null {
  const r = record(value); if (!r) return null;
  const raw = text(r.raw_status); const effective = text(r.effective_status);
  const parsed = r && id(r.id) && parseBidDate(r.bid_date) && text(r.vessel_voyage) && text(r.port_name) && text(r.delivery_window) && nullableDate(r.deadline_at) !== undefined && raw && statuses.has(raw as BidStatus) && effective && statuses.has(effective as BidStatus) && revision(r.revision) !== null && id(r.created_by) && text(r.created_by_label) && id(r.responsible_buyer_user_id) && text(r.responsible_buyer_label) && fuelItems(r.fuel_items) && date(r.created_at) !== undefined && date(r.updated_at) !== undefined && nullableDate(r.closed_at) !== undefined && nullableDate(r.cancelled_at) !== undefined && nullableId(r.awarded_quote_id) !== undefined && nullableId(r.awarded_trader_organization_id) !== undefined && (r.awarded_trader_organization_label === null || text(r.awarded_trader_organization_label)) && nullableNumber(r.awarded_total_amount) !== undefined && nullableDate(r.awarded_at) !== undefined;
  if (!parsed) return null;
  const closed = r.closed_at; const cancelled = r.cancelled_at;
  const awardValues = [r.awarded_quote_id, r.awarded_trader_organization_id, r.awarded_trader_organization_label, r.awarded_total_amount, r.awarded_at];
  const hasAward = awardValues.every((item) => item !== null);
  const noAward = awardValues.every((item) => item === null);
  const deadline = nullableDate(r.deadline_at);
  const legal = (raw === 'open' && effective === 'open' && !closed && !cancelled && noAward)
    || (raw === 'open' && effective === 'closed' && deadline !== null && !closed && !cancelled && noAward)
    || (raw === 'closed' && effective === 'closed' && !!closed && !cancelled && noAward)
    || (raw === 'cancelled' && effective === 'cancelled' && !!cancelled && noAward)
    || (raw === 'awarded' && effective === 'awarded' && !!closed && !cancelled && hasAward && (nullableNumber(r.awarded_total_amount) as number) > 0);
  if (!legal) return null;
  return { id: r.id as string, bid_date: r.bid_date as string, vessel_voyage: r.vessel_voyage as string, port_name: r.port_name as string, delivery_window: r.delivery_window as string, deadline_at: r.deadline_at as string | null, raw_status: raw, effective_status: effective, revision: revision(r.revision)!, created_by: r.created_by as string, created_by_label: r.created_by_label as string, responsible_buyer_user_id: r.responsible_buyer_user_id as string, responsible_buyer_label: r.responsible_buyer_label as string, fuel_items: fuelItems(r.fuel_items)!, created_at: r.created_at as string, updated_at: r.updated_at as string, closed_at: r.closed_at as string | null, cancelled_at: r.cancelled_at as string | null, awarded_quote_id: r.awarded_quote_id as string | null, awarded_trader_organization_id: r.awarded_trader_organization_id as string | null, awarded_trader_organization_label: r.awarded_trader_organization_label as string | null, awarded_total_amount: nullableNumber(r.awarded_total_amount)!, awarded_at: r.awarded_at as string | null };
}
export function parseTraderBid(value: unknown): TraderBid | null {
  const r = record(value); if (!r) return null; const raw = text(r.raw_status); const effective = text(r.effective_status);
  if (!id(r.id) || !text(r.vessel_voyage) || !text(r.port_name) || !text(r.delivery_window) || nullableDate(r.deadline_at) === undefined || !raw || !statuses.has(raw as BidStatus) || !effective || !statuses.has(effective as BidStatus) || revision(r.revision) === null || !fuelItems(r.fuel_items) || date(r.created_at) === undefined || date(r.updated_at) === undefined || nullableDate(r.closed_at) === undefined || nullableDate(r.cancelled_at) === undefined) return null;
  const closed = r.closed_at; const cancelled = r.cancelled_at; const deadline = nullableDate(r.deadline_at);
  if (raw === 'awarded' && r.awarded_total_amount !== undefined && (finite(r.awarded_total_amount) === null || finite(r.awarded_total_amount)! <= 0)) return null;
  if (!((raw === 'open' && effective === 'open' && !closed && !cancelled) || (raw === 'open' && effective === 'closed' && deadline !== null && !closed && !cancelled) || (raw === 'closed' && effective === 'closed' && !!closed && !cancelled) || (raw === 'cancelled' && effective === 'cancelled' && !!cancelled) || (raw === 'awarded' && effective === 'awarded' && !!closed && !cancelled))) return null;
  return { id: r.id as string, vessel_voyage: r.vessel_voyage as string, port_name: r.port_name as string, delivery_window: r.delivery_window as string, deadline_at: r.deadline_at as string | null, raw_status: raw, effective_status: effective, revision: revision(r.revision)!, fuel_items: fuelItems(r.fuel_items)!, created_at: r.created_at as string, updated_at: r.updated_at as string, closed_at: r.closed_at as string | null, cancelled_at: r.cancelled_at as string | null };
}
export function parseActiveBuyer(value: unknown): ActiveBuyer | null { const r = record(value); const count = r && finite(r.active_buyer_membership_count); return r && id(r.user_id) && text(r.display_label) && count !== null && Number.isInteger(count) && count >= 1 ? { user_id: r.user_id as string, display_label: r.display_label as string, active_buyer_membership_count: count } : null; }
export function parseTraderOrganization(value: unknown): TraderOrganization | null { const r = record(value); return r && id(r.organization_id) && text(r.organization_label) ? { organization_id: r.organization_id as string, organization_label: r.organization_label as string } : null; }
export function parseBidTraderAccess(value: unknown): BidTraderAccess | null { const r = record(value); return r && id(r.bid_id) && id(r.trader_organization_id) && text(r.trader_organization_label) && date(r.granted_at) !== undefined && id(r.granted_by_user_id) && id(r.granted_by_membership_id) ? { bid_id: r.bid_id as string, trader_organization_id: r.trader_organization_id as string, trader_organization_label: r.trader_organization_label as string, granted_at: r.granted_at as string, granted_by_user_id: r.granted_by_user_id as string, granted_by_membership_id: r.granted_by_membership_id as string } : null; }
export function parseQuote(value: unknown): Quote | null { const r = record(value); if (!r || !exactKeys(r, quoteKeys) || !id(r.id) || !id(r.bid_id) || !id(r.trader_organization_id) || !text(r.trader_organization_label) || revision(r.revision) === null || !id(r.created_by) || !fuelPrices(r.fuel_prices) || finite(r.barge_fee) === null || finite(r.barge_fee)! < 0 || finite(r.total_amount) === null || finite(r.total_amount)! <= 0 || !date(r.created_at) || !date(r.updated_at) || bool(r.access_active) === null || bool(r.organization_active) === null || bool(r.eligible_for_award) === null || bool(r.is_awarded) === null || (r.eligible_for_award === true && r.is_awarded === true)) return null; return { id: r.id as string, bid_id: r.bid_id as string, trader_organization_id: r.trader_organization_id as string, trader_organization_label: r.trader_organization_label as string, revision: revision(r.revision)!, created_by: r.created_by as string, fuel_prices: fuelPrices(r.fuel_prices)!, barge_fee: finite(r.barge_fee)!, total_amount: finite(r.total_amount)!, created_at: r.created_at as string, updated_at: r.updated_at as string, access_active: r.access_active as boolean, organization_active: r.organization_active as boolean, eligible_for_award: r.eligible_for_award as boolean, is_awarded: r.is_awarded as boolean }; }
export function parseBuyerSellerComparison(value: unknown): BuyerSellerComparison | null {
  const r = record(value);
  if (!r || !exactKeys(r, buyerSellerComparisonKeys) || !id(r.bid_id) || !id(r.trader_organization_id) || !text(r.trader_organization_label) || bool(r.access_active) === null || bool(r.organization_active) === null) return null;
  if (r.quote === null) return r.access_active === true ? { bid_id: r.bid_id as string, trader_organization_id: r.trader_organization_id as string, trader_organization_label: r.trader_organization_label as string, access_active: true, organization_active: r.organization_active as boolean, quote: null } : null;
  const quote = parseQuote(r.quote);
  if (!quote || quote.bid_id !== r.bid_id || quote.trader_organization_id !== r.trader_organization_id || quote.trader_organization_label !== r.trader_organization_label || quote.access_active !== r.access_active || quote.organization_active !== r.organization_active) return null;
  return { bid_id: r.bid_id, trader_organization_id: r.trader_organization_id, trader_organization_label: r.trader_organization_label, access_active: r.access_active, organization_active: r.organization_active, quote };
}
export function parseBidAuditEvent(value: unknown): BidAuditEvent | null { const r = record(value); const role = r && text(r.actor_role); const eventType = r && text(r.event_type); const prior = r && (r.prior_revision === null ? null : revision(r.prior_revision) ?? undefined); const priorStatus = r && (r.prior_status === null ? null : text(r.prior_status)); const before = r && objectOrNull(r.before_snapshot); const after = r && record(r.after_snapshot); if (!r || !id(r.id) || !id(r.bid_id) || !eventType || !auditEvents.has(eventType) || !id(r.actor_user_id) || !id(r.actor_membership_id) || !id(r.actor_organization_id) || !role || !roles.has(role as BidAuditEvent['actor_role']) || !date(r.occurred_at) || prior === undefined || revision(r.resulting_revision) === null || (prior !== null && prior + 1 !== revision(r.resulting_revision)!) || priorStatus === undefined || (priorStatus !== null && !statuses.has(priorStatus as BidStatus)) || !text(r.resulting_status) || !statuses.has(r.resulting_status as BidStatus) || nullableId(r.prior_responsible_buyer_user_id) === undefined || !id(r.resulting_responsible_buyer_user_id) || before === undefined || !after) return null; return { id: r.id as string, bid_id: r.bid_id as string, event_type: eventType, actor_user_id: r.actor_user_id as string, actor_membership_id: r.actor_membership_id as string, actor_organization_id: r.actor_organization_id as string, actor_role: role as BidAuditEvent['actor_role'], occurred_at: r.occurred_at as string, prior_revision: prior, resulting_revision: revision(r.resulting_revision)!, prior_status: priorStatus as BidStatus | null, resulting_status: r.resulting_status as BidStatus, prior_responsible_buyer_user_id: r.prior_responsible_buyer_user_id as string | null, resulting_responsible_buyer_user_id: r.resulting_responsible_buyer_user_id as string, before_snapshot: before, after_snapshot: after }; }
export function parseArray<T>(value: unknown, parser: (candidate: unknown) => T | null): T[] | null { if (!Array.isArray(value)) return null; const result: T[] = []; for (const candidate of value) { const item = parser(candidate); if (!item) return null; result.push(item); } return result; }
export function protocolError(): WorkflowError { return { kind: 'protocol', code: null, message: 'The server returned an invalid response. Protected data was not displayed.' }; }
export function mapWorkflowError(error: { code?: string | null } | null | undefined): WorkflowError { const code = error?.code ?? null; if (code === '42501') return { kind: 'authorization', code, message: 'Your authorization changed. Access is being verified again.' }; if (code === '40001') return { kind: 'conflict', code, message: 'This record changed elsewhere. The latest data was loaded.' }; if (code === '55000') return { kind: 'lifecycle', code, message: 'The bid state or deadline changed. The latest data was loaded.' }; if (code === '22023' || code === '23514') return { kind: 'validation', code, message: 'Please review the submitted values.' }; if (code === 'P0002') return { kind: 'not_found', code, message: 'That record no longer exists.' }; if (code === '23505') return { kind: 'duplicate', code, message: 'That operation conflicts with the current record.' }; return { kind: 'unknown', code, message: 'The request could not be completed. Please try again.' }; }
