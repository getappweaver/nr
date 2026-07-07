import { parseRelayUrls } from '@src/env';
import { debug } from '@src/logger';
import { filterBlockedReadRelays } from '@src/nostr/relay-notices';

import { classifyEventWithNrAi } from '../../classifier-ai';
import {
  hasNrEvent,
  hasNrSkippedEvent,
  parseAndStoreEvent,
  recordNrFetchWindow,
  recordNrSkippedEvent,
} from '../../db';
import {
  extractEventReferences,
  fetchReferencedEvents,
} from '../../references';
import { getNrSettings } from '../../settings';
import {
  extractNip10References,
  fetchNip10ThreadContext,
} from '../../thread-context';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import { NR_FETCH_STATUS_TARGET_ID } from '../fetch-status';
import { NostrEventSchema } from '../shared/types';

const BACKGROUND_COMMAND_STATUS_MARKER = '__WEB_COMMAND_STATUS__';

type SendFetchStatusProps = {
  params: NrCommandAdapterParams;
  message: string;
  output: string | null;
  progress: number | null;
};

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

  await sendFetchStatus({
    params,
    message: 'Fetching Nostr posts…',
    output: '1. Fetching Nostr posts…',
    progress: null,
  });

  const settled = await Promise.allSettled(
    relayAuthorGroups.map(async (group) => {
      debug(
        `nr fetch-latest: querying ${group.relay} for ${group.authors.length} author(s)`,
      );

      const events = await params.storedCtx.pool.querySync(
        [group.relay],
        {
          kinds: [1],
          authors: group.authors,
          since,
          until,
          limit,
        },
        { maxWait: 5_000 },
      );

      debug(
        `nr fetch-latest: ${group.relay} returned ${events.length} event(s)`,
      );

      return { relay: group.relay, events };
    }),
  );

  const failedRelayCount = settled.filter(
    (entry) => entry.status === 'rejected',
  ).length;

  for (const entry of settled) {
    if (entry.status === 'rejected') {
      debug(`nr fetch-latest relay query failed: ${String(entry.reason)}`);
    }
  }

  const eventRelayHints = new Map<string, string[]>();

  const rawEvents = settled.flatMap((entry) => {
    if (entry.status !== 'fulfilled') {
      return [];
    }

    for (const event of entry.value.events) {
      eventRelayHints.set(event.id, [
        ...new Set([
          ...(eventRelayHints.get(event.id) ?? []),
          entry.value.relay,
        ]),
      ]);
    }

    return entry.value.events;
  });

  const uniqueEvents = [
    ...new Map(rawEvents.map((event) => [event.id, event])).values(),
  ]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);

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

    if (hasNrEvent(params.db, rawEvent.id)) {
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

      const threadContextResult = await fetchNip10ThreadContext({
        pool: params.storedCtx.pool,
        event: parsed.data,
        fallbackRelays: [
          ...relayHints,
          ...parseRelayUrls(process.env.BOT_RELAYS ?? ''),
        ],
      });

      const referencedEventsResult = await fetchReferencedEvents({
        pool: params.storedCtx.pool,
        content: parsed.data.content,
        fallbackRelays: [
          ...relayHints,
          ...parseRelayUrls(process.env.BOT_RELAYS ?? ''),
        ],
      });

      if (
        threadContextResult.missingIds.length > 0 ||
        referencedEventsResult.missingIds.length > 0
      ) {
        deferredIncomplete += 1;

        debug(
          `nr fetch-latest: deferred ${parsed.data.id}; missing thread=${threadContextResult.missingIds.join(',') || '(none)'} references=${referencedEventsResult.missingIds.join(',') || '(none)'}`,
        );

        continue;
      }

      const classification = await classifyEventWithNrAi({
        db: params.db,
        event: parsed.data,
        instructions,
        threadContextEvents: threadContextResult.events,
        referencedEvents: referencedEventsResult.events,
        storedCtx: params.storedCtx,
        runAgent: params.runAgent,
      });

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

      const result = await parseAndStoreEvent({
        db: params.db,
        event: parsed.data,
        forceReclassify: false,
        relayHints,
        threadContext: threadContextResult.events,
        referencedEvents: referencedEventsResult.events,
        classify: () => classification,
      });

      stored += result.inserted ? 1 : 0;
      storedIds.push(result.event.id);
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
      : failedRelayCount > 0 || failedEvents > 0
        ? 'partial'
        : 'fetched';

  const errors = [
    failedRelayCount > 0
      ? `${failedRelayCount}/${relayAuthorGroups.length} relay group(s) failed`
      : null,
    failedEvents > 0 ? `${failedEvents} event(s) failed processing` : null,
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
    `Failed relay groups: ${failedRelayCount}`,
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
