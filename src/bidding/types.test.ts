import { describe, expect, it } from 'vitest';
import { parseArray, parseBid, parseBidAuditEvent, parseBuyerSellerComparison, parseDismissedMailIntakeItem, parsePendingMailIntakeItem, parseQuote, parseSellerOrganizationAdmin, parseTraderBid } from './types';

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
function mailItem(overrides: Record<string, unknown> = {}) {
  return { id, received_at: now, subject: '', vessel_voyage: null, port_name: 'Busan', delivery_window: '2026-08-04', fuel_items: [{ grade: 'vlsfo', quantity: 10 }], warnings: ['Confirm delivery window'], status: 'pending', revision: 1, created_at: now, updated_at: now, dismissed_at: null, ...overrides };
}
function sellerComparison(overrides: Record<string, unknown> = {}) {
  return { bid_id: otherId, trader_organization_id: id, trader_organization_label: 'Trader', access_active: true, organization_active: true, quote: null, ...overrides };
}
function sellerOrganization(overrides: Record<string, unknown> = {}) {
  return { organization_id: id, organization_label: 'Ocean Bunker', organization_status: 'active', active_trader_membership_count: 2, created_at: now, updated_at: now, ...overrides };
}

describe('bidding protocol parsers', () => {
  it('accepts only the exact narrow SELLER-admin organization result', () => {
    expect(parseSellerOrganizationAdmin(sellerOrganization())).toEqual(sellerOrganization());
    expect(parseSellerOrganizationAdmin(sellerOrganization({ organization_status: 'inactive', active_trader_membership_count: 0 }))).not.toBeNull();
    expect(parseSellerOrganizationAdmin(sellerOrganization({ organization_status: 'suspended' }))).not.toBeNull();
    expect(parseSellerOrganizationAdmin({ ...sellerOrganization(), member_email: 'hidden@example.test' })).toBeNull();
  });

  it('rejects malformed SELLER-admin UUIDs, labels, statuses, counts, timestamps, and keys', () => {
    for (const candidate of [
      sellerOrganization({ organization_id: 'bad' }),
      sellerOrganization({ organization_label: ' Ocean Bunker' }),
      sellerOrganization({ organization_label: '' }),
      sellerOrganization({ organization_label: 'x'.repeat(121) }),
      sellerOrganization({ organization_status: 'deleted' }),
      sellerOrganization({ active_trader_membership_count: -1 }),
      sellerOrganization({ active_trader_membership_count: 1.5 }),
      sellerOrganization({ active_trader_membership_count: '2' }),
      sellerOrganization({ created_at: 'not-a-timestamp' }),
      sellerOrganization({ updated_at: '2026-02-30T03:00:00.000Z' }),
    ]) expect(parseSellerOrganizationAdmin(candidate)).toBeNull();
    const missing: Record<string, unknown> = sellerOrganization(); delete missing.updated_at;
    expect(parseSellerOrganizationAdmin(missing)).toBeNull();
  });

  it('accepts valid pending and dismissed mail-intake results with only the narrow result fields', () => {
    expect(parsePendingMailIntakeItem(mailItem())).toEqual(mailItem());
    const dismissed = mailItem({ status: 'dismissed', revision: 2, dismissed_at: now });
    expect(parseDismissedMailIntakeItem(dismissed)).toEqual(dismissed);
    expect(parsePendingMailIntakeItem({ ...mailItem(), source_provider: 'secret-provider' })).toBeNull();
  });

  it('rejects malformed mail-intake identity, timestamps, revisions, and status consistency', () => {
    for (const candidate of [
      mailItem({ id: 'bad' }), mailItem({ received_at: 'bad' }), mailItem({ received_at: '2026-02-30T03:00:00.000Z' }), mailItem({ created_at: 'bad' }), mailItem({ updated_at: 'bad' }),
      mailItem({ revision: 0 }), mailItem({ revision: 1.5 }), mailItem({ revision: '1' }),
      mailItem({ status: 'dismissed' }), mailItem({ dismissed_at: now }),
    ]) expect(parsePendingMailIntakeItem(candidate)).toBeNull();
    expect(parseDismissedMailIntakeItem(mailItem({ status: 'dismissed', dismissed_at: null }))).toBeNull();
    expect(parseDismissedMailIntakeItem(mailItem({ status: 'pending', dismissed_at: now }))).toBeNull();
  });

  it('enforces mail-intake candidate string and fuel bounds exactly', () => {
    expect(parsePendingMailIntakeItem(mailItem({ subject: 'x'.repeat(513) }))).toBeNull();
    expect(parsePendingMailIntakeItem(mailItem({ vessel_voyage: '' }))).toBeNull();
    expect(parsePendingMailIntakeItem(mailItem({ port_name: ' x' }))).toBeNull();
    expect(parsePendingMailIntakeItem(mailItem({ delivery_window: 'x'.repeat(257) }))).toBeNull();
    expect(parsePendingMailIntakeItem(mailItem({ fuel_items: [] }))).not.toBeNull();
    expect(parsePendingMailIntakeItem(mailItem({ fuel_items: ['vlsfo', 'hsfo', 'ulsfo', 'lsfo', 'lsmgo', 'vlsfo'].map((grade) => ({ grade, quantity: 1 })) }))).toBeNull();
    expect(parsePendingMailIntakeItem(mailItem({ fuel_items: [{ grade: 'mgo', quantity: 1 }] }))).toBeNull();
    expect(parsePendingMailIntakeItem(mailItem({ fuel_items: [{ grade: 'vlsfo', quantity: 1 }, { grade: 'vlsfo', quantity: 2 }] }))).toBeNull();
    expect(parsePendingMailIntakeItem(mailItem({ fuel_items: [{ grade: 'vlsfo', quantity: 0 }] }))).toBeNull();
    expect(parsePendingMailIntakeItem(mailItem({ fuel_items: [{ grade: 'vlsfo', quantity: Number.POSITIVE_INFINITY }] }))).toBeNull();
    expect(parsePendingMailIntakeItem(mailItem({ fuel_items: [{ grade: 'vlsfo', quantity: 1, unit: 'mt' }] }))).toBeNull();
  });

  it('enforces mail-intake warning count, nonblank text, and length bounds', () => {
    expect(parsePendingMailIntakeItem(mailItem({ warnings: [] }))).not.toBeNull();
    expect(parsePendingMailIntakeItem(mailItem({ warnings: Array.from({ length: 20 }, (_, index) => `Warning ${index}`) }))).not.toBeNull();
    expect(parsePendingMailIntakeItem(mailItem({ warnings: Array.from({ length: 21 }, (_, index) => `Warning ${index}`) }))).toBeNull();
    expect(parsePendingMailIntakeItem(mailItem({ warnings: [' '] }))).toBeNull();
    expect(parsePendingMailIntakeItem(mailItem({ warnings: ['x'.repeat(301)] }))).toBeNull();
  });

  it('rejects invalid bid lifecycle combinations and non-positive awards', () => {
    expect(parseBid(bid({ raw_status: 'awarded', effective_status: 'awarded', closed_at: now, awarded_quote_id: id, awarded_trader_organization_id: otherId, awarded_trader_organization_label: 'Trader', awarded_total_amount: -1, awarded_at: now }))).toBeNull();
    expect(parseBid(bid({ raw_status: 'cancelled', effective_status: 'cancelled', cancelled_at: null }))).toBeNull();
    expect(parseBid(bid({ raw_status: 'awarded', effective_status: 'awarded', closed_at: now, awarded_quote_id: id, awarded_trader_organization_id: otherId, awarded_trader_organization_label: 'Trader', awarded_total_amount: 0, awarded_at: now }))).toBeNull();
    expect(parseTraderBid({ ...bid({ raw_status: 'awarded', effective_status: 'awarded', closed_at: now, awarded_total_amount: 0 }), created_by: undefined, created_by_label: undefined, responsible_buyer_user_id: undefined, responsible_buyer_label: undefined, awarded_quote_id: undefined, awarded_trader_organization_id: undefined, awarded_trader_organization_label: undefined, awarded_at: undefined })).toBeNull();
  });

  it('accepts only coherent deadline-derived open states in both bid parsers', () => {
    const trader = (value: Record<string, unknown>) => parseTraderBid({ ...value, created_by: undefined, created_by_label: undefined, responsible_buyer_user_id: undefined, responsible_buyer_label: undefined, awarded_quote_id: undefined, awarded_trader_organization_id: undefined, awarded_trader_organization_label: undefined, awarded_total_amount: undefined, awarded_at: undefined });
    expect(parseBid(bid({ raw_status: 'open', effective_status: 'closed', deadline_at: null }))).toBeNull();
    expect(trader(bid({ raw_status: 'open', effective_status: 'closed', deadline_at: null }))).toBeNull();
    expect(parseBid(bid({ raw_status: 'open', effective_status: 'closed', deadline_at: now }))).not.toBeNull();
    expect(trader(bid({ raw_status: 'open', effective_status: 'closed', deadline_at: now }))).not.toBeNull();
    expect(parseBid(bid({ raw_status: 'open', effective_status: 'open', deadline_at: null }))).not.toBeNull();
    expect(parseBid(bid({ raw_status: 'cancelled', effective_status: 'cancelled', closed_at: now, cancelled_at: now }))).not.toBeNull();
  });

  it('rejects an invalid non-null audit revision and unknown event', () => {
    expect(parseBidAuditEvent(audit({ prior_revision: 'bad' }))).toBeNull();
    expect(parseBidAuditEvent(audit({ event_type: 'invented' }))).toBeNull();
  });

  it('rejects impossible quote totals and award flags', () => {
    expect(parseQuote(quote({ total_amount: 0 }))).toBeNull();
    expect(parseQuote(quote({ eligible_for_award: true, is_awarded: true }))).toBeNull();
  });

  it('strictly parses unquoted and quoted BUYER SELLER comparison rows', () => {
    expect(parseBuyerSellerComparison(sellerComparison())).toEqual(sellerComparison());
    expect(parseBuyerSellerComparison(sellerComparison({ quote: quote() }))).toEqual(sellerComparison({ quote: quote() }));
    expect(parseBuyerSellerComparison({ ...sellerComparison(), member_email: 'hidden@example.test' })).toBeNull();
    expect(parseBuyerSellerComparison(sellerComparison({ access_active: false, quote: null }))).toBeNull();
    expect(parseBuyerSellerComparison(sellerComparison({ quote: { ...quote(), secret: true } }))).toBeNull();
  });

  it('rejects nested quote identity and outer metadata mismatches', () => {
    for (const candidate of [
      sellerComparison({ quote: quote({ bid_id: id }) }),
      sellerComparison({ quote: quote({ trader_organization_id: otherId }) }),
      sellerComparison({ quote: quote({ trader_organization_label: 'Other label' }) }),
      sellerComparison({ quote: quote({ access_active: false }) }),
      sellerComparison({ quote: quote({ organization_active: false }) }),
    ]) expect(parseBuyerSellerComparison(candidate)).toBeNull();
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
