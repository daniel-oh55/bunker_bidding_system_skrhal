import { describe, expect, it } from 'vitest';
import { parseArray, parseBid, parseBidAuditEvent, parseQuote, parseTraderBid } from './types';

const id = '10000000-0000-4000-8000-000000000001';
const otherId = '10000000-0000-4000-8000-000000000002';
const now = '2026-08-03T03:00:00.000Z';

function bid(overrides: Record<string, unknown> = {}) {
  return { id, vessel_voyage: 'MV Test / 001', port_name: 'Busan', delivery_window: 'Tomorrow', deadline_at: null, raw_status: 'open', effective_status: 'open', revision: 1, created_by: id, created_by_label: 'Creator', responsible_buyer_user_id: otherId, responsible_buyer_label: 'Buyer', fuel_items: [{ fuel_grade: 'vlsfo', quantity_mt: 10 }], created_at: now, updated_at: now, closed_at: null, cancelled_at: null, awarded_quote_id: null, awarded_trader_organization_id: null, awarded_trader_organization_label: null, awarded_total_amount: null, awarded_at: null, ...overrides };
}
function audit(overrides: Record<string, unknown> = {}) {
  return { id, bid_id: otherId, event_type: 'created', actor_user_id: id, actor_membership_id: id, actor_organization_id: id, actor_role: 'buyer_operator', occurred_at: now, prior_revision: null, resulting_revision: 1, prior_status: null, resulting_status: 'open', prior_responsible_buyer_user_id: null, resulting_responsible_buyer_user_id: otherId, before_snapshot: null, after_snapshot: {}, ...overrides };
}
function quote(overrides: Record<string, unknown> = {}) {
  return { id, bid_id: otherId, trader_organization_id: id, trader_organization_label: 'Trader', revision: 1, created_by: otherId, fuel_prices: [{ fuel_grade: 'vlsfo', unit_price: 1 }], barge_fee: 0, total_amount: 1, created_at: now, updated_at: now, access_active: true, organization_active: true, eligible_for_award: true, is_awarded: false, ...overrides };
}

describe('bidding protocol parsers', () => {
  it('rejects invalid bid lifecycle combinations and negative awards', () => {
    expect(parseBid(bid({ raw_status: 'awarded', effective_status: 'awarded', closed_at: now, awarded_quote_id: id, awarded_trader_organization_id: otherId, awarded_trader_organization_label: 'Trader', awarded_total_amount: -1, awarded_at: now }))).toBeNull();
    expect(parseBid(bid({ raw_status: 'cancelled', effective_status: 'cancelled', cancelled_at: null }))).toBeNull();
  });

  it('rejects an invalid non-null audit revision and unknown event', () => {
    expect(parseBidAuditEvent(audit({ prior_revision: 'bad' }))).toBeNull();
    expect(parseBidAuditEvent(audit({ event_type: 'invented' }))).toBeNull();
  });

  it('rejects impossible quote totals and award flags', () => {
    expect(parseQuote(quote({ total_amount: 0 }))).toBeNull();
    expect(parseQuote(quote({ eligible_for_award: true, is_awarded: true }))).toBeNull();
  });

  it('rejects malformed dates, revisions, effective statuses, and nested members atomically', () => {
    expect(parseBid(bid({ deadline_at: 'not-a-date' }))).toBeNull();
    expect(parseBid(bid({ revision: 0 }))).toBeNull();
    expect(parseBid(bid({ raw_status: 'closed', effective_status: 'open', closed_at: now }))).toBeNull();
    expect(parseTraderBid({ ...bid(), created_by: undefined, created_by_label: undefined, responsible_buyer_user_id: undefined, responsible_buyer_label: undefined, awarded_quote_id: undefined, awarded_trader_organization_id: undefined, awarded_trader_organization_label: undefined, awarded_total_amount: undefined, awarded_at: undefined, raw_status: 'cancelled', effective_status: 'cancelled', cancelled_at: null })).toBeNull();
    expect(parseQuote(quote({ fuel_prices: [{ fuel_grade: 'vlsfo', unit_price: 1 }, { fuel_grade: 'bad', unit_price: 2 }] }))).toBeNull();
    expect(parseArray([bid(), { bad: true }], parseBid)).toBeNull();
  });
});
