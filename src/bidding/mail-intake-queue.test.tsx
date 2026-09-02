import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MailIntakeQueue as OperationalDateMailIntakeQueue } from './mail-intake-queue';
import type { BiddingClient, BiddingResult } from './bidding-client';
import type { MailIntakeItem, WorkflowErrorKind } from './types';

const membershipId = '10000000-0000-4000-8000-000000000001';
const nextMembershipId = '10000000-0000-4000-8000-000000000002';
const itemId = '20000000-0000-4000-8000-000000000001';
const now = '2026-08-21T03:00:00.000Z';
const MailIntakeQueue = (props: Omit<ComponentProps<typeof OperationalDateMailIntakeQueue>, 'selectedBidDate'>) => <OperationalDateMailIntakeQueue {...props} selectedBidDate="2026-08-21" />;
const ok = <T,>(data: T): BiddingResult<T> => ({ data, error: null });
const failure = <T,>(kind: WorkflowErrorKind, code: string | null = null): BiddingResult<T> => ({ data: null, error: { kind, code, message: 'raw server detail must not render' } });
const deferred = <T,>() => { let resolve!: (value: T) => void; return { promise: new Promise<T>((done) => { resolve = done; }), resolve }; };
const item = (overrides: Partial<MailIntakeItem> = {}): MailIntakeItem => ({
  id: itemId,
  received_at: now,
  subject: 'MV Horizon bunker request',
  vessel_voyage: 'MV Horizon / 024',
  port_name: 'Busan',
  delivery_window: '22-23 Aug 2026',
  fuel_items: [{ grade: 'vlsfo', quantity: 500 }, { grade: 'lsmgo', quantity: 25 }],
  warnings: ['Confirm delivery timezone'],
  status: 'pending',
  revision: 1,
  created_at: now,
  updated_at: now,
  dismissed_at: null,
  ...overrides,
});
function queueClient(listMailIntakeItems: BiddingClient['listMailIntakeItems'], dismissMailIntakeItem: BiddingClient['dismissMailIntakeItem'] = vi.fn(() => Promise.resolve(ok(item({ status: 'dismissed', revision: 2, dismissed_at: now }))))) {
  const createBid = vi.fn();
  return { client: { listMailIntakeItems, dismissMailIntakeItem, createBid } as unknown as BiddingClient, createBid };
}

