import { createHash } from 'crypto';

import { parseRelayUrls } from '@src/env';
import { debug } from '@src/logger';
import { filterBlockedReadRelays } from '@src/nostr/relay-notices';

import { classifyEventWithNrAi } from '../../classifier-ai';
import {
  getNr,
  hasNrSkippedEvent,
  listNrFetchRelayCursors,
  parseAndStoreEvent,
  recordNrFetchWindow,
  recordNrSkippedEvent,
  saveNrFetchRelayCursor,
} from '../../db';
import {
  extractEventReferences,
  fetchTagReferencedEvents,
  fetchReferencedEvents,
} from '../../references';
import { getNrSettings } from '../../settings';
import {
  extractNip10References,
  fetchNip10ThreadContext,
} from '../../thread-context';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import { NR_FETCH_STATUS_TARGET_ID } from '../fetch-status';
import type {
  NostrEvent,
  NrAudienceReaction,
  NrEvent,
  NrFetchRelayCursor,
} from '../shared/types';
import { NostrEventSchema } from '../shared/types';

const BACKGROUND_COMMAND_STATUS_MARKER = '__WEB_COMMAND_STATUS__';

function reactionTargetId(event: NostrEvent): string | null {
  const targetTag = event.tags
    .filter((tag) => tag[0] === 'e' && tag[1]?.trim())
    .at(-1);

  return targetTag?.[1]?.trim() || null;
}

function needsNestedReferences(event: NrEvent): boolean {
  try {
    const referenced = JSON.parse(event.referenced_events_json) as NostrEvent[];
    const threadContext = JSON.parse(event.thread_context_json) as NostrEvent[];

    const referencedById = new Map(
      referenced.map((reference) => [reference.id, reference]),
    );

    const contentReferences = extractEventReferences(event.content)
      .map((reference) => referencedById.get(reference.id))
      .filter((reference): reference is NostrEvent => reference !== undefined);

    return [...threadContext, ...contentReferences].some((contextEvent) =>
      extractEventReferences(contextEvent.content).some(
        (reference) => !referencedById.has(reference.id),
      ),
    );
  } catch {
    return false;
  }
}

type SendFetchStatusProps = {
  params: NrCommandAdapterParams;
  message: string;
  output: string | null;
  progress: number | null;
};

type WithTimeoutProps<T> = {
  operation: Promise<T>;
  label: string;
  timeoutMs: number;
};

type RelayAuthorGroup = {
  relay: string;
  authors: string[];
};

type FetchRelayGroupPagesProps = {
  params: NrCommandAdapterParams;
  group: RelayAuthorGroup;
  since: number;
  until: number;
  limit: number;
  cursor: NrFetchRelayCursor | null;
  authorsHash: string;
};

type FetchRelayGroupPagesResult = {
  relay: string;
  events: NostrEvent[];
  completed: boolean;
  failed: boolean;
  error: string | null;
  pageCount: number;
};

type MapWithConcurrencyProps<T, R> = {
  items: T[];
  concurrency: number;
  map: (item: T) => Promise<R>;
};

const RELAY_FETCH_CONCURRENCY = 3;

async function sendFetchStatus({
  params,
  message,
  output,
  progress,
}: SendFetchStatusProps): Promise<void> {
  if (params.source !== 'web' || !params.sendReply) {
    return;
  }

  await params.sendReply(
    `${BACKGROUND_COMMAND_STATUS_MARKER}${JSON.stringify({
      id: NR_FETCH_STATUS_TARGET_ID,
      state: 'pending',
      message,
      output,
      progress,
    })}`,
  );
}

