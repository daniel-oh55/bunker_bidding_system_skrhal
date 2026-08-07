import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AccessContext } from '../auth/access-client';
import type { BiddingClient } from './bidding-client';
import { ContextWorkspace } from './context-workspace';

const buyer: AccessContext = { membership_id: '10000000-0000-4000-8000-000000000001', organization_id: '20000000-0000-4000-8000-000000000001', organization_kind: 'buyer', membership_role: 'buyer_operator', organization_label: 'Buyer Alpha' };
const trader: AccessContext = { membership_id: '10000000-0000-4000-8000-000000000002', organization_id: '20000000-0000-4000-8000-000000000002', organization_kind: 'trader', membership_role: 'trader', organization_label: 'Trader Bravo' };
const result = { data: [], error: null };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((next) => { resolve = next; }); return { promise, resolve }; }
function clientWithPendingBuyerLoad(pending?: Promise<typeof result>) {
  return {
    listActiveBuyers: vi.fn(() => pending ?? Promise.resolve(result)), listBids: vi.fn(() => pending ?? Promise.resolve(result)), listActiveTraderOrganizations: vi.fn(() => pending ?? Promise.resolve(result)), listTraderBids: vi.fn(() => Promise.resolve(result)), listMyQuotes: vi.fn(() => Promise.resolve(result)),
  } as unknown as BiddingClient;
}

describe('workspace context routing', () => {
  it('auto-selects a single server-returned context without offering a membership input', async () => {
    render(<ContextWorkspace contexts={[buyer]} client={clientWithPendingBuyerLoad()} recheck={vi.fn()} />);
    expect(await screen.findByText('BUYER operations')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /membership context/i })).not.toBeInTheDocument();
    expect(screen.getByText('Buyer Alpha · buyer · buyer_operator')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(buyer.organization_id);
  });

  it('exposes only server-returned contexts and rejects an arbitrary selected value', async () => {
    render(<ContextWorkspace contexts={[buyer, trader]} client={clientWithPendingBuyerLoad()} recheck={vi.fn()} />);
    const selector = await screen.findByRole('combobox', { name: /membership context/i });
    expect(selector.querySelectorAll('option')).toHaveLength(2);
    expect(Array.from(selector.querySelectorAll('option')).map((option) => option.getAttribute('value'))).toEqual([buyer.membership_id, trader.membership_id]);
    expect(Array.from(selector.querySelectorAll('option')).map((option) => option.textContent)).toEqual([
      'Buyer Alpha · buyer · buyer_operator',
      'Trader Bravo · trader · trader',
    ]);
    expect(document.body).not.toHaveTextContent(buyer.organization_id);
    expect(document.body).not.toHaveTextContent(trader.organization_id);
    fireEvent.change(selector, { target: { value: '30000000-0000-4000-8000-000000000003' } });
    expect(selector).toHaveValue(buyer.membership_id);
  });

  it('uses the neutral shortened organization ID for an old context without a label', async () => {
    const oldContext = { ...buyer };
    delete oldContext.organization_label;

    render(<ContextWorkspace contexts={[oldContext]} client={clientWithPendingBuyerLoad()} recheck={vi.fn()} />);

    expect(await screen.findByText('20000000…0001 · buyer · buyer_operator')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(oldContext.organization_id);
  });

  it('removes BUYER content immediately and ignores delayed BUYER data after switching to TRADER', async () => {
    const delayed = deferred<typeof result>(); const client = clientWithPendingBuyerLoad(delayed.promise);
    render(<ContextWorkspace contexts={[buyer, trader]} client={client} recheck={vi.fn()} />);
    expect(await screen.findByText('BUYER operations')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: /membership context/i }), { target: { value: trader.membership_id } });
    expect(screen.queryByText('BUYER operations')).not.toBeInTheDocument();
    expect(await screen.findByText('TRADER operations')).toBeInTheDocument();
    delayed.resolve(result);
    await waitFor(() => expect(screen.queryByText('BUYER operations')).not.toBeInTheDocument());
  });

  it('does not retain a membership context removed by access revalidation', async () => {
    const client = clientWithPendingBuyerLoad(); const view = render(<ContextWorkspace contexts={[buyer, trader]} client={client} recheck={vi.fn()} />);
    const selector = await screen.findByRole('combobox', { name: /membership context/i });
    fireEvent.change(selector, { target: { value: buyer.membership_id } });
    view.rerender(<ContextWorkspace contexts={[trader]} client={client} recheck={vi.fn()} />);
    expect(await screen.findByText('TRADER operations')).toBeInTheDocument();
    expect(screen.queryByText('BUYER operations')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /membership context/i })).not.toBeInTheDocument();
  });
});
