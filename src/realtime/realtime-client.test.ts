import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createRealtimeInvalidationClient } from './realtime-client';

const buyer = {
  membership_id: '10000000-0000-4000-8000-000000000001',
  organization_id: '20000000-0000-4000-8000-000000000001',
  organization_kind: 'buyer' as const,
  membership_role: 'buyer_operator' as const,
};
const trader = {
  ...buyer,
  membership_id: '10000000-0000-4000-8000-000000000002',
  organization_id: '20000000-0000-4000-8000-000000000002',
  organization_kind: 'trader' as const,
  membership_role: 'trader' as const,
};

function harness() {
  const callbacks = new Map<string, (message: { event?: unknown; payload?: { kind?: unknown } }) => void>();
  const channels: { topic: string; options: unknown; channel: object }[] = [];
  const removeChannel = vi.fn(() => Promise.resolve('ok'));
  const client = {
    channel: vi.fn((topic: string, options: unknown) => {
      const channel = {
        on: vi.fn((_type: string, filter: { event: string }, callback: (message: { event?: unknown; payload?: { kind?: unknown } }) => void) => {
          callbacks.set(topic, callback);
          expect(filter.event).toMatch(/^(access_changed|workspace_changed)$/);
          return channel;
        }),
        subscribe: vi.fn(() => channel),
      };
      channels.push({ topic, options, channel });
      return channel;
    }),
    removeChannel,
  } as unknown as SupabaseClient;
  return { client, callbacks, channels, removeChannel };
}

describe('Realtime invalidation adapter', () => {
  it('uses only private self and selected-workspace topics', () => {
    const fake = harness();
    const realtime = createRealtimeInvalidationClient(fake.client);
    realtime.subscribeToAccessInvalidations('90000000-0000-4000-8000-000000000001', vi.fn());
    realtime.subscribeToWorkspaceInvalidations(buyer, vi.fn());
    realtime.subscribeToWorkspaceInvalidations(trader, vi.fn());
    expect(fake.channels.map(({ topic }) => topic)).toEqual([
      'workspace:access:90000000-0000-4000-8000-000000000001',
      'workspace:buyer',
      'workspace:trader:20000000-0000-4000-8000-000000000002',
    ]);
    expect(fake.channels.every(({ options }) => options && (options as { config: { private: boolean } }).config.private)).toBe(true);
  });

  it('accepts only the expected exact event kind and ignores a cleaned-up callback', () => {
    const fake = harness();
    const callback = vi.fn();
    const cleanup = createRealtimeInvalidationClient(fake.client).subscribeToWorkspaceInvalidations(buyer, callback);
    const message = fake.callbacks.get('workspace:buyer')!;
    message({ event: 'workspace_changed', payload: { kind: 'access_changed' } });
    message({ event: 'other', payload: { kind: 'workspace_changed' } });
    expect(callback).not.toHaveBeenCalled();
    message({ event: 'workspace_changed', payload: { kind: 'workspace_changed' } });
    expect(callback).toHaveBeenCalledOnce();
    cleanup(); cleanup();
    expect(fake.removeChannel).toHaveBeenCalledOnce();
    message({ event: 'workspace_changed', payload: { kind: 'workspace_changed' } });
    expect(callback).toHaveBeenCalledOnce();
  });
});
