import { parseRelayUrls } from '@src/env';
import type { WebNodeRoot } from '@src/web/ui-schema';

import {
  listNrProfileEvents,
  saveNrListFilter,
  saveNrProfileEvents,
} from '../../db';
import {
  hydrateStoredNrEvents,
  parseNostrEventArray,
  seedStoredNrEvents,
} from '../../nostr-resolution';
import { extractProfileReferences } from '../../references';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import type { NrEvent, NrListData, NrListMode } from '../shared/types';

import { normalizeNrFeedCategories } from './categories';
import { handleListCommand } from './handler';
import { fetchNrProfileEvents } from './profile-events';
import { renderNrListText } from './renderers/text';
import { renderNrListWeb } from './renderers/web';

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
          ...parseNostrEventArray(event.thread_context_json).map(
            (contextEvent) => contextEvent.pubkey,
          ),
          ...parseNostrEventArray(event.thread_context_json).flatMap(
            (contextEvent) =>
              extractProfileReferences(contextEvent.content).map(
                (reference) => reference.pubkey,
              ),
          ),
          ...parseNostrEventArray(event.referenced_events_json).map(
            (referencedEvent) => referencedEvent.pubkey,
          ),
          ...parseNostrEventArray(event.referenced_events_json).flatMap(
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

  const storedEvents = [
    ...listData.topicGroups.flatMap((group) => group.events),
    ...listData.moodGroups.flatMap((group) => group.events),
    ...listData.forYouEvents,
    ...listData.activityEvents,
  ];

  await seedStoredNrEvents({
    service: params.storedCtx.nostrResolution,
    events: storedEvents,
  });

  await hydrateStoredNrEvents({
    service: params.storedCtx.nostrResolution,
    events: storedEvents,
    contextRelays: parseRelayUrls(process.env.BOT_RELAYS ?? ''),
  });

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
      profiles: await params.storedCtx.wot.getProfiles({
        pubkeys: collectProfilePubkeys(listData),
        waitForMissing: false,
      }),
    });
  }

  return renderNrListText({ listData });
}
