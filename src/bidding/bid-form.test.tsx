import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreateBidForm } from './bid-form';
import { BuyerBidDetail } from './buyer-bid-detail';
import type { BiddingClient } from './bidding-client';
import type { Bid, Quote } from './types';

const membership = '10000000-0000-4000-8000-000000000001'; const buyerId = '10000000-0000-4000-8000-000000000002'; const bidId = '10000000-0000-4000-8000-000000000003'; const now = '2026-08-03T03:00:00.000Z';
const buyers = [{ user_id: buyerId, display_label: 'Responsible buyer', active_buyer_membership_count: 1 }];
const bid: Bid = { id: bidId, vessel_voyage: 'MV Before', port_name: 'Busan', delivery_window: 'Tomorrow', deadline_at: '2026-08-03T03:00:00.000Z', raw_status: 'open', effective_status: 'open', revision: 3, created_by: membership, created_by_label: 'Creator', responsible_buyer_user_id: buyerId, responsible_buyer_label: 'Responsible buyer', fuel_items: [{ fuel_grade: 'vlsfo', quantity_mt: 10 }], created_at: now, updated_at: now, closed_at: null, cancelled_at: null, awarded_quote_id: null, awarded_trader_organization_id: null, awarded_trader_organization_label: null, awarded_total_amount: null, awarded_at: null };
const updateBid = vi.fn<BiddingClient['updateBid']>(() => Promise.resolve({ data: bid, error: null }));
const fakeClient = { updateBid } as unknown as BiddingClient;

function fillCreateForm() {
  fireEvent.change(screen.getByLabelText('Vessel / voyage'), { target: { value: 'MV New' } }); fireEvent.change(screen.getByLabelText('Port'), { target: { value: 'Ulsan' } }); fireEvent.change(screen.getByLabelText('Delivery window'), { target: { value: 'Next week' } }); fireEvent.change(screen.getByLabelText('Create deadline'), { target: { value: '2026-08-04T12:30' } }); fireEvent.change(screen.getByLabelText('Responsible BUYER'), { target: { value: buyerId } }); fireEvent.change(screen.getByLabelText('Fuel quantity 1'), { target: { value: '15' } });
}

describe('BUYER bid forms and detail editor', () => {
  it('preserves every create draft field after failure and clears all of them only after success', async () => {
    const submit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true); render(<CreateBidForm buyers={buyers} disabled={false} onSubmit={submit} />); fillCreateForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create bid' })); await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Vessel / voyage')).toHaveValue('MV New'); expect(screen.getByLabelText('Port')).toHaveValue('Ulsan'); expect(screen.getByLabelText('Delivery window')).toHaveValue('Next week'); expect(screen.getByLabelText('Create deadline')).toHaveValue('2026-08-04T12:30'); expect(screen.getByLabelText('Responsible BUYER')).toHaveValue(buyerId); expect(screen.getByLabelText('Fuel quantity 1')).toHaveValue(15);
    fireEvent.click(screen.getByRole('button', { name: 'Create bid' })); await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Vessel / voyage')).toHaveValue(''); expect(screen.getByLabelText('Port')).toHaveValue(''); expect(screen.getByLabelText('Delivery window')).toHaveValue(''); expect(screen.getByLabelText('Create deadline')).toHaveValue(''); expect(screen.getByLabelText('Responsible BUYER')).toHaveValue(''); expect(screen.getByLabelText('Fuel quantity 1')).toHaveValue(null);
  });

  it('submits a complete pre-quote commercial edit in current grade and quantity order', async () => {
    const mutate = vi.fn<(operation: () => Promise<unknown>) => Promise<boolean>>(() => Promise.resolve(true)); render(<BuyerBidDetail bid={bid} buyers={buyers} organizations={[]} detail={{ access: [], quotes: [], audit: [] }} pending={false} client={fakeClient} membershipId={membership} mutate={mutate} refresh={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Edit vessel / voyage'), { target: { value: 'MV After' } }); fireEvent.change(screen.getByLabelText('Edit port'), { target: { value: 'Incheon' } }); fireEvent.change(screen.getByLabelText('Edit delivery window'), { target: { value: 'Friday' } }); fireEvent.change(screen.getByLabelText('Fuel grade 1'), { target: { value: 'ulsfo' } }); fireEvent.change(screen.getByLabelText('Fuel quantity 1'), { target: { value: '12' } }); fireEvent.click(screen.getByRole('button', { name: 'Add fuel' })); fireEvent.change(screen.getByLabelText('Fuel quantity 2'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save bid' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce()); await mutate.mock.calls[0]![0]();
    expect(updateBid).toHaveBeenCalledWith(membership, bidId, 3, { vesselVoyage: 'MV After', portName: 'Incheon', deliveryWindow: 'Friday', deadlineAt: '2026-08-03T03:00:00.000Z', fuelGrades: ['ulsfo', 'vlsfo'], quantities: [12, 20] });
  });

  it('locks commercial controls after a quote while keeping the deadline update available', () => {
    const quotes: Quote[] = [{ id: '10000000-0000-4000-8000-000000000004', bid_id: bidId, trader_organization_id: '20000000-0000-4000-8000-000000000001', trader_organization_label: 'Trader', revision: 1, created_by: membership, fuel_prices: [{ fuel_grade: 'vlsfo', unit_price: 1 }], barge_fee: 0, total_amount: 10, created_at: now, updated_at: now, access_active: true, organization_active: true, eligible_for_award: true, is_awarded: false }];
    render(<BuyerBidDetail bid={bid} buyers={buyers} organizations={[]} detail={{ access: [], quotes, audit: [] }} pending={false} client={fakeClient} membershipId={membership} mutate={vi.fn()} refresh={vi.fn()} />);
    expect(screen.getByLabelText('Edit vessel / voyage')).toBeDisabled(); expect(screen.getByLabelText('Edit port')).toBeDisabled(); expect(screen.getByLabelText('Fuel grade 1')).toBeDisabled(); expect(screen.getByLabelText('Fuel quantity 1')).toBeDisabled(); expect(screen.getByLabelText('Edit deadline')).toBeEnabled();
  });
});
