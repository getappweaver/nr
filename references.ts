import { nip19 } from 'nostr-tools';
import type { SimplePool } from 'nostr-tools/pool';

import { PROFILE_RELAYS_FOR_QUERY, uniqueRelays } from '@src/nostr/nip65';
import { filterBlockedReadRelays } from '@src/nostr/relay-notices';

import { NostrEventSchema, type NostrEvent } from './commands/shared/types';

export type EventReference = {
  token: string;
  id: string;
  relays: string[];
};

export type ProfileReference = {
  token: string;
  pubkey: string;
};

const NOSTR_REFERENCE_RE = /nostr:([a-z0-9]+)/gi;

function decodeReference(token: string, value: string): EventReference | null {
  try {
    const decoded = nip19.decode(value);

    if (decoded.type === 'note') {
      return { token, id: decoded.data, relays: [] };
    }

    if (decoded.type === 'nevent') {
      return {
        token,
        id: decoded.data.id,
        relays: decoded.data.relays ?? [],
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function extractEventReferences(content: string): EventReference[] {
  const references = new Map<string, EventReference>();

  for (const match of content.matchAll(NOSTR_REFERENCE_RE)) {
    const token = match[0];
    const reference = decodeReference(token, match[1]!);

    if (!reference) {
      continue;
    }

    const existing = references.get(reference.id);

    references.set(reference.id, {
      id: reference.id,
      token: existing?.token ?? reference.token,
      relays: uniqueRelays([...(existing?.relays ?? []), ...reference.relays]),
    });
  }

  return [...references.values()];
}

export function extractProfileReferences(content: string): ProfileReference[] {
  const references = new Map<string, ProfileReference>();

  for (const match of content.matchAll(NOSTR_REFERENCE_RE)) {
    const token = match[0];

    try {
      const decoded = nip19.decode(match[1]!);

      if (decoded.type === 'npub') {
        references.set(decoded.data, { token, pubkey: decoded.data });
      }

      if (decoded.type === 'nprofile') {
        references.set(decoded.data.pubkey, {
          token,
          pubkey: decoded.data.pubkey,
        });
      }
    } catch {
      continue;
    }
  }

  return [...references.values()];
}

type FetchReferencedEventsProps = {
  pool: SimplePool;
  content: string;
  fallbackRelays: string[];
};

export type FetchedReferencedEvents = {
  references: EventReference[];
  events: NostrEvent[];
  missingIds: string[];
};

export async function fetchReferencedEvents({
  pool,
  content,
  fallbackRelays,
}: FetchReferencedEventsProps): Promise<FetchedReferencedEvents> {
  const references = extractEventReferences(content).slice(0, 5);

  if (references.length === 0) {
    return { references, events: [], missingIds: [] };
  }

  const fetched = await Promise.allSettled(
    references.map(async (reference) => {
      const relays = filterBlockedReadRelays(
        uniqueRelays([
          ...reference.relays,
          ...fallbackRelays,
          ...PROFILE_RELAYS_FOR_QUERY,
        ]),
      );

      if (relays.length === 0) {
        return null;
      }

      const event = await pool.get(relays, { ids: [reference.id], limit: 1 });
      const parsed = event ? NostrEventSchema.safeParse(event) : null;

      return parsed?.success ? parsed.data : null;
    }),
  );

  const events = fetched
    .filter(
      (entry): entry is PromiseFulfilledResult<NostrEvent | null> =>
        entry.status === 'fulfilled',
    )
    .map((entry) => entry.value)
    .filter((event): event is NostrEvent => event !== null);

  const foundIds = new Set(events.map((event) => event.id));

  return {
    references,
    events,
    missingIds: references
      .map((reference) => reference.id)
      .filter((id) => !foundIds.has(id)),
  };
}
