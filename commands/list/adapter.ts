import type { WebNodeRoot } from '@src/web/ui-schema';

import {
  listNrProfileEvents,
  saveNrListFilter,
  saveNrProfileEvents,
} from '../../db';
import { extractProfileReferences } from '../../references';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import type {
  NostrEvent,
  NrEvent,
  NrListData,
  NrListMode,
} from '../shared/types';

import { normalizeNrFeedCategories } from './categories';
import { handleListCommand } from './handler';
import { fetchNrProfileEvents } from './profile-events';
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
    ...listData.activityEvents,
  ];

  return [
    ...new Set(
      events
        .flatMap((event) => [
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
        ])
        .concat(
          listData.profileEvents.flatMap(({ event, referencedEvents }) => [
            event.pubkey,
            ...referencedEvents.map((reference) => reference.pubkey),
            ...extractProfileReferences(event.content).map(
              (reference) => reference.pubkey,
            ),
          ]),
        ),
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

  const mode: NrListMode =
    rawMode === 'archive'
      ? 'archive'
      : rawMode === 'profile'
        ? 'profile'
        : rawMode === 'for-you'
          ? 'for-you'
          : 'timeline';

  const rawKinds = params.parsed.options.kinds;

  if ((mode === 'timeline' || mode === 'profile') && rawKinds !== undefined) {
    saveNrListFilter({
      db: params.db,
      mode,
      categories: normalizeNrFeedCategories(rawKinds),
    });
  }

  const listData = handleListCommand({ db: params.db, mode });

  if (mode === 'profile') {
    const cachedEvents = listNrProfileEvents({
      db: params.db,
      categories: listData.selectedCategories,
    });

    listData.profileEvents = await fetchNrProfileEvents({
      params,
      categories: listData.selectedCategories,
      cachedEvents,
    });

    saveNrProfileEvents({
      db: params.db,
      events: listData.profileEvents,
      categories: listData.selectedCategories,
    });
  }

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
