import { parseRelayUrls } from '@src/env';
import type { WebNodeRoot } from '@src/web/ui-schema';

import { classifyEventWithNrAi } from '../../classifier-ai';
import { listNrInteractions, parseAndStoreEvent } from '../../db';
import {
  hydrateStoredNrEvents,
  parseNostrEventArray,
} from '../../nostr-resolution';
import {
  extractProfileReferences,
  fetchReferencedEvents,
} from '../../references';
import { getNrSettings } from '../../settings';
import { fetchNip10ThreadContext } from '../../thread-context';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import { NostrEventSchema, type NrEvent } from '../shared/types';
import { stringFromVariadicArgument } from '../shared/variadic-text';

import { renderNrListParseSingleWeb } from './renderers/web';

function parseBooleanOption(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function collectProfilePubkeys(event: NrEvent | null): string[] {
  if (!event) {
    return [];
  }

  const threadContext = parseNostrEventArray(event.thread_context_json);
  const referencedEvents = parseNostrEventArray(event.referenced_events_json);

  return [
    ...new Set([
      event.pubkey,
      ...extractProfileReferences(event.content).map(
        (reference) => reference.pubkey,
      ),
      ...threadContext.map((contextEvent) => contextEvent.pubkey),
      ...threadContext.flatMap((contextEvent) =>
        extractProfileReferences(contextEvent.content).map(
          (reference) => reference.pubkey,
        ),
      ),
      ...referencedEvents.map((referencedEvent) => referencedEvent.pubkey),
      ...referencedEvents.flatMap((referencedEvent) =>
        extractProfileReferences(referencedEvent.content).map(
          (reference) => reference.pubkey,
        ),
      ),
    ]),
  ];
}

export async function adaptListParseSingleCommand(
  params: NrCommandAdapterParams,
): Promise<string | WebNodeRoot> {
  void params.command;
  void params.identity;

  const settings = getNrSettings(params.db);

  const raw = stringFromVariadicArgument(
    params.parsed.arguments.event_json,
  ).trim();

  if (!raw) {
    if (params.source !== 'web') {
      return `Usage: ${params.prefix}${params.alias} debug <event_json>`;
    }

    return renderNrListParseSingleWeb({
      alias: params.alias,
      settings,
      profiles: new Map(),
      event: null,
      interactions: [],
      message: null,
    });
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    const message = `Failed to parse event JSON: ${err instanceof Error ? err.message : String(err)}`;

    if (params.source !== 'web') {
      return message;
    }

    return renderNrListParseSingleWeb({
      alias: params.alias,
      settings,
      profiles: new Map(),
      event: null,
      interactions: [],
      message,
    });
  }

  const eventResult = NostrEventSchema.safeParse(parsedJson);

  if (!eventResult.success) {
    const message = `Invalid Nostr event: ${eventResult.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')}`;

    if (params.source !== 'web') {
      return message;
    }

    return renderNrListParseSingleWeb({
      alias: params.alias,
      settings,
      profiles: new Map(),
      event: null,
      interactions: [],
      message,
    });
  }

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
    const message = [
      'Deferred event: related context is incomplete.',
      threadContextResult.missingIds.length > 0
        ? `Missing thread events: ${threadContextResult.missingIds.join(', ')}`
        : 'Missing thread events: (none)',
      referencedEventsResult.missingIds.length > 0
        ? `Missing referenced events: ${referencedEventsResult.missingIds.join(', ')}`
        : 'Missing referenced events: (none)',
    ].join('\n');

    if (params.source !== 'web') {
      return message;
    }

    return renderNrListParseSingleWeb({
      alias: params.alias,
      settings,
      profiles: new Map(),
      event: null,
      interactions: [],
      message,
    });
  }

  const result = await parseAndStoreEvent({
    db: params.db,
    event: eventResult.data,
    forceReclassify: parseBooleanOption(params.parsed.options.force_reclassify),
    relayHints,
    threadContext: threadContextResult.events,
    referencedEvents: referencedEventsResult.events,
    nostrResolution: params.storedCtx.nostrResolution,
    classify: (event) =>
      classifyEventWithNrAi({
        db: params.db,
        event,
        instructions,
        threadContextEvents: threadContextResult.events,
        referencedEvents: referencedEventsResult.events,
        audienceReactions: [],
        storedCtx: params.storedCtx,
        agent: params.agent,
        abortSignal: null,
      }),
  });

  await hydrateStoredNrEvents({
    service: params.storedCtx.nostrResolution,
    events: [result.event],
    contextRelays: parseRelayUrls(process.env.BOT_RELAYS ?? ''),
    monitoring: params.storedCtx.monitoring,
  });

  if (params.source !== 'web') {
    return [
      result.inserted ? 'Cached new event.' : 'Updated cached event.',
      result.reclassified
        ? 'Classification updated.'
        : 'Existing classification kept.',
      `ID: ${result.event.id}`,
      `Topics: ${result.event.topics.join(', ')}`,
      `Moods: ${result.event.moods.join(', ')}`,
      `Summary: ${result.event.summary}`,
    ].join('\n');
  }

  return renderNrListParseSingleWeb({
    alias: params.alias,
    settings,
    profiles: await params.storedCtx.wot.getProfiles({
      pubkeys: collectProfilePubkeys(result.event),
      waitForMissing: false,
      refreshCached: true,
    }),
    event: result.event,
    interactions: listNrInteractions(params.db),
    message: result.inserted ? 'Cached new event.' : 'Updated cached event.',
  });
}
