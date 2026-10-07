import type { Database } from 'bun:sqlite';

import { getOutputString } from '@src/backends/types';
import type { PluginAgentService } from '@src/core/plugin';
import { parseRelayUrls } from '@src/env';

import {
  buildClassificationPrompt,
  classifyEvent,
  parseAiClassification,
  type NrAudienceReactionCount,
} from './classifier';
import { classifyEventWithJev } from './classifier-jev';
import type {
  EventClassification,
  NostrEvent,
  NrAudienceReaction,
} from './commands/shared/types';
import { buildNrPluginContextText } from './context';
import { listNrAudienceReactions } from './db';
import { describeEventImages } from './image-evaluation';
import { fetchReferencedEvents } from './references';
import { getNrSettings } from './settings';
import type { NrRuntimeContext } from './types/adapter-params';

type ClassifyEventWithNrAiProps = {
  db: Database;
  event: NostrEvent;
  instructions: string;
  threadContextEvents: NostrEvent[];
  referencedEvents: NostrEvent[] | null;
  audienceReactions: NrAudienceReaction[];
  storedCtx: NrRuntimeContext;
  agent: PluginAgentService;
  abortSignal: AbortSignal | null;
};

function reactionCounts({
  cached,
  current,
}: {
  cached: NrAudienceReaction[];
  current: NrAudienceReaction[];
}): NrAudienceReactionCount[] {
  const latestByPubkey = new Map<string, NrAudienceReaction>();

  for (const reaction of [...cached, ...current]) {
    const existing = latestByPubkey.get(reaction.pubkey);

    if (!existing || reaction.createdAt > existing.createdAt) {
      latestByPubkey.set(reaction.pubkey, reaction);
    }
  }

  const counts = new Map<string, number>();

  const latestReactions = [...latestByPubkey.values()]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 50);

  for (const reaction of latestReactions) {
    const value = (reaction.content.trim() || '+').slice(0, 80);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count);
}

export async function classifyEventWithNrAi({
  db,
  event,
  instructions,
  threadContextEvents,
  referencedEvents,
  audienceReactions,
  storedCtx,
  agent,
  abortSignal,
}: ClassifyEventWithNrAiProps): Promise<EventClassification> {
  const settings = getNrSettings(db);

  const promptReferencedEvents =
    referencedEvents ??
    (
      await fetchReferencedEvents({
        pool: storedCtx.pool,
        content: event.content,
        fallbackRelays: parseRelayUrls(process.env.BOT_RELAYS ?? ''),
      })
    ).events;

  if (settings.mode === 'classifier') {
    return classifyEventWithJev({
      db,
      event,
      threadContextEvents,
      referencedEvents: promptReferencedEvents,
      abortSignal,
      capabilities: storedCtx.capabilities,
    });
  }

  const fallback = classifyEvent(event);

  const imageDescriptions = await describeEventImages({
    db,
    event,
    settings,
    agent,
    abortSignal,
  });

  const prompt = buildClassificationPrompt({
    event,
    instructions,
    nrContext: buildNrPluginContextText(db),
    referencedEvents: promptReferencedEvents,
    threadContextEvents,
    audienceReactions: reactionCounts({
      cached: listNrAudienceReactions(db, event.id),
      current: audienceReactions,
    }),
    imageDescriptions,
  });

  const result = await agent.run({
    prompt,
    sessionId: null,
    workspaceTarget: null,
    modelId: settings.model,
    cwd: null,
    onAgentStreamChunk: null,
    abortSignal,
    context: null,
  });

  if (result.type === 'error') {
    return { ...fallback, model: `${result.backend}:fallback` };
  }

  return parseAiClassification({
    raw: getOutputString(result),
    model: result.model ?? result.backend,
    fallback,
  });
}
