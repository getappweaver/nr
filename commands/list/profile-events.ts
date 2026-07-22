import { PROFILE_RELAYS_FOR_QUERY } from '@src/nostr/nip65';

import {
  reachableGraphEvents,
  seedStoredProfileEvents,
} from '../../nostr-resolution';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import type { NrProfileEvent } from '../shared/types';

import {
  categoryForNrEvent,
  kindsForNrFeedCategories,
  type NrFeedCategory,
} from './categories';

const MAX_EVENTS = 50;
const PROFILE_RESOLUTION_TIMEOUT_MS = 10_000;

export async function fetchNrProfileEvents({
  params,
  categories,
  cachedEvents,
}: {
  params: NrCommandAdapterParams;
  categories: NrFeedCategory[];
  cachedEvents: NrProfileEvent[];
}): Promise<NrProfileEvent[]> {
  const service = params.storedCtx.nostrResolution;
  const deadlineAtMs = Date.now() + PROFILE_RESOLUTION_TIMEOUT_MS;
  const fallbackRelays = [...PROFILE_RELAYS_FOR_QUERY];

  await seedStoredProfileEvents({ service, events: cachedEvents });

  const fetchedByKind = await Promise.all(
    kindsForNrFeedCategories(categories).map((kind) =>
      service.queryAuthorEvents({
        pubkey: params.storedCtx.masterPubkey,
        kind,
        relayHints: [],
        contextRelays: fallbackRelays,
        fallbackRelays,
        limit: MAX_EVENTS,
        refreshMode: 'require-fresh',
        refreshIntervalMs: 15 * 60 * 1_000,
        deadlineAtMs,
      }),
    ),
  );

  const events = new Map(
    [...cachedEvents.map(({ event }) => event), ...fetchedByKind.flat()].map(
      (event) => [event.id, event],
    ),
  );

  const selected = [...events.values()]
    .filter((event) => {
      const category = categoryForNrEvent(event);

      return category !== null && categories.includes(category);
    })
    .sort(
      (left, right) =>
        right.created_at - left.created_at || right.id.localeCompare(left.id),
    )
    .slice(0, MAX_EVENTS);

  const graph = await service.resolveGraph({
    rootEvents: selected,
    contextRelays: fallbackRelays,
    fallbackRelays,
    policy: {
      includeThread: true,
      includeEmbeds: true,
      includeInteractions: true,
      includeReplies: false,
      maxDepth: 2,
      maxEvents: 100,
      maxReferencesPerEvent: 12,
      timeoutMs: PROFILE_RESOLUTION_TIMEOUT_MS,
    },
    deadlineAtMs,
  });

  return selected.map((event) => ({
    event,
    referencedEvents: reachableGraphEvents({
      graph,
      rootEventId: event.id,
    }),
  }));
}