async function withTimeout<T>({
  operation,
  label,
  timeoutMs,
}: WithTimeoutProps<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function normalizedAuthors(authors: string[]): string[] {
  return [
    ...new Set(
      authors.map((author) => author.trim().toLowerCase()).filter(Boolean),
    ),
  ].sort();
}

function relayGroupAuthorsHash(authors: string[]): string {
  return createHash('sha256')
    .update(normalizedAuthors(authors).join(','))
    .digest('hex');
}

function relayCursorKey(relay: string, authorsHash: string): string {
  return `${relay}\u0000${authorsHash}`;
}

async function mapWithConcurrency<T, R>({
  items,
  concurrency,
  map,
}: MapWithConcurrencyProps<T, R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await map(items[index]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
}

async function fetchRelayGroupPages({
  params,
  group,
  since,
  until,
  limit,
  cursor,
  authorsHash,
}: FetchRelayGroupPagesProps): Promise<FetchRelayGroupPagesResult> {
  if (cursor?.completed) {
    return {
      relay: group.relay,
      events: [],
      completed: true,
      failed: false,
      error: null,
      pageCount: 0,
    };
  }

  const authors = normalizedAuthors(group.authors);
  let nextUntil = cursor?.nextUntil ?? until;
  let fetchedEventCount = cursor?.fetchedEventCount ?? 0;
  const events: NostrEvent[] = [];
  let pageCount = 0;

  while (nextUntil >= since) {
    const startedAt = Date.now();
    pageCount += 1;

    debug(
      `nr fetch-latest: querying ${group.relay} page ${pageCount} for ${authors.length} author(s), ${formatTimestamp(since)}→${formatTimestamp(nextUntil)}`,
    );

    try {
      const page = await withTimeout({
        operation: params.storedCtx.pool.querySync(
          [group.relay],
          {
            kinds: [1, 6, 7, 16, 1111],
            authors,
            since,
            until: nextUntil,
            limit,
          },
          { maxWait: 5_000 },
        ),
        label: `nr fetch-latest relay query ${group.relay}`,
        timeoutMs: 15_000,
      });

      const pageEvents = page.sort((a, b) => b.created_at - a.created_at);
      const oldestCreatedAt = pageEvents.at(-1)?.created_at ?? null;

      const completed =
        pageEvents.length < limit ||
        oldestCreatedAt === null ||
        oldestCreatedAt <= since;

      const nextCursorUntil =
        oldestCreatedAt === null || oldestCreatedAt <= since
          ? since
          : oldestCreatedAt - 1;

      events.push(...pageEvents);
      fetchedEventCount += pageEvents.length;
      nextUntil = completed ? since : nextCursorUntil;

      saveNrFetchRelayCursor({
        db: params.db,
        since,
        until,
        scope: 'follows',
        relay: group.relay,
        authorsHash,
        authors,
        nextUntil,
        completed,
        fetchedEventCount,
        lastError: null,
      });

      debug(
        `nr fetch-latest: ${group.relay} page ${pageCount} returned ${pageEvents.length} event(s) in ${Date.now() - startedAt}ms; ${completed ? 'complete' : `continuing from ${formatTimestamp(nextUntil)}`}`,
      );

      if (completed) {
        return {
          relay: group.relay,
          events,
          completed: true,
          failed: false,
          error: null,
          pageCount,
        };
      }
    } catch (error) {
      const message = errorMessage(error);

      saveNrFetchRelayCursor({
        db: params.db,
        since,
        until,
        scope: 'follows',
        relay: group.relay,
        authorsHash,
        authors,
        nextUntil,
        completed: false,
        fetchedEventCount,
        lastError: message,
      });

      debug(`nr fetch-latest relay query failed: ${group.relay}: ${message}`);

      return {
        relay: group.relay,
        events,
        completed: false,
        failed: true,
        error: message,
        pageCount,
      };
    }
  }

  return {
    relay: group.relay,
    events,
    completed: true,
    failed: false,
    error: null,
    pageCount,
  };
}

function integerOption(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);

    return Number.isFinite(parsed) ? Math.max(1, parsed) : fallback;
  }

  return fallback;
}

