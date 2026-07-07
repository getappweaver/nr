import { parseRelayUrls } from '@src/env';

import { classifyEventWithNrAi } from '../../classifier-ai';
import { parseAndStoreEvent, getNr } from '../../db';
import { fetchReferencedEvents } from '../../references';
import { getNrSettings } from '../../settings';
import { fetchNip10ThreadContext } from '../../thread-context';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

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

  const existing = getNr(params.db, eventId.trim());

  if (!existing) {
    return `Not found: ${eventId}`;
  }

  const rawEvent = JSON.parse(existing.raw_json);

  const relayHints = [
    ...existing.relay_hints,
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

  const event = (
    await parseAndStoreEvent({
      db: params.db,
      event: rawEvent,
      forceReclassify: true,
      relayHints,
      threadContext: threadContextResult.events,
      referencedEvents: referencedEventsResult.events,
      classify: (eventToClassify) =>
        classifyEventWithNrAi({
          db: params.db,
          event: eventToClassify,
          instructions: settings.instructions,
          threadContextEvents: threadContextResult.events,
          referencedEvents: referencedEventsResult.events,
          storedCtx: params.storedCtx,
          runAgent: params.runAgent,
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
