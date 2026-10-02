import { createHash } from 'crypto';

import type { Database } from 'bun:sqlite';

import { parseRelayUrls } from '@src/env';
import { debug } from '@src/logger';
import { filterBlockedReadRelays } from '@src/nostr/relay-notices';

import { classifyEventWithNrAi } from '../../classifier-ai';
import {
  getNr,
  hasNrSkippedEvent,
  listNrFetchRelayCursors,
  claimNrEvaluation,
  completeNrEvaluation,
  enqueueNrEvaluation,
  failNrEvaluation,
  parseAndStoreEvent,
  recordNrFetchWindow,
  recordNrSkippedEvent,
  recoverNrEvaluationQueue,
  saveNrFetchRelayCursor,
} from '../../db';
import {
  directGraphEvents,
  hasDirectMissingReference,
  parseNostrEventArray,
  reachableGraphEvents,
} from '../../nostr-resolution';
import { extractEventReferences } from '../../references';
import { getNrSettings } from '../../settings';
import { extractNip10References } from '../../thread-context';
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
    const referenced = parseNostrEventArray(event.referenced_events_json);
    const threadContext = parseNostrEventArray(event.thread_context_json);

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
  params: FetchRuntimeParams;
  message: string;
  output: string | null;
  progress: number | null;
};

type WithTimeoutProps<T> = {
  operation: Promise<T>;
  label: string;
  timeoutMs: number;
  abortController: AbortController | null;
};

type RelayAuthorGroup = {
  relay: string;
  authors: string[];
};

type FetchRelayGroupPagesProps = {
  params: FetchRuntimeParams;
  group: RelayAuthorGroup;
  since: number;
  until: number;
  limit: number;
  cursor: NrFetchRelayCursor | null;
  authorsHash: string;
  onPageEvents: (relay: string, events: NostrEvent[]) => void;
};