function optionalIntegerOption(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return integerOption(value, 1);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function adaptFetchLatestCommand(
  params: NrCommandAdapterParams,
): Promise<string> {
  void params.command;
  void params.source;
  void params.identity;

  const peopleLimit = optionalIntegerOption(params.parsed.options.people);
  const sinceHours = integerOption(params.parsed.options.since_hours, 1);
  const explicitSince = optionalIntegerOption(params.parsed.options.since);
  const explicitUntil = optionalIntegerOption(params.parsed.options.until);
  const limit = integerOption(params.parsed.options.limit, 50);
  const settings = getNrSettings(params.db);
  const oneOffInstructions = asString(params.parsed.options.instructions);
  const instructions = oneOffInstructions?.trim() || settings.instructions;

  const follows = await params.storedCtx.wot.getFollows(
    params.storedCtx.masterPubkey,
  );

  if (follows.length === 0) {
    return 'No follows are available. Try again after your kind 3 follows list is published on relays.';
  }

  const authors =
    peopleLimit === null ? follows : follows.slice(0, peopleLimit);

  const relayAuthorGroups = (
    await params.storedCtx.wot.getRelayAuthorMap(authors)
  ).filter((group) => filterBlockedReadRelays([group.relay]).length > 0);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const until = explicitUntil ?? nowSeconds;
  const since = explicitSince ?? until - sinceHours * 60 * 60;

  if (since >= until) {
    return `Invalid fetch window: --since (${since}) must be older than --until (${until}).`;
  }

  debug(
    `nr fetch-latest: starting fetch for ${authors.length}/${follows.length} follows across ${relayAuthorGroups.length} relay group(s); window=${formatTimestamp(since)}→${formatTimestamp(until)} limit=${limit}`,
  );

  await sendFetchStatus({
    params,
    message: 'Fetching Nostr posts…',
    output: '1. Fetching Nostr posts…',
    progress: null,
  });

  const cursorByGroup = new Map(
    listNrFetchRelayCursors({
      db: params.db,
      since,
      until,
      scope: 'follows',
    }).map((cursor) => [
      relayCursorKey(cursor.relay, cursor.authorsHash),
      cursor,
    ]),
  );

  const groups = relayAuthorGroups as RelayAuthorGroup[];

  const groupResults = await mapWithConcurrency({
    items: groups,
    concurrency: RELAY_FETCH_CONCURRENCY,
    map: async (group) => {
      const authorsHash = relayGroupAuthorsHash(group.authors);

      return fetchRelayGroupPages({
        params,
        group,
        since,
        until,
        limit,
        cursor:
          cursorByGroup.get(relayCursorKey(group.relay, authorsHash)) ?? null,
        authorsHash,
      });
    },
  });

  const failedRelayCount = groupResults.filter(
    (result) => result.failed,
  ).length;

  const incompleteRelayCount = groupResults.filter(
    (result) => !result.completed,
  ).length;

  const pageCount = groupResults.reduce(
    (total, result) => total + result.pageCount,
    0,
  );

  const eventRelayHints = new Map<string, string[]>();

  const rawEvents = groupResults.flatMap((result) => {
    for (const event of result.events) {
      eventRelayHints.set(event.id, [
        ...new Set([...(eventRelayHints.get(event.id) ?? []), result.relay]),
      ]);
    }

    return result.events;
  });

  const uniqueEvents = [
    ...new Map(rawEvents.map((event) => [event.id, event])).values(),
  ].sort((a, b) => b.created_at - a.created_at);

  const audienceReactionsByTarget = new Map<string, NrAudienceReaction[]>();

  for (const event of uniqueEvents) {
    if (event.kind !== 7) {
      continue;
    }

    const targetEventId = reactionTargetId(event);

    if (!targetEventId) {
      continue;
    }

    const reactions = audienceReactionsByTarget.get(targetEventId) ?? [];

    reactions.push({
      pubkey: event.pubkey,
      content: event.content,
      createdAt: event.created_at,
    });

    audienceReactionsByTarget.set(targetEventId, reactions);
  }

  await sendFetchStatus({
    params,
    message: `${uniqueEvents.length} posts are fetched.`,
    output: [
      '1. Fetched Nostr posts.',
      `2. ${uniqueEvents.length} posts are fetched.`,
    ].join('\n'),
    progress: 0,
  });

  let skippedCached = 0;
  let skippedPreviously = 0;
  let skippedByClassifier = 0;
  let invalid = 0;
  let stored = 0;
  let skippedRelated = 0;
  let deferredIncomplete = 0;
  let failedEvents = 0;
  let evaluatedByAi = 0;
  let evaluatedByFallback = 0;
  const eventErrors: string[] = [];
  const storedIds: string[] = [];

  const relatedEventIds = new Set(
    uniqueEvents.flatMap((event) => [
      ...extractNip10References(event).map((reference) => reference.id),
      ...extractEventReferences(event.content).map((reference) => reference.id),
    ]),
  );

  let evaluatedProgress = 0;

  for (const rawEvent of uniqueEvents) {
    evaluatedProgress += 1;
    const eventStartedAt = Date.now();

    await sendFetchStatus({
      params,
      message: `Evaluating posts (${evaluatedProgress}/${uniqueEvents.length})`,
      output: [
        '1. Fetched Nostr posts.',
        `2. ${uniqueEvents.length} posts are fetched.`,
        `3. Evaluating posts (${evaluatedProgress}/${uniqueEvents.length})`,
      ].join('\n'),
      progress:
        uniqueEvents.length > 0 ? evaluatedProgress / uniqueEvents.length : 1,
    });

    if (relatedEventIds.has(rawEvent.id)) {
      skippedRelated += 1;
      continue;
    }

    const cachedEvent = getNr(params.db, rawEvent.id);

    if (
      cachedEvent &&
      rawEvent.kind === 1 &&
      !needsNestedReferences(cachedEvent)
    ) {
      skippedCached += 1;
      continue;
    }

    if (hasNrSkippedEvent(params.db, rawEvent.id)) {
      skippedPreviously += 1;
      continue;
    }

    const parsed = NostrEventSchema.safeParse(rawEvent);

    if (!parsed.success) {
      invalid += 1;
      continue;
    }

    try {
      const relayHints = eventRelayHints.get(parsed.data.id) ?? [];

      await sendFetchStatus({
        params,
        message: `Loading context (${evaluatedProgress}/${uniqueEvents.length})`,
        output: [
          '1. Fetched Nostr posts.',
          `2. ${uniqueEvents.length} posts are fetched.`,
          `3. Loading context (${evaluatedProgress}/${uniqueEvents.length})`,
        ].join('\n'),
        progress:
          uniqueEvents.length > 0 ? evaluatedProgress / uniqueEvents.length : 1,
      });

      const contextStartedAt = Date.now();

      const contextRelays = [
        ...relayHints,
        ...parseRelayUrls(process.env.BOT_RELAYS ?? ''),
      ];

      const threadContextResult = await fetchNip10ThreadContext({
        pool: params.storedCtx.pool,
        event: parsed.data,
        fallbackRelays: contextRelays,
      });

      const referencedEventsResult = await fetchReferencedEvents({
        pool: params.storedCtx.pool,
        content: parsed.data.content,
        fallbackRelays: contextRelays,
      });

      const tagReferencedEventsResult = await fetchTagReferencedEvents({
        pool: params.storedCtx.pool,
        event: parsed.data,
        fallbackRelays: contextRelays,
      });

      let embeddedRepost: NostrEvent | null = null;

      if (parsed.data.kind === 6) {
        try {
          const embedded = NostrEventSchema.safeParse(
            JSON.parse(parsed.data.content),
          );

          embeddedRepost = embedded.success ? embedded.data : null;
        } catch {
          embeddedRepost = null;
        }
      }

      const directlyReferencedEvents = [
        ...new Map(
          [
            ...referencedEventsResult.events,
            ...tagReferencedEventsResult.events,
            ...(embeddedRepost ? [embeddedRepost] : []),
          ].map((event) => [event.id, event]),
        ).values(),
      ];

      const activityTarget =
        parsed.data.kind === 6 ||
        parsed.data.kind === 7 ||
        parsed.data.kind === 16
          ? directlyReferencedEvents[0]
          : null;

      const nestedSources = activityTarget
        ? [activityTarget]
        : [
            ...new Map(
              [
                ...threadContextResult.events,
                ...referencedEventsResult.events,
              ].map((event) => [event.id, event]),
            ).values(),
          ].slice(0, 5);

      const nestedResults = await Promise.all(
        nestedSources.map(async (nestedSource) =>
          Promise.all([
            fetchReferencedEvents({
              pool: params.storedCtx.pool,
              content: nestedSource.content,
              fallbackRelays: contextRelays,
            }),
            fetchNip10ThreadContext({
              pool: params.storedCtx.pool,
              event: nestedSource,
              fallbackRelays: contextRelays,
            }),
          ]),
        ),
      );

      const referencedEvents = [
        ...new Map(
          [
            ...directlyReferencedEvents,
            ...nestedResults.flatMap(
              ([nestedContentResult, nestedThreadResult]) => [
                ...nestedContentResult.events,
                ...nestedThreadResult.events,
              ],
            ),
          ].map((event) => [event.id, event]),
        ).values(),
      ];

      debug(
        `nr fetch-latest: loaded context for ${parsed.data.id} in ${Date.now() - contextStartedAt}ms; thread=${threadContextResult.events.length}/${threadContextResult.references.length}, references=${referencedEventsResult.events.length}/${referencedEventsResult.references.length}`,
      );

      if (
        threadContextResult.missingIds.length > 0 ||
        referencedEventsResult.missingIds.length > 0 ||
        tagReferencedEventsResult.missingIds.length > 0
      ) {
        deferredIncomplete += 1;

        debug(
          `nr fetch-latest: deferred ${parsed.data.id}; missing thread=${threadContextResult.missingIds.join(',') || '(none)'} references=${referencedEventsResult.missingIds.join(',') || '(none)'}`,
        );

        continue;
      }

      await sendFetchStatus({
        params,
        message: `Classifying posts (${evaluatedProgress}/${uniqueEvents.length})`,
        output: [
          '1. Fetched Nostr posts.',
          `2. ${uniqueEvents.length} posts are fetched.`,
          `3. Classifying posts (${evaluatedProgress}/${uniqueEvents.length})`,
        ].join('\n'),
        progress:
          uniqueEvents.length > 0 ? evaluatedProgress / uniqueEvents.length : 1,
      });

      const classificationStartedAt = Date.now();

      const classificationEvent =
        parsed.data.kind === 6 ||
        parsed.data.kind === 7 ||
        parsed.data.kind === 16
          ? referencedEvents[0]
          : parsed.data;

      const classification = classificationEvent
        ? await classifyEventWithNrAi({
            db: params.db,
            event: classificationEvent,
            instructions,
            threadContextEvents: threadContextResult.events,
            referencedEvents,
            audienceReactions:
              audienceReactionsByTarget.get(classificationEvent.id) ?? [],
            storedCtx: params.storedCtx,
            runAgent: params.runAgent,
          })
        : {
            topics: [],
            moods: [],
            summary: '',
            model: 'activity',
            confidence: 1,
            skip: false,
            skipReason: null,
          };

      debug(
        `nr fetch-latest: classified ${parsed.data.id} in ${Date.now() - classificationStartedAt}ms with ${classification.model}`,
      );

      if (classification.model.includes(':fallback')) {
        evaluatedByFallback += 1;
      } else {
        evaluatedByAi += 1;
      }

      if (classification.skip) {
        recordNrSkippedEvent({
          db: params.db,
          event: parsed.data,
          classification,
        });

        skippedByClassifier += 1;
        continue;
      }

      if (parsed.data.kind === 7 && classificationEvent) {
        const cachedTarget = getNr(params.db, classificationEvent.id);

        if (cachedTarget) {
          await parseAndStoreEvent({
            db: params.db,
            event: classificationEvent,
            forceReclassify: true,
            relayHints: cachedTarget.relay_hints,
            threadContext: JSON.parse(
              cachedTarget.thread_context_json,
            ) as NostrEvent[],
            referencedEvents: JSON.parse(
              cachedTarget.referenced_events_json,
            ) as NostrEvent[],
            classify: () => classification,
          });
        }
      }

      const result = await parseAndStoreEvent({
        db: params.db,
        event: parsed.data,
        forceReclassify: parsed.data.kind !== 1,
        relayHints,
        threadContext: threadContextResult.events,
        referencedEvents,
        classify: () => classification,
      });

      stored += result.inserted ? 1 : 0;
      storedIds.push(result.event.id);

      debug(
        `nr fetch-latest: processed ${parsed.data.id} in ${Date.now() - eventStartedAt}ms; stored=${result.inserted}`,
      );
    } catch (error) {
      failedEvents += 1;
      eventErrors.push(`${parsed.data.id}: ${errorMessage(error)}`);

      debug(
        `nr fetch-latest: failed to process ${parsed.data.id}: ${errorMessage(error)}`,
      );
    }
  }

  const status =
    failedRelayCount === relayAuthorGroups.length &&
    relayAuthorGroups.length > 0
      ? 'failed'
      : incompleteRelayCount > 0 || failedEvents > 0
        ? 'partial'
        : 'fetched';

  const errors = [
    failedRelayCount > 0
      ? `${failedRelayCount}/${relayAuthorGroups.length} relay group(s) failed`
      : null,
    incompleteRelayCount > 0
      ? `${incompleteRelayCount}/${relayAuthorGroups.length} relay group(s) remain resumable`
      : null,
    failedEvents > 0 ? `${failedEvents} event(s) failed processing` : null,
    ...groupResults
      .filter((result) => result.error !== null)
      .slice(0, 3)
      .map((result) => `${result.relay}: ${result.error}`),
  ].filter((item): item is string => item !== null);

  recordNrFetchWindow({
    db: params.db,
    since,
    until,
    scope: 'follows',
    status,
    eventCount: stored,
    relayCount: relayAuthorGroups.length,
    authorCount: authors.length,
    error: errors.length > 0 ? errors.join('; ') : null,
  });

  return [
    explicitSince === null && explicitUntil === null
      ? 'Fetched latest notes from follows.'
      : 'Fetched notes from follows.',
    `Summary: ${stored} stored, ${skippedByClassifier + skippedCached + skippedPreviously + skippedRelated + deferredIncomplete + invalid} skipped/deferred, ${failedEvents} failed, ${evaluatedByAi} evaluated by AI${evaluatedByFallback > 0 ? `, ${evaluatedByFallback} fallback-classified` : ''}.`,
    `Authors used: ${authors.length}/${follows.length}`,
    `Window: ${formatTimestamp(since)} → ${formatTimestamp(until)}`,
    explicitSince === null ? `Since hours: ${sinceHours}` : null,
    `Relay groups: ${relayAuthorGroups.length}`,
    `Relay pages queried: ${pageCount}`,
    `Failed relay groups: ${failedRelayCount}`,
    `Incomplete relay groups: ${incompleteRelayCount}`,
    `Fetch coverage status: ${status}`,
    `Events returned: ${rawEvents.length}`,
    `Unique events considered: ${uniqueEvents.length}`,
    `Skipped related/context events: ${skippedRelated}`,
    `Skipped cached: ${skippedCached}`,
    `Skipped previously: ${skippedPreviously}`,
    `Skipped by classifier: ${skippedByClassifier}`,
    `Invalid events: ${invalid}`,
    `Deferred incomplete context: ${deferredIncomplete}`,
    `Failed event processing: ${failedEvents}`,
    `Evaluated by AI: ${evaluatedByAi}`,
    `Evaluated by fallback: ${evaluatedByFallback}`,
    ...eventErrors.slice(0, 5).map((error) => `Event error: ${error}`),
    eventErrors.length > 5
      ? `Event errors omitted: ${eventErrors.length - 5}`
      : null,
    `Stored/evaluated: ${stored}`,
    storedIds.length > 0
      ? `New IDs: ${storedIds.join(', ')}`
      : 'New IDs: (none)',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
