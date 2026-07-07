import type { WebNodeRoot } from '@src/web/ui-schema';

import { extractProfileReferences } from '../../references';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import type {
  NostrEvent,
  NrEvent,
  NrListData,
  NrListMode,
} from '../shared/types';

import { handleListCommand } from './handler';
import { renderNrListText } from './renderers/text';
import { renderNrListWeb } from './renderers/web';

function parseContextEvents(rawJson: string): NostrEvent[] {
  try {
    const parsed = JSON.parse(rawJson) as unknown;

    return Array.isArray(parsed) ? (parsed as NostrEvent[]) : [];
  } catch {
    return [];
  }
}

function collectProfilePubkeys(listData: NrListData): string[] {
  const events: NrEvent[] = [
    ...listData.topicGroups.flatMap((group) => group.events),
    ...listData.moodGroups.flatMap((group) => group.events),
  ];

  return [
    ...new Set(
      events.flatMap((event) => [
        event.pubkey,
        ...extractProfileReferences(event.content).map(
          (reference) => reference.pubkey,
        ),
        ...parseContextEvents(event.thread_context_json).map(
          (contextEvent) => contextEvent.pubkey,
        ),
        ...parseContextEvents(event.thread_context_json).flatMap(
          (contextEvent) =>
            extractProfileReferences(contextEvent.content).map(
              (reference) => reference.pubkey,
            ),
        ),
        ...parseContextEvents(event.referenced_events_json).map(
          (referencedEvent) => referencedEvent.pubkey,
        ),
        ...parseContextEvents(event.referenced_events_json).flatMap(
          (referencedEvent) =>
            extractProfileReferences(referencedEvent.content).map(
              (reference) => reference.pubkey,
            ),
        ),
      ]),
    ),
  ];
}

export async function adaptListCommand(
  params: NrCommandAdapterParams,
): Promise<string | WebNodeRoot> {
  void params.command;
  void params.identity;
  void params.runAgent;

  const rawMode = params.parsed.options.mode;
  const mode: NrListMode = rawMode === 'archive' ? 'archive' : 'timeline';
  const listData = handleListCommand({ db: params.db, mode });

  if (params.source === 'web') {
    return renderNrListWeb({
      alias: params.alias,
      listData,
      profiles: await params.storedCtx.wot.getProfiles(
        collectProfilePubkeys(listData),
      ),
    });
  }

  return renderNrListText({ listData });
}
