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

export type AddressReference = {
  token: string;
  naddr: string;
  identifier: string;
  pubkey: string;
  kind: number;
  relays: string[];
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

export function extractAddressReferences(content: string): AddressReference[] {
  const references = new Map<string, AddressReference>();

  for (const match of content.matchAll(NOSTR_REFERENCE_RE)) {
    const token = match[0];
    const naddr = match[1]!;

    try {
      const decoded = nip19.decode(naddr);

      if (decoded.type !== 'naddr') {
        continue;
      }

      const id = `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`;

      references.set(id, {
        token,
        naddr,
        identifier: decoded.data.identifier,
        pubkey: decoded.data.pubkey,
        kind: decoded.data.kind,
        relays: decoded.data.relays ?? [],
      });
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

export async function fetchTagReferencedEvents({
  pool,
  event,
  fallbackRelays,
}: {
  pool: SimplePool;
  event: NostrEvent;
  fallbackRelays: string[];
}): Promise<FetchedReferencedEvents> {
  const ids = [
    ...new Set(
      event.tags
        .filter((tag) => (tag[0] === 'e' || tag[0] === 'q') && tag[1]?.trim())
        .map((tag) => tag[1]!.trim()),
    ),
  ].slice(0, 8);

  const relays = filterBlockedReadRelays(
    uniqueRelays([...fallbackRelays, ...PROFILE_RELAYS_FOR_QUERY]),
  );

  if (ids.length === 0 || relays.length === 0) {
    return { references: [], events: [], missingIds: ids };
  }

  const results = await Promise.all(
    ids.map(async (id) => {
      const found = await pool.get(relays, { ids: [id], limit: 1 });
      const parsed = found ? NostrEventSchema.safeParse(found) : null;

      return parsed?.success ? parsed.data : null;
    }),
  );

  const events = results.filter((item): item is NostrEvent => item !== null);
  const foundIds = new Set(events.map((item) => item.id));

  return {
    references: ids.map((id) => ({ token: id, id, relays: [] })),
    events,
    missingIds: ids.filter((id) => !foundIds.has(id)),
  };
}