type FetchRelayGroupPagesResult = {
  relay: string;
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

type FetchRuntimeParams = Pick<
  NrCommandAdapterParams,
  'db' | 'source' | 'agent' | 'sendReply' | 'storedCtx'
>;

type FetchEvaluateProps = {
  params: FetchRuntimeParams;
  peopleLimit: number | null;
  sinceHours: number;
  explicitSince: number | null;
  explicitUntil: number | null;
  limit: number;
  oneOffInstructions: string | null;
  waitForRelayListRefresh: boolean;
};

type SendFetchCompletionNotificationProps = {
  params: Pick<FetchRuntimeParams, 'source' | 'storedCtx'>;
  result: string;
};

type FetchLockRow = {
  owner_pid: number;
};

const CLASSIFICATION_TIMEOUT_MS = 120_000;
const FETCH_LOCK_NAME = 'fetch-evaluate';

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

function acquireFetchLock(db: Database): () => void {
  db.run(`
    CREATE TABLE IF NOT EXISTS nr_operation_locks (
      name TEXT PRIMARY KEY,
      owner_pid INTEGER NOT NULL,
      acquired_at INTEGER NOT NULL
    )
  `);

  const insert = db.prepare(
    `INSERT OR IGNORE INTO nr_operation_locks (name, owner_pid, acquired_at)
     VALUES (?, ?, ?)`,
  );

  let result = insert.run(FETCH_LOCK_NAME, process.pid, Date.now());

  if (result.changes === 0) {
    const existing = db
      .prepare('SELECT owner_pid FROM nr_operation_locks WHERE name = ?')
      .get(FETCH_LOCK_NAME) as FetchLockRow | null;

    if (existing && isProcessRunning(existing.owner_pid)) {
      throw new Error(
        `A Nostr Radar fetch is already running (PID ${existing.owner_pid}). Wait for it to finish; do not retry.`,
      );
    }

    db.prepare(
      'DELETE FROM nr_operation_locks WHERE name = ? AND owner_pid = ?',
    ).run(FETCH_LOCK_NAME, existing?.owner_pid ?? -1);

    result = insert.run(FETCH_LOCK_NAME, process.pid, Date.now());

    if (result.changes === 0) {
      throw new Error(
        'Another Nostr Radar fetch started concurrently. Wait for it to finish; do not retry.',
      );
    }
  }

  return () => {
    try {
      db.prepare(
        'DELETE FROM nr_operation_locks WHERE name = ? AND owner_pid = ?',
      ).run(FETCH_LOCK_NAME, process.pid);
    } catch (error) {
      debug(
        `nr fetch-latest: failed to release fetch lock: ${errorMessage(error)}`,
      );
    }
  };
}

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
  abortController,
}: WithTimeoutProps<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          abortController?.abort();
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
  onPageEvents,
}: FetchRelayGroupPagesProps): Promise<FetchRelayGroupPagesResult> {
  if (cursor?.completed) {
    return {
      relay: group.relay,
      completed: true,
      failed: false,
      error: null,
      pageCount: 0,
    };
  }

  const authors = normalizedAuthors(group.authors);
  let nextUntil = cursor?.nextUntil ?? until;
  let fetchedEventCount = cursor?.fetchedEventCount ?? 0;
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
            kinds: [1, 6, 7, 16, 1111, 9802, 30023, 9735],
            authors,
            since,
            until: nextUntil,
            limit,
          },
          { maxWait: 5_000 },
        ),
        label: `nr fetch-latest relay query ${group.relay}`,
        timeoutMs: 15_000,
        abortController: null,
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

      onPageEvents(group.relay, pageEvents);
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
        completed: false,
        failed: true,
        error: message,
        pageCount,
      };
    }
  }

  return {
    relay: group.relay,
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

export async function sendFetchCompletionNotification({
  params,
  result,
}: SendFetchCompletionNotificationProps): Promise<void> {
  try {
    await params.storedCtx.sendWebPush({
      title: 'Nostr Radar fetch finished',
      body: result.split('\n').slice(0, 2).join('\n'),
      url: '/?command=nr&subcommand=list',
    });
  } catch (error) {
    debug(
      `nr fetch-latest: completion Web Push failed: ${errorMessage(error)}`,
    );
  }
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
  const oneOffInstructions = asString(params.parsed.options.instructions);

  return fetchEvaluate({
    params,
    peopleLimit,
    sinceHours,
    explicitSince,
    explicitUntil,
    limit,
    oneOffInstructions,
    waitForRelayListRefresh: false,
  });
}

export async function fetchEvaluate(
  props: FetchEvaluateProps,
): Promise<string> {
  const releaseLock = acquireFetchLock(props.params.db);

  try {
    const result = await runFetchEvaluate(props);

    await sendFetchCompletionNotification({ params: props.params, result });

    return result;
  } finally {
    releaseLock();
  }
}

async function runFetchEvaluate({
  params,
  peopleLimit,
  sinceHours,
  explicitSince,
  explicitUntil,
  limit,
  oneOffInstructions,
  waitForRelayListRefresh,
}: FetchEvaluateProps): Promise<string> {
  const settings = getNrSettings(params.db);
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
  const eventRelayHints = new Map<string, string[]>();
  const audienceReactionsByTarget = new Map<string, NrAudienceReaction[]>();
  const relatedEventIds = new Set<string>();
  const fetchedEventIds = new Set<string>();
  let rawEventCount = 0;
  let skippedCached = 0;
  let skippedPreviously = 0;
  let skippedByClassifier = 0;
  let invalid = 0;
  let stored = 0;
  let skippedRelated = 0;
  let deferredIncomplete = 0;
  let failedEvents = 0;
  let evaluatedByJev = 0;
  let evaluatedByLlm = 0;
  let evaluatedByFallback = 0;
  let evaluatedProgress = 0;
  const eventErrors: string[] = [];
  const storedIds: string[] = [];
  let fetching = true;

  recoverNrEvaluationQueue({
    db: params.db,
    staleBeforeMs: Date.now() - CLASSIFICATION_TIMEOUT_MS,
  });

  const workers = Array.from({ length: settings.aiEvaluationConcurrency }, () =>
    consumeEvaluationQueue(),
  );

  const groupResults = await mapWithConcurrency({
    items: groups,
    concurrency: settings.relayFetchConcurrency,
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
        onPageEvents: (relay, events) => {
          rawEventCount += events.length;

          for (const event of events) {
            fetchedEventIds.add(event.id);

            const relayHints = [
              ...new Set([...(eventRelayHints.get(event.id) ?? []), relay]),
            ];

            eventRelayHints.set(event.id, relayHints);
            enqueueNrEvaluation({ db: params.db, event, relayHints });

            for (const reference of [
              ...extractNip10References(event),
              ...extractEventReferences(event.content),
            ]) {
              relatedEventIds.add(reference.id);
            }

            if (event.kind === 7) {
              const targetEventId = reactionTargetId(event);

              if (targetEventId) {
                const reactions =
                  audienceReactionsByTarget.get(targetEventId) ?? [];

                reactions.push({
                  pubkey: event.pubkey,
                  content: event.content,
                  createdAt: event.created_at,
                });

                audienceReactionsByTarget.set(targetEventId, reactions);
              }
            }
          }
        },
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

  fetching = false;
  await Promise.all(workers);

  await sendFetchStatus({
    params,
    message: `${fetchedEventIds.size} posts are fetched.`,
    output: [
      '1. Fetched Nostr posts.',
      `2. ${fetchedEventIds.size} posts are fetched.`,
    ].join('\n'),
    progress: 0,
  });

  async function consumeEvaluationQueue(): Promise<void> {
    while (true) {
      const queued = claimNrEvaluation(params.db);

      if (!queued) {
        if (!fetching) {
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      const rawEvent = queued.event;
      evaluatedProgress += 1;
      const eventStartedAt = Date.now();

      await sendFetchStatus({
        params,
        message: `Evaluating posts (${evaluatedProgress}/${fetchedEventIds.size})`,
        output: [
          '1. Fetched Nostr posts.',
          `2. ${fetchedEventIds.size} posts are fetched.`,
          `3. Evaluating posts (${evaluatedProgress}/${fetchedEventIds.size})`,
        ].join('\n'),
        progress:
          fetchedEventIds.size > 0
            ? evaluatedProgress / fetchedEventIds.size
            : 1,
      });

      if (relatedEventIds.has(rawEvent.id)) {
        skippedRelated += 1;

        completeNrEvaluation({
          db: params.db,
          eventId: queued.eventId,
          error: null,
        });

        continue;
      }

      const cachedEvent = getNr(params.db, rawEvent.id);

      if (
        cachedEvent &&
        rawEvent.kind === 1 &&
        !needsNestedReferences(cachedEvent)
      ) {
        skippedCached += 1;

        completeNrEvaluation({
          db: params.db,
          eventId: queued.eventId,
          error: null,
        });

        continue;
      }

      if (hasNrSkippedEvent(params.db, rawEvent.id)) {
        skippedPreviously += 1;

        completeNrEvaluation({
          db: params.db,
          eventId: queued.eventId,
          error: null,
        });

        continue;
      }

      const parsed = NostrEventSchema.safeParse(rawEvent);

      if (!parsed.success) {
        invalid += 1;

        completeNrEvaluation({
          db: params.db,
          eventId: queued.eventId,
          error: 'Invalid Nostr event.',
        });

        continue;
      }

      try {
        const relayHints = queued.relayHints;

        await sendFetchStatus({
          params,
          message: `Loading context (${evaluatedProgress}/${fetchedEventIds.size})`,
          output: [
            '1. Fetched Nostr posts.',
            `2. ${fetchedEventIds.size} posts are fetched.`,
            `3. Loading context (${evaluatedProgress}/${fetchedEventIds.size})`,
          ].join('\n'),
          progress:
            fetchedEventIds.size > 0
              ? evaluatedProgress / fetchedEventIds.size
              : 1,
        });

        const contextStartedAt = Date.now();

        const contextRelays = [
          ...relayHints,
          ...parseRelayUrls(process.env.BOT_RELAYS ?? ''),
        ];

        const graph = await params.storedCtx.nostrResolution.resolveGraph({
          rootEvents: [parsed.data],
          contextRelays,
          fallbackRelays: contextRelays,
          policy: {
            includeThread: true,
            includeEmbeds: true,
            includeInteractions: true,
            includeReplies: false,
            maxDepth: 2,
            maxEvents: 32,
            maxReferencesPerEvent: 12,
            timeoutMs: 8_000,
          },
          deadlineAtMs: Date.now() + 8_000,
        });

        const threadContext = directGraphEvents({
          graph,
          sourceEventId: parsed.data.id,
          roles: ['thread-root', 'thread-parent'],
        });

        const directActivityTarget = directGraphEvents({
          graph,
          sourceEventId: parsed.data.id,
          roles: ['repost-target', 'reaction-target', 'zap-target'],
        })[0];

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

        const activityTarget = directActivityTarget ?? embeddedRepost;
        const threadIds = new Set(threadContext.map((event) => event.id));

        const referencedEvents = [
          ...new Map(
            [
              ...reachableGraphEvents({
                graph,
                rootEventId: parsed.data.id,
              }).filter((event) => !threadIds.has(event.id)),
              ...(embeddedRepost ? [embeddedRepost] : []),
            ].map((event) => [event.id, event]),
          ).values(),
        ];

        const directMissing = hasDirectMissingReference({
          graph,
          sourceEventId: parsed.data.id,
          ignoredRoles: embeddedRepost ? ['repost-target'] : [],
        });

        debug(
          `nr fetch-latest: loaded graph context for ${parsed.data.id} in ${Date.now() - contextStartedAt}ms; thread=${threadContext.length}, references=${referencedEvents.length}`,
        );

        if (directMissing) {
          deferredIncomplete += 1;

          debug(
            `nr fetch-latest: deferred ${parsed.data.id}; direct graph reference missing`,
          );

          failNrEvaluation({
            db: params.db,
            eventId: queued.eventId,
            error: 'Deferred because a direct graph reference is missing.',
          });

          continue;
        }

        await sendFetchStatus({
          params,
          message: `Classifying posts (${evaluatedProgress}/${fetchedEventIds.size})`,
          output: [
            '1. Fetched Nostr posts.',
            `2. ${fetchedEventIds.size} posts are fetched.`,
            `3. Classifying posts (${evaluatedProgress}/${fetchedEventIds.size})`,
          ].join('\n'),
          progress:
            fetchedEventIds.size > 0
              ? evaluatedProgress / fetchedEventIds.size
              : 1,
        });

        const classificationStartedAt = Date.now();

        const classificationEvent =
          parsed.data.kind === 6 ||
          parsed.data.kind === 7 ||
          parsed.data.kind === 16 ||
          parsed.data.kind === 9735
            ? activityTarget
            : parsed.data;

        const classificationAbortController = new AbortController();

        const classification = classificationEvent
          ? await withTimeout({
              operation: classifyEventWithNrAi({
                db: params.db,
                event: classificationEvent,
                instructions,
                threadContextEvents: threadContext,
                referencedEvents,
                audienceReactions:
                  audienceReactionsByTarget.get(classificationEvent.id) ?? [],
                storedCtx: params.storedCtx,
                agent: params.agent,
                abortSignal: classificationAbortController.signal,
              }),
              label: `nr classification ${parsed.data.id}`,
              timeoutMs: CLASSIFICATION_TIMEOUT_MS,
              abortController: classificationAbortController,
            })
          : {
              topics: [],
              moods: [],
              summary: '',
              language: 'und',
              model: 'activity',
              confidence: 1,
              skip: false,
              skipReason: null,
            };

        debug(
          `nr fetch-latest: classified ${parsed.data.id} in ${Date.now() - classificationStartedAt}ms using ${classification.evaluationMode === 'classifier' ? 'Jev' : classification.model === 'activity' ? 'activity metadata' : 'LLM'} (${classification.model})`,
        );

        if (classificationEvent && classification.model.includes(':fallback')) {
          evaluatedByFallback += 1;
        } else if (
          classificationEvent &&
          classification.evaluationMode === 'classifier'
        ) {
          evaluatedByJev += 1;
        } else if (classificationEvent) {
          evaluatedByLlm += 1;
        }

        if (classification.skip) {
          recordNrSkippedEvent({
            db: params.db,
            event: parsed.data,
            classification,
          });

          skippedByClassifier += 1;

          completeNrEvaluation({
            db: params.db,
            eventId: queued.eventId,
            error: null,
          });

          continue;
        }

        if (
          (parsed.data.kind === 7 || parsed.data.kind === 9735) &&
          classificationEvent
        ) {
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
              nostrResolution: params.storedCtx.nostrResolution,
              classify: () => classification,
            });
          }
        }

        const result = await parseAndStoreEvent({
          db: params.db,
          event: parsed.data,
          forceReclassify: parsed.data.kind !== 1,
          relayHints,
          threadContext,
          referencedEvents,
          nostrResolution: params.storedCtx.nostrResolution,
          classify: () => classification,
        });

        stored += result.inserted ? 1 : 0;
        storedIds.push(result.event.id);

        debug(
          `nr fetch-latest: processed ${parsed.data.id} in ${Date.now() - eventStartedAt}ms; stored=${result.inserted}`,
        );

        completeNrEvaluation({
          db: params.db,
          eventId: queued.eventId,
          error: null,
        });
      } catch (error) {
        failedEvents += 1;
        const message = errorMessage(error);
        eventErrors.push(`${parsed.data.id}: ${message}`);

        failNrEvaluation({
          db: params.db,
          eventId: queued.eventId,
          error: message,
        });

        debug(
          `nr fetch-latest: failed to process ${parsed.data.id}: ${errorMessage(error)}`,
        );
      }
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

  const relayListRefresh = params.storedCtx.wot
    .refreshRelayLists?.(authors)
    .catch((error) => {
      debug(
        `nr fetch-latest: background relay-list refresh failed: ${errorMessage(error)}`,
      );
    });

  if (waitForRelayListRefresh) {
    await relayListRefresh;
  } else {
    void relayListRefresh;
  }

  return [
    explicitSince === null && explicitUntil === null
      ? 'Fetched latest notes from follows.'
      : 'Fetched notes from follows.',
    `Summary: ${stored} stored, ${skippedByClassifier + skippedCached + skippedPreviously + skippedRelated + deferredIncomplete + invalid} skipped/deferred, ${failedEvents} failed, ${evaluatedByJev} evaluated by Jev, ${evaluatedByLlm} evaluated by LLM${evaluatedByFallback > 0 ? `, ${evaluatedByFallback} fallback-classified` : ''}.`,
    `Authors used: ${authors.length}/${follows.length}`,
    `Window: ${formatTimestamp(since)} → ${formatTimestamp(until)}`,
    explicitSince === null ? `Since hours: ${sinceHours}` : null,
    `Relay groups: ${relayAuthorGroups.length}`,
    `Relay pages queried: ${pageCount}`,
    `Failed relay groups: ${failedRelayCount}`,
    `Incomplete relay groups: ${incompleteRelayCount}`,
    `Fetch coverage status: ${status}`,
    `Events returned: ${rawEventCount}`,
    `Unique events considered: ${fetchedEventIds.size}`,
    `Skipped related/context events: ${skippedRelated}`,
    `Skipped cached: ${skippedCached}`,
    `Skipped previously: ${skippedPreviously}`,
    `Skipped by classifier: ${skippedByClassifier}`,
    `Invalid events: ${invalid}`,
    `Deferred incomplete context: ${deferredIncomplete}`,
    `Failed event processing: ${failedEvents}`,
    `Evaluated by Jev: ${evaluatedByJev}`,
    `Evaluated by LLM: ${evaluatedByLlm}`,
    `Evaluated by fallback: ${evaluatedByFallback}`,
    ...eventErrors.slice(0, 5).map((error) => `Event error: ${error}`),
    eventErrors.length > 5
      ? `Event errors omitted: ${eventErrors.length - 5}`
      : null,
    `Newly stored: ${stored}`,
    storedIds.length > 0
      ? `New IDs: ${storedIds.join(', ')}`
      : 'New IDs: (none)',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
