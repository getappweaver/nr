import { parseRelayUrls } from '@src/env';

import { classifyEventWithNrAi } from '../../classifier-ai';
import { parseAndStoreEvent } from '../../db';
import { fetchReferencedEvents } from '../../references';
import { getNrSettings } from '../../settings';
import { fetchNip10ThreadContext } from '../../thread-context';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import { NostrEventSchema } from '../shared/types';
import { stringFromVariadicArgument } from '../shared/variadic-text';

function parseBooleanOption(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export async function adaptParseCommand(
  params: NrCommandAdapterParams,
): Promise<string> {
  void params.command;
  void params.source;
  void params.identity;

  const raw = stringFromVariadicArgument(
    params.parsed.arguments.event_json,
  ).trim();

  if (!raw) {
    return `Usage: ${params.prefix}${params.alias} parse <event_json>`;
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    return `Failed to parse event JSON: ${err instanceof Error ? err.message : String(err)}`;
  }

  const eventResult = NostrEventSchema.safeParse(parsedJson);

  if (!eventResult.success) {
    return `Invalid Nostr event: ${eventResult.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')}`;
  }

  const settings = getNrSettings(params.db);
  const oneOffInstructions = asString(params.parsed.options.instructions);
  const instructions = oneOffInstructions?.trim() || settings.instructions;
  const relayHints = parseRelayUrls(process.env.BOT_RELAYS ?? '');

  const threadContextResult = await fetchNip10ThreadContext({
    pool: params.storedCtx.pool,
    event: eventResult.data,
    fallbackRelays: relayHints,
  });

  const referencedEventsResult = await fetchReferencedEvents({
    pool: params.storedCtx.pool,
    content: eventResult.data.content,
    fallbackRelays: relayHints,
  });

  if (
    threadContextResult.missingIds.length > 0 ||
    referencedEventsResult.missingIds.length > 0
  ) {
    return [
      'Deferred event: related context is incomplete.',
      threadContextResult.missingIds.length > 0
        ? `Missing thread events: ${threadContextResult.missingIds.join(', ')}`
        : 'Missing thread events: (none)',
      referencedEventsResult.missingIds.length > 0
        ? `Missing referenced events: ${referencedEventsResult.missingIds.join(', ')}`
        : 'Missing referenced events: (none)',
    ].join('\n');
  }

  const result = await parseAndStoreEvent({
    db: params.db,
    event: eventResult.data,
    forceReclassify: parseBooleanOption(params.parsed.options.force_reclassify),
    relayHints,
    threadContext: threadContextResult.events,
    referencedEvents: referencedEventsResult.events,
    classify: (event) =>
      classifyEventWithNrAi({
        db: params.db,
        event,
        instructions,
        threadContextEvents: threadContextResult.events,
        referencedEvents: referencedEventsResult.events,
        audienceReactions: [],
        storedCtx: params.storedCtx,
        runAgent: params.runAgent,
      }),
  });

  return [
    result.inserted ? 'Cached new event.' : 'Updated cached event.',
    result.reclassified
      ? 'Classification updated.'
      : 'Existing classification kept.',
    `ID: ${result.event.id}`,
    `Author: ${result.event.pubkey.slice(0, 16)}…`,
    `Topics: ${result.event.topics.join(', ')}`,
    `Moods: ${result.event.moods.join(', ')}`,
    `Model: ${result.event.model}`,
    `Summary: ${result.event.summary}`,
  ].join('\n');
}
