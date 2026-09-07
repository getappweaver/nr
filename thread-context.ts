import type { SimplePool } from 'nostr-tools/pool';

import { parseEventReferences } from '@src/nostr/event-references';
import { PROFILE_RELAYS_FOR_QUERY, uniqueRelays } from '@src/nostr/nip65';
import { filterBlockedReadRelays } from '@src/nostr/relay-notices';

import { NostrEventSchema, type NostrEvent } from './commands/shared/types';

export type Nip10Reference = {
  id: string;
  relay: string | null;
  marker: string | null;
};

export function extractNip10References(event: NostrEvent): Nip10Reference[] {
  const references = new Map<string, Nip10Reference>();

  for (const edge of parseEventReferences(event)) {
    if (
      (edge.role !== 'thread-root' && edge.role !== 'thread-parent') ||
      edge.target.type !== 'event'
    ) {
      continue;
    }

    const id = edge.target.eventId;
    const existing = references.get(id);

    references.set(id, {
      id,
      relay: existing?.relay ?? edge.relayHints[0] ?? null,
      marker:
        existing?.marker ?? (edge.role === 'thread-root' ? 'root' : 'reply'),
    });
  }

  return [...references.values()];
}

type FetchNip10ThreadContextProps = {
  pool: SimplePool;
  event: NostrEvent;
  fallbackRelays: string[];
};

export type FetchedNip10ThreadContext = {
  references: Nip10Reference[];
  events: NostrEvent[];
  missingIds: string[];
};

export async function fetchNip10ThreadContext({
  pool,
  event,
  fallbackRelays,
}: FetchNip10ThreadContextProps): Promise<FetchedNip10ThreadContext> {
  const references = extractNip10References(event).slice(0, 8);

  if (references.length === 0) {
    return { references, events: [], missingIds: [] };
  }

  const fetched = await Promise.allSettled(
    references.map(async (reference) => {
      const relays = filterBlockedReadRelays(
        uniqueRelays([
          ...(reference.relay ? [reference.relay] : []),
          ...fallbackRelays,
          ...PROFILE_RELAYS_FOR_QUERY,
        ]),
      );

      if (relays.length === 0) {
        return null;
      }

      const raw = await pool.get(relays, { ids: [reference.id], limit: 1 });
      const parsed = raw ? NostrEventSchema.safeParse(raw) : null;

      return parsed?.success ? parsed.data : null;
    }),
  );

  const events = fetched
    .filter(
      (entry): entry is PromiseFulfilledResult<NostrEvent | null> =>
        entry.status === 'fulfilled',
    )
    .map((entry) => entry.value)
    .filter(
      (contextEvent): contextEvent is NostrEvent => contextEvent !== null,
    );

  const foundIds = new Set(events.map((contextEvent) => contextEvent.id));

  return {
    references,
    events,
    missingIds: references
      .map((reference) => reference.id)
      .filter((id) => !foundIds.has(id)),
  };
}
