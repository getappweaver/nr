import type { Monitoring } from '@src/core/monitoring';
import type {
  EventReferenceEdge,
  EventReferenceRole,
  ResolvedEventGraph,
} from '@src/nostr/event-resolution-types';
import type { NostrResolutionService } from '@src/nostr/resolution-service';

import {
  NostrEventSchema,
  type NostrEvent,
  type NrEvent,
  type NrProfileEvent,
} from './commands/shared/types';

type SeedEventWithHints = {
  event: NostrEvent;
  relayHints: string[];
};

type SeedNostrEventsProps = {
  service: NostrResolutionService;
  events: SeedEventWithHints[];
  monitoring: Monitoring | null;
};

type SeedNostrEventsOrThrowProps = Omit<SeedNostrEventsProps, 'monitoring'>;

type ResolveGraphTargetProps = {
  graph: ResolvedEventGraph;
  edge: EventReferenceEdge;
};

const LIST_CONTEXT_CACHE_TIMEOUT_MS = 500;
const LIST_CONTEXT_CACHE_BATCH_SIZE = 25;
const NR_SEED_BATCH_SIZE = 100;

function parseEvent(value: unknown): NostrEvent | null {
  const parsed = NostrEventSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

export function parseNostrEventArray(value: string): NostrEvent[] {
  try {
    const parsed = JSON.parse(value) as unknown;

    return Array.isArray(parsed)
      ? parsed.flatMap((entry) => {
          const event = parseEvent(entry);

          return event ? [event] : [];
        })
      : [];
  } catch {
    return [];
  }
}

function parseContextIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;

    return Array.isArray(parsed)
      ? [
          ...new Set(
            parsed.flatMap((entry) =>
              entry &&
              typeof entry === 'object' &&
              'id' in entry &&
              typeof (entry as { id?: unknown }).id === 'string'
                ? [(entry as { id: string }).id]
                : [],
            ),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}

function parseEventJson(value: string): NostrEvent | null {
  try {
    return parseEvent(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function addressKey(event: NostrEvent): string | null {
  if (
    event.kind !== 0 &&
    event.kind !== 3 &&
    !(event.kind >= 10_000 && event.kind < 20_000) &&
    !(event.kind >= 30_000 && event.kind < 40_000)
  ) {
    return null;
  }

  const identifier =
    event.kind >= 30_000 && event.kind < 40_000
      ? (event.tags.find((tag) => tag[0] === 'd')?.[1] ?? '')
      : '';

  return `${event.kind}:${event.pubkey}:${identifier}`;
}

function eventForEdge({
  graph,
  edge,
}: ResolveGraphTargetProps): NostrEvent | null {
  if (edge.target.type === 'event') {
    const eventId = edge.target.eventId;

    return graph.events.find((event) => event.id === eventId) ?? null;
  }

  const targetKey = `${edge.target.kind}:${edge.target.pubkey}:${edge.target.identifier}`;

  return graph.events.find((event) => addressKey(event) === targetKey) ?? null;
}

export async function seedNostrEvents({
  service,
  events,
  monitoring,
}: SeedNostrEventsProps): Promise<void> {
  const byId = new Map<string, SeedEventWithHints>();

  for (const input of events) {
    const existing = byId.get(input.event.id);

    byId.set(input.event.id, {
      event: input.event,
      relayHints: [
        ...new Set([...(existing?.relayHints ?? []), ...input.relayHints]),
      ],
    });
  }

  const unique = [...byId.values()];

  for (let index = 0; index < unique.length; index += NR_SEED_BATCH_SIZE) {
    try {
      const batch = unique.slice(index, index + NR_SEED_BATCH_SIZE);

      const seedBatch = () =>
        service.seedEvents({
          entries: batch.map((input) => ({
            event: input.event,
            relayHints: input.relayHints,
            lastCheckedAtMs: null,
          })),
        });

      if (monitoring?.currentContext()) {
        await monitoring.withSpan({
          name: 'nr.list.seed-batch',
          attributes: {
            batchIndex: Math.floor(index / NR_SEED_BATCH_SIZE),
            eventCount: batch.length,
          },
          parent: null,
          run: seedBatch,
        });
      } else {
        await seedBatch();
      }
    } catch {
      // NR remains durable and readable when disposable cache seeding fails.
    }
  }
}

export async function seedNostrEventsOrThrow({
  service,
  events,
}: SeedNostrEventsOrThrowProps): Promise<void> {
  const byId = new Map(events.map((input) => [input.event.id, input]));
  const unique = [...byId.values()];

  for (let index = 0; index < unique.length; index += NR_SEED_BATCH_SIZE) {
    const result = await service.seedEvents({
      entries: unique.slice(index, index + NR_SEED_BATCH_SIZE).map((input) => ({
        event: input.event,
        relayHints: input.relayHints,
        lastCheckedAtMs: null,
      })),
    });

    if (result.invalid > 0 || result.skipped > 0) {
      throw new Error('Failed to seed valid NR context into the shared cache.');
    }
  }
}

export async function seedStoredNrEvents({
  service,
  events,
  monitoring,
}: {
  service: NostrResolutionService;
  events: NrEvent[];
  monitoring: Monitoring;
}): Promise<void> {
  await seedNostrEvents({
    service,
    monitoring,
    events: events.flatMap((event) => {
      const root = parseEventJson(event.raw_json);

      return root ? [{ event: root, relayHints: event.relay_hints }] : [];
    }),
  });
}

export async function seedStoredProfileEvents({
  service,
  events,
}: {
  service: NostrResolutionService;
  events: NrProfileEvent[];
}): Promise<void> {
  await seedNostrEvents({
    service,
    monitoring: null,
    events: events.flatMap(({ event, referencedEvents }) => [
      { event, relayHints: [] },
      ...referencedEvents.map((reference) => ({
        event: reference,
        relayHints: [],
      })),
    ]),
  });
}

export async function hydrateStoredNrEvents({
  service,
  events,
  contextRelays,
  monitoring,
}: {
  service: NostrResolutionService;
  events: NrEvent[];
  contextRelays: string[];
  monitoring: Monitoring;
}): Promise<void> {
  const contextIds = [
    ...new Set(
      events.flatMap((event) => [
        ...parseContextIds(event.thread_context_json),
        ...parseContextIds(event.referenced_events_json),
      ]),
    ),
  ];

  const resolvedById = new Map<string, NostrEvent>();
  const deadlineAtMs = Date.now() + LIST_CONTEXT_CACHE_TIMEOUT_MS;

  for (
    let index = 0;
    index < contextIds.length && Date.now() < deadlineAtMs;
    index += LIST_CONTEXT_CACHE_BATCH_SIZE
  ) {
    const cacheOnlyDeadlineAtMs = Date.now();

    const batch = contextIds.slice(
      index,
      index + LIST_CONTEXT_CACHE_BATCH_SIZE,
    );

    const resolveBatch = () =>
      Promise.all(
        batch.map((eventId) =>
          service
            .resolveEventById({
              eventId,
              authorPubkey: null,
              relayHints: [],
              contextRelays,
              fallbackRelays: contextRelays,
              deadlineAtMs: cacheOnlyDeadlineAtMs,
            })
            .catch(() => null),
        ),
      );

    const results = monitoring.currentContext()
      ? await monitoring.withSpan({
          name: 'nr.list.hydrate-batch',
          attributes: {
            batchIndex: Math.floor(index / LIST_CONTEXT_CACHE_BATCH_SIZE),
            eventCount: batch.length,
          },
          parent: null,
          run: resolveBatch,
        })
      : await resolveBatch();

    for (const result of results) {
      if (result?.event) {
        resolvedById.set(result.event.id, result.event);
      }
    }
  }

  for (const stored of events) {
    stored.thread_context_json = JSON.stringify(
      parseContextIds(stored.thread_context_json).map(
        (id) => resolvedById.get(id) ?? { id },
      ),
    );

    stored.referenced_events_json = JSON.stringify(
      parseContextIds(stored.referenced_events_json).map(
        (id) => resolvedById.get(id) ?? { id },
      ),
    );
  }
}

export function directGraphEvents({
  graph,
  sourceEventId,
  roles,
}: {
  graph: ResolvedEventGraph;
  sourceEventId: string;
  roles: EventReferenceRole[];
}): NostrEvent[] {
  const seen = new Set<string>();

  return graph.edges.flatMap((edge) => {
    if (edge.sourceEventId !== sourceEventId || !roles.includes(edge.role)) {
      return [];
    }

    const event = eventForEdge({ graph, edge });

    if (!event || seen.has(event.id)) {
      return [];
    }

    seen.add(event.id);

    return [event];
  });
}

export function reachableGraphEvents({
  graph,
  rootEventId,
}: {
  graph: ResolvedEventGraph;
  rootEventId: string;
}): NostrEvent[] {
  const bySource = new Map<string, EventReferenceEdge[]>();

  for (const edge of graph.edges) {
    const edges = bySource.get(edge.sourceEventId) ?? [];

    edges.push(edge);
    bySource.set(edge.sourceEventId, edges);
  }

  const seen = new Set<string>([rootEventId]);
  const queue = [rootEventId];
  const events: NostrEvent[] = [];

  while (queue.length > 0) {
    const sourceEventId = queue.shift()!;

    for (const edge of bySource.get(sourceEventId) ?? []) {
      const event = eventForEdge({ graph, edge });

      if (!event || seen.has(event.id)) {
        continue;
      }

      seen.add(event.id);
      events.push(event);
      queue.push(event.id);
    }
  }

  return events;
}

export function hasDirectMissingReference({
  graph,
  sourceEventId,
  ignoredRoles,
}: {
  graph: ResolvedEventGraph;
  sourceEventId: string;
  ignoredRoles: EventReferenceRole[];
}): boolean {
  return graph.missing.some(
    ({ edge }) =>
      edge.sourceEventId === sourceEventId && !ignoredRoles.includes(edge.role),
  );
}
