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
} from './classifier';
import type { EventClassification, NostrEvent } from './commands/shared/types';
import { buildNrPluginContextText } from './context';
import { fetchReferencedEvents } from './references';
import { getNrSettings } from './settings';

type ClassifyEventWithNrAiProps = {
  db: Database;
  event: NostrEvent;
  instructions: string;
  threadContextEvents: NostrEvent[];
  referencedEvents: NostrEvent[] | null;
  storedCtx: PluginContext;
  runAgent: RunAgentFn | null;
};

export async function classifyEventWithNrAi({
  db,
  event,
  instructions,
  threadContextEvents,
  referencedEvents,
  storedCtx,
  runAgent,
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
    streamAbortSignal: null,
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
