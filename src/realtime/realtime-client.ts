import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccessContext } from '../auth/access-client';

export interface RealtimeInvalidationClient {
  subscribeToAccessInvalidations(userId: string, onInvalidation: () => void): () => void;
  subscribeToWorkspaceInvalidations(context: AccessContext, onInvalidation: () => void): () => void;
}

type BroadcastPayload = { event?: unknown; payload?: { kind?: unknown } };

function workspaceTopic(context: AccessContext): string {
  return context.organization_kind === 'buyer'
    ? 'workspace:buyer'
    : `workspace:trader:${context.organization_id}`;
}

function subscribe(
  client: SupabaseClient,
  topic: string,
  event: 'access_changed' | 'workspace_changed',
  onInvalidation: () => void,
): () => void {
  let active = true;
  const channel = client
    .channel(topic, { config: { private: true } })
    .on('broadcast', { event }, (message: BroadcastPayload) => {
      if (active && message.event === event && message.payload?.kind === event) {
        onInvalidation();
      }
    })
    .subscribe();

  return () => {
    if (!active) return;
    active = false;
    void client.removeChannel(channel);
  };
}

export function createRealtimeInvalidationClient(client: SupabaseClient): RealtimeInvalidationClient {
  return {
    subscribeToAccessInvalidations(userId, onInvalidation) {
      return subscribe(client, `workspace:access:${userId}`, 'access_changed', onInvalidation);
    },
    subscribeToWorkspaceInvalidations(context, onInvalidation) {
      return subscribe(client, workspaceTopic(context), 'workspace_changed', onInvalidation);
    },
  };
}
