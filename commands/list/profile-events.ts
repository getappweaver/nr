import {
  fetchNip65WriteRelays,
  PROFILE_RELAYS_FOR_QUERY,
  uniqueRelays,
} from '@src/nostr/nip65';

import { fetchReferencedEvents } from '../../references';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import {
  NostrEventSchema,
  type NostrEvent,
  type NrProfileEvent,
} from '../shared/types';

import {
  categoryForNrEvent,
  kindsForNrFeedCategories,
  type NrFeedCategory,
} from './categories';

const PAGE_LIMIT = 20;
const MAX_EVENTS = 50;

export async function fetchNrProfileEvents({
  params,
  categories,
  cachedEvents,
}: {
  params: NrCommandAdapterParams;
  categories: NrFeedCategory[];
  cachedEvents: NrProfileEvent[];
}): Promise<NrProfileEvent[]> {
  const relays = await fetchNip65WriteRelays({
    pool: params.storedCtx.pool,
    authorPubkey: params.storedCtx.masterPubkey,
  });

  const kinds = kindsForNrFeedCategories(categories);
  const events = new Map(cachedEvents.map(({ event }) => [event.id, event]));

  const latestCachedCreatedAt = Math.max(
    0,
    ...cachedEvents.map(({ event }) => event.created_at),
  );

  let until = Math.floor(Date.now() / 1000);
  let queried = false;

  while (!queried || events.size < MAX_EVENTS) {
    const page = await params.storedCtx.pool.querySync(
      relays,
      {
        authors: [params.storedCtx.masterPubkey],
        kinds,
        ...(latestCachedCreatedAt > 0
          ? { since: latestCachedCreatedAt + 1 }
          : {}),
        until,
        limit: PAGE_LIMIT,
      },
      { maxWait: 10_000 },
    );

    const valid = page
      .map((event) => NostrEventSchema.safeParse(event))
      .filter((result) => result.success)
      .map((result) => result.data)
      .sort((a, b) => b.created_at - a.created_at);

    queried = true;

    for (const event of valid) {
      if (
        categoryForNrEvent(event) &&
        categories.includes(categoryForNrEvent(event)!)
      ) {
        events.set(event.id, event);
      }
    }

    const oldest = valid.at(-1);

    if (valid.length < PAGE_LIMIT || !oldest) {
      break;
    }

    until = oldest.created_at - 1;
  }

  const selected = [...events.values()]
    .filter((event) => {
      const category = categoryForNrEvent(event);

      return category !== null && categories.includes(category);
    })
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, MAX_EVENTS);

  const referenceIds = [
    ...new Set(
      selected.flatMap((event) =>
        event.tags
          .filter((tag) => (tag[0] === 'e' || tag[0] === 'q') && tag[1]?.trim())
          .map((tag) => tag[1]!.trim()),
      ),
    ),
  ];

  const referenced = referenceIds.length
    ? await params.storedCtx.pool.querySync(
        uniqueRelays([...relays, ...PROFILE_RELAYS_FOR_QUERY]),
        { ids: referenceIds, limit: referenceIds.length },
        { maxWait: 10_000 },
      )
    : [];

  const referencesById = new Map<string, NostrEvent>(
    referenced
      .map((event) => NostrEventSchema.safeParse(event))
      .filter((result) => result.success)
      .map((result) => [result.data.id, result.data] as const),
  );

  const contentReferences = await Promise.all(
    selected.map((event) =>
      fetchReferencedEvents({
        pool: params.storedCtx.pool,
        content: event.content,
        fallbackRelays: relays,
      }),
    ),
  );

  for (const result of contentReferences) {
    for (const event of result.events) {
      referencesById.set(event.id, event);
    }
  }

  const directReferencesByEvent = new Map(
    selected.map((event, index) => {
      const ids = new Set([
        ...event.tags
          .filter((tag) => (tag[0] === 'e' || tag[0] === 'q') && tag[1]?.trim())
          .map((tag) => tag[1]!.trim()),
        ...contentReferences[index]!.references.map(
          (reference) => reference.id,
        ),
      ]);

      return [
        event.id,
        [...ids]
          .map((id) => referencesById.get(id))
          .filter(
            (reference): reference is NostrEvent => reference !== undefined,
          ),
      ] as const;
    }),
  );

  const nestedSources = [
    ...new Map(
      [...directReferencesByEvent.values()]
        .flat()
        .map((event) => [event.id, event]),
    ).values(),
  ];

  const nestedResults = await Promise.all(
    nestedSources.map((event) =>
      fetchReferencedEvents({
        pool: params.storedCtx.pool,
        content: event.content,
        fallbackRelays: relays,
      }),
    ),
  );

  const nestedReferencesBySource = new Map(
    nestedSources.map((event, index) => [
      event.id,
      nestedResults[index]!.events,
    ]),
  );

  return selected.map((event) => ({
    event,
    referencedEvents: [
      ...new Map(
        (directReferencesByEvent.get(event.id) ?? [])
          .flatMap((reference) => [
            reference,
            ...(nestedReferencesBySource.get(reference.id) ?? []),
          ])
          .map((reference) => [reference.id, reference]),
      ).values(),
    ],
  }));
}
