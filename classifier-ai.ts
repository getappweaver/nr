import { dirname } from 'path';

import type { Database } from 'bun:sqlite';

import { createBackend } from '@src/backends/factory';
import { getOutputString } from '@src/backends/types';
import type { PluginContext, RunAgentFn } from '@src/core/plugin';
import { parseRelayUrls } from '@src/env';

import {
  buildClassificationPrompt,
  classifyEvent,
  parseAiClassification,
  type NrAudienceReactionCount,
} from './classifier';
import type {
  EventClassification,
  NostrEvent,
  NrAudienceReaction,
} from './commands/shared/types';
import { buildNrPluginContextText } from './context';
import { listNrAudienceReactions } from './db';
import { fetchReferencedEvents } from './references';
import { getNrSettings } from './settings';

type ClassifyEventWithNrAiProps = {
  db: Database;
  event: NostrEvent;
  instructions: string;
  threadContextEvents: NostrEvent[];
  referencedEvents: NostrEvent[] | null;
  audienceReactions: NrAudienceReaction[];
  storedCtx: PluginContext;
  runAgent: RunAgentFn | null;
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
  runAgent,
  abortSignal,
}: ClassifyEventWithNrAiProps): Promise<EventClassification> {
  void runAgent;

  const fallback = classifyEvent(event);
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
  });

  const backendName = settings.backend ?? storedCtx.defaults.backend;
  const modelOverride = settings.model ?? storedCtx.defaults.model;
  const dmBotRoot = process.cwd();

  const cwd =
    storedCtx.defaults.workspace_target === 'appweaver'
      ? dmBotRoot
      : dirname(dmBotRoot);

  const backend = createBackend({
    backendName,
    dmBotRoot,
    cursorMode: storedCtx.defaults.mode,
    opencodeAgentName:
      backendName === 'opencode' ? storedCtx.defaults.mode : null,
    attachUrl: null,
    modelOverride,
    providerName: storedCtx.defaults.provider,
  });

  const sessionId = await backend.createSession(cwd);

  const result = await backend.runMessage({
    sessionId,
    content: prompt,
    cursorMode: storedCtx.defaults.mode,
    opencodeAgentName:
      backendName === 'opencode' ? storedCtx.defaults.mode : null,
    cwd,
    getRoutstrSkKey: storedCtx.getRoutstrSkKey,
    modelOverride,
    onAgentStreamChunk: null,
    streamAbortSignal: abortSignal,
    skipRuntimeContext: true,
  });

  if (result.type === 'error') {
    return { ...fallback, model: `${backend.modelName}:fallback` };
  }

  return parseAiClassification({
    raw: getOutputString(result),
    model: result.model ?? backend.modelName,
    fallback,
  });
}
