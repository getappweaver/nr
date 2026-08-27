import { parseRelayUrls } from '@src/env';

import { classifyEventWithNrAi } from '../../classifier-ai';
import { parseAndStoreEvent, getNr } from '../../db';
import { fetchReferencedEvents } from '../../references';
import { getNrSettings } from '../../settings';
import { fetchNip10ThreadContext } from '../../thread-context';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import { NostrEventSchema } from '../shared/types';

export async function adaptReevaluateCommand(
  params: NrCommandAdapterParams,
): Promise<string> {
  void params.command;
  void params.source;
  void params.identity;

  const eventId = params.parsed.arguments.event_id;

  if (typeof eventId !== 'string' || !eventId.trim()) {
    return `Usage: ${params.prefix}${params.alias} reevaluate <event_id>`;
  }

  const normalizedEventId = eventId.trim();
  const existing = getNr(params.db, normalizedEventId);
  const eventJson = params.parsed.options.event_json;

  const providedEvent =
    typeof eventJson === 'string'
      ? NostrEventSchema.safeParse(JSON.parse(eventJson))
      : null;

  if (
    !existing &&
    (!providedEvent?.success || providedEvent.data.id !== normalizedEventId)
  ) {
    return `Not found: ${eventId}`;
  }

  const rawEvent = existing
    ? NostrEventSchema.parse(JSON.parse(existing.raw_json))
    : providedEvent?.success
      ? providedEvent.data
      : null;

  if (!rawEvent) {
    return `Not found: ${eventId}`;
  }

  const relayHints = [
    ...(existing?.relay_hints ?? []),
    ...parseRelayUrls(process.env.BOT_RELAYS ?? ''),
  ];

  const settings = getNrSettings(params.db);

  const threadContextResult = await fetchNip10ThreadContext({
    pool: params.storedCtx.pool,
    event: rawEvent,
    fallbackRelays: relayHints,
  });

  const referencedEventsResult = await fetchReferencedEvents({
    pool: params.storedCtx.pool,
    content: rawEvent.content,
    fallbackRelays: relayHints,
  });

  if (
    threadContextResult.missingIds.length > 0 ||
    referencedEventsResult.missingIds.length > 0
  ) {
    return [
      'Deferred reevaluation: related context is incomplete.',
      threadContextResult.missingIds.length > 0
        ? `Missing thread events: ${threadContextResult.missingIds.join(', ')}`
        : 'Missing thread events: (none)',
      referencedEventsResult.missingIds.length > 0
        ? `Missing referenced events: ${referencedEventsResult.missingIds.join(', ')}`
        : 'Missing referenced events: (none)',
    ].join('\n');
  }

  const nestedSources = [
    ...new Map(
      [...threadContextResult.events, ...referencedEventsResult.events].map(
        (event) => [event.id, event],
      ),
    ).values(),
  ].slice(0, 5);

  const nestedResults = await Promise.all(
    nestedSources.map(async (referencedEvent) =>
      Promise.all([
        fetchReferencedEvents({
          pool: params.storedCtx.pool,
          content: referencedEvent.content,
          fallbackRelays: relayHints,
        }),
        fetchNip10ThreadContext({
          pool: params.storedCtx.pool,
          event: referencedEvent,
          fallbackRelays: relayHints,
        }),
      ]),
    ),
  );

  const referencedEvents = [
    ...new Map(
      [
        ...referencedEventsResult.events,
        ...nestedResults.flatMap(([nestedReferences, nestedThread]) => [
          ...nestedReferences.events,
          ...nestedThread.events,
        ]),
      ].map((referencedEvent) => [referencedEvent.id, referencedEvent]),
    ).values(),
  ];

  const event = (
    await parseAndStoreEvent({
      db: params.db,
      event: rawEvent,
      forceReclassify: true,
      relayHints,
      threadContext: threadContextResult.events,
      referencedEvents,
      nostrResolution: params.storedCtx.nostrResolution,
      classify: (eventToClassify) =>
        classifyEventWithNrAi({
          db: params.db,
          event: eventToClassify,
          instructions: settings.instructions,
          threadContextEvents: threadContextResult.events,
          referencedEvents,
          audienceReactions: [],
          storedCtx: params.storedCtx,
          agent: params.agent,
          abortSignal: null,
        }),
    })
  ).event;

  return [
    `Reevaluated: ${event.id}`,
    `Topics: ${event.topics.join(', ')}`,
    `Moods: ${event.moods.join(', ')}`,
    `Summary: ${event.summary}`,
  ].join('\n');
}