describe('BUYER mail intake queue', () => {
  it('classifies pending received_at instants by the selected Asia/Seoul date', async () => {
    const boundary = item({ id: itemId, received_at: '2026-08-30T15:00:00Z', subject: 'Seoul next day' });
    const prior = item({ id: nextMembershipId, received_at: '2026-08-30T14:59:59Z', subject: 'Seoul prior day' });
    const { client } = queueClient(vi.fn(() => Promise.resolve(ok([prior, boundary]))));
    render(<OperationalDateMailIntakeQueue client={client} membershipId={membershipId} selectedBidDate="2026-08-31" onAuthorizationFailure={vi.fn()} />);
    expect(await screen.findByText('Seoul next day')).toBeInTheDocument();
    expect(screen.queryByText('Seoul prior day')).not.toBeInTheDocument();
    expect(screen.getByText('1 pending for 2026-08-31')).toBeInTheDocument();
  });

  it('shows isolated loading and empty states', async () => {
    const pending = deferred<BiddingResult<MailIntakeItem[]>>();
    const { client } = queueClient(vi.fn(() => pending.promise));
    render(<MailIntakeQueue client={client} membershipId={membershipId} onAuthorizationFailure={vi.fn()} />);
    expect(screen.getByText('Loading mail intake')).toBeInTheDocument();
    await act(async () => { pending.resolve(ok([])); await pending.promise; });
    expect(await screen.findByText('No pending mail intake for this operational date')).toBeInTheDocument();
    expect(screen.getByText('0 pending for 2026-08-21')).toBeInTheDocument();
  });

  it('renders bounded candidates and warnings as text without provider identity or deadline authority', async () => {
    const leaked = { ...item(), source_provider: 'secret-provider', source_mailbox_key: 'secret-box', source_message_id: 'secret-message' } as MailIntakeItem;
    const { client } = queueClient(vi.fn(() => Promise.resolve(ok([leaked, item({ id: '20000000-0000-4000-8000-000000000002', subject: '', vessel_voyage: null, port_name: null, delivery_window: null, fuel_items: [], warnings: [] })]))));
    render(<MailIntakeQueue client={client} membershipId={membershipId} onAuthorizationFailure={vi.fn()} />);
    expect(await screen.findByText('MV Horizon bunker request')).toBeInTheDocument();
    expect(screen.getByText('MV Horizon / 024')).toBeInTheDocument();
    expect(screen.getByText('Busan')).toBeInTheDocument();
    expect(screen.getByText('22-23 Aug 2026')).toBeInTheDocument();
    expect(screen.getByText('VLSFO 500 MT, LSMGO 25 MT')).toBeInTheDocument();
    expect(screen.getByText('Confirm delivery timezone')).toBeInTheDocument();
    expect(screen.getByText('(No subject)')).toBeInTheDocument();
    expect(screen.getAllByText('Not extracted')).toHaveLength(3);
    expect(screen.getByText('None extracted')).toBeInTheDocument();
    expect(screen.getByText('Received time is source metadata, not the bidding deadline.')).toBeInTheDocument();
    expect(screen.getByText('Items prepare a private BUYER draft. Only explicit Publish creates an authoritative BID.')).toBeInTheDocument();
    expect(screen.queryByText(/secret-provider|secret-box|secret-message/)).not.toBeInTheDocument();
  });

  it('opens the exact pending item as a private prepared BID draft', async () => {
    const onPrepare = vi.fn();
    const { client } = queueClient(vi.fn(() => Promise.resolve(ok([item()]))));
    render(<MailIntakeQueue client={client} membershipId={membershipId} onPrepare={onPrepare} onAuthorizationFailure={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Prepare BID' }));
    expect(onPrepare).toHaveBeenCalledWith(item());
  });

  it('manually refreshes the authoritative pending queue and invalidates open confirmation', async () => {
    const revised = item({ revision: 2, updated_at: '2026-08-21T04:00:00.000Z' });
    const listMailIntakeItems = vi.fn<BiddingClient['listMailIntakeItems']>().mockResolvedValueOnce(ok([item()])).mockResolvedValueOnce(ok([revised]));
    const dismissMailIntakeItem = vi.fn<BiddingClient['dismissMailIntakeItem']>();
    const { client } = queueClient(listMailIntakeItems, dismissMailIntakeItem);
    render(<MailIntakeQueue client={client} membershipId={membershipId} onAuthorizationFailure={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.getByRole('button', { name: 'Confirm dismiss for all BUYERs' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh mail intake' }));
    await waitFor(() => expect(listMailIntakeItems).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Revision 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm dismiss for all BUYERs' })).not.toBeInTheDocument();
    expect(dismissMailIntakeItem).not.toHaveBeenCalled();
  });

  it('requires target-bound two-step dismissal and supports cancel', async () => {
    const dismissMailIntakeItem = vi.fn<BiddingClient['dismissMailIntakeItem']>();
    const { client } = queueClient(vi.fn(() => Promise.resolve(ok([item()]))), dismissMailIntakeItem);
    render(<MailIntakeQueue client={client} membershipId={membershipId} onAuthorizationFailure={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.getByText('Dismissal is shared and irreversible.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Confirm dismiss for all BUYERs' })).not.toBeInTheDocument();
    expect(dismissMailIntakeItem).not.toHaveBeenCalled();
  });

  it('dismisses the exact target and revision, then reloads the authoritative pending queue without creating a bid', async () => {
    const listMailIntakeItems = vi.fn<BiddingClient['listMailIntakeItems']>().mockResolvedValueOnce(ok([item()])).mockResolvedValueOnce(ok([]));
    const dismissMailIntakeItem = vi.fn<BiddingClient['dismissMailIntakeItem']>(() => Promise.resolve(ok(item({ status: 'dismissed', revision: 2, dismissed_at: now }))));
    const { client, createBid } = queueClient(listMailIntakeItems, dismissMailIntakeItem);
    render(<MailIntakeQueue client={client} membershipId={membershipId} onAuthorizationFailure={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm dismiss for all BUYERs' }));
    expect(await screen.findByText('No pending mail intake for this operational date')).toBeInTheDocument();
    expect(dismissMailIntakeItem).toHaveBeenCalledWith(membershipId, itemId, 1);
    expect(listMailIntakeItems).toHaveBeenCalledTimes(2);
    expect(createBid).not.toHaveBeenCalled();
  });

  it.each([
    ['conflict', 'This mail intake item changed elsewhere. The latest pending queue was loaded.'],
    ['lifecycle', 'This mail intake item is no longer pending. The latest pending queue was loaded.'],
    ['not_found', 'This mail intake item no longer exists. The latest pending queue was loaded.'],
  ] as const)('reloads after %s dismissal and retains a fixed local error', async (kind, expectedMessage) => {
    const listMailIntakeItems = vi.fn<BiddingClient['listMailIntakeItems']>().mockResolvedValueOnce(ok([item()])).mockResolvedValueOnce(ok([]));
    const dismissMailIntakeItem = vi.fn<BiddingClient['dismissMailIntakeItem']>(() => Promise.resolve(failure(kind)));
    const { client } = queueClient(listMailIntakeItems, dismissMailIntakeItem);
    render(<MailIntakeQueue client={client} membershipId={membershipId} onAuthorizationFailure={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm dismiss for all BUYERs' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(expectedMessage);
    expect(screen.queryByText('raw server detail must not render')).not.toBeInTheDocument();
    expect(listMailIntakeItems).toHaveBeenCalledTimes(2);
  });

  it('clears protected queue data immediately and rechecks after authorization failure', async () => {
    const listMailIntakeItems = vi.fn<BiddingClient['listMailIntakeItems']>().mockResolvedValueOnce(ok([item()])).mockResolvedValueOnce(failure('authorization', '42501'));
    const onAuthorizationFailure = vi.fn();
    const { client } = queueClient(listMailIntakeItems);
    render(<MailIntakeQueue client={client} membershipId={membershipId} onAuthorizationFailure={onAuthorizationFailure} />);
    expect(await screen.findByText('MV Horizon bunker request')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh mail intake' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your authorization changed. Access is being verified again.');
    expect(screen.queryByText('MV Horizon bunker request')).not.toBeInTheDocument();
    expect(onAuthorizationFailure).toHaveBeenCalledOnce();
  });

  it('ignores a stale list response after membership changes', async () => {
    const stale = deferred<BiddingResult<MailIntakeItem[]>>();
    const listMailIntakeItems = vi.fn<BiddingClient['listMailIntakeItems']>((selectedMembership) => selectedMembership === membershipId ? stale.promise : Promise.resolve(ok([item({ subject: 'Current membership item' })])));
    const { client } = queueClient(listMailIntakeItems);
    const view = render(<MailIntakeQueue client={client} membershipId={membershipId} onAuthorizationFailure={vi.fn()} />);
    view.rerender(<MailIntakeQueue client={client} membershipId={nextMembershipId} onAuthorizationFailure={vi.fn()} />);
    expect(await screen.findByText('Current membership item')).toBeInTheDocument();
    await act(async () => { stale.resolve(ok([item({ subject: 'Stale membership item' })])); await stale.promise; });
    expect(screen.getByText('Current membership item')).toBeInTheDocument();
    expect(screen.queryByText('Stale membership item')).not.toBeInTheDocument();
  });

  it('ignores a stale dismiss authorization response after membership changes', async () => {
    const staleDismiss = deferred<BiddingResult<MailIntakeItem>>();
    const listMailIntakeItems = vi.fn<BiddingClient['listMailIntakeItems']>((selectedMembership) => Promise.resolve(ok([item({ subject: selectedMembership === membershipId ? 'Old membership item' : 'Current membership item' })])));
    const dismissMailIntakeItem = vi.fn<BiddingClient['dismissMailIntakeItem']>(() => staleDismiss.promise);
    const onAuthorizationFailure = vi.fn();
    const { client } = queueClient(listMailIntakeItems, dismissMailIntakeItem);
    const view = render(<MailIntakeQueue client={client} membershipId={membershipId} onAuthorizationFailure={onAuthorizationFailure} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm dismiss for all BUYERs' }));
    view.rerender(<MailIntakeQueue client={client} membershipId={nextMembershipId} onAuthorizationFailure={onAuthorizationFailure} />);
    expect(await screen.findByText('Current membership item')).toBeInTheDocument();
    await act(async () => { staleDismiss.resolve(failure('authorization', '42501')); await staleDismiss.promise; });
    expect(screen.getByText('Current membership item')).toBeInTheDocument();
    expect(onAuthorizationFailure).not.toHaveBeenCalled();
  });
});
