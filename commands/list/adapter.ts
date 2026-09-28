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
import { getNrSchedulerResource } from '../../settings';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import type {
  NrEvent,
  NrListData,
  NrListMode,
  NrListTimeRange,
  NrListTimeSelection,
} from '../shared/types';

import { normalizeNrFeedCategories } from './categories';
import { handleListCommand } from './handler';
import { fetchNrProfileEvents } from './profile-events';
import { renderNrListText } from './renderers/text';
import { renderNrListWeb } from './renderers/web';

type MeasureListStepProps<T> = {
  params: NrCommandAdapterParams;
  name: string;
  run: () => T | Promise<T>;
};

async function measureListStep<T>({
  params,
  name,
  run,
}: MeasureListStepProps<T>): Promise<T> {
  return params.storedCtx.monitoring.currentContext()
    ? params.storedCtx.monitoring.withSpan({
        name,
        attributes: {},
        parent: null,
        run,
      })
    : run();
}

function parseTimeRange(value: string): NrListTimeRange {
  const parts = value.split(':');
  const since = Number(parts[0]);
  const until = Number(parts[1]);

  if (
    parts.length !== 2 ||
    !Number.isSafeInteger(since) ||
    !Number.isSafeInteger(until) ||
    since < 0 ||
    since >= until
  ) {
    throw new Error(
      `Invalid --time-range "${value}"; expected non-negative integer since:until with since < until.`,
    );
  }

  return { since, until };
}

function parseTimeSelection(
  options: NrCommandAdapterParams['parsed']['options'],
): NrListTimeSelection {
  const rawRanges = options.time_range;

  const values = Array.isArray(rawRanges)
    ? rawRanges.map(String)
    : rawRanges === undefined
      ? []
      : [String(rawRanges)];

  const ranges = [
    ...new Map(
      values.map((value) => {
        const range = parseTimeRange(value);

        return [`${range.since}:${range.until}`, range];
      }),
    ).values(),
  ];

  return {
    initialized:
      options.time_filter_initialized === true ||
      options.time_filter_initialized === 'true',
    ranges,
  };
}

function collectProfilePubkeys(listData: NrListData): string[] {
  const events: NrEvent[] = [
    ...listData.topicGroups.flatMap((group) => group.events),
    ...listData.moodGroups.flatMap((group) => group.events),
    ...listData.languageGroups.flatMap((group) => group.events),
    ...listData.forYouEvents,
    ...listData.activityEvents,
    ...listData.conversationContextEvents,
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
        )
        .concat(
          listData.signalAuthorAggregates.map(
            (aggregate) => aggregate.authorPubkey,
          ),
        ),
    ),
  ];
}

async function runListCommand(
  params: NrCommandAdapterParams,
): Promise<string | WebNodeRoot> {
  void params.command;
  void params.identity;
  void params.agent;

  const rawMode = params.parsed.options.mode;

  const mode: NrListMode =
    rawMode === 'archive'
      ? 'archive'
      : rawMode === 'profile'
        ? 'profile'
        : rawMode === 'for-you'
          ? 'for-you'
          : rawMode === 'signals'
            ? 'signals'
            : 'timeline';

  const rawKinds = params.parsed.options.kinds;

  const localMutation =
    params.parsed.options.local_mutation === true ||
    params.parsed.options.local_mutation === 'true';

  const timeSelection = parseTimeSelection(params.parsed.options);

  if (mode !== 'archive' && mode !== 'signals' && rawKinds !== undefined) {
    saveNrListFilter({
      db: params.db,
      mode,
      categories: normalizeNrFeedCategories(rawKinds),
    });
  }

  const listData = await measureListStep({
    params,
    name: 'nr.list.db',
    run: () => handleListCommand({ db: params.db, mode, timeSelection }),
  });

  const storedEvents = [
    ...listData.topicGroups.flatMap((group) => group.events),
    ...listData.moodGroups.flatMap((group) => group.events),
    ...listData.languageGroups.flatMap((group) => group.events),
    ...listData.forYouEvents,
    ...listData.activityEvents,
    ...listData.conversationContextEvents,
  ];

  if (!localMutation) {
    await measureListStep({
      params,
      name: 'nr.list.seed',
      run: () =>
        seedStoredNrEvents({
          service: params.storedCtx.nostrResolution,
          events: storedEvents,
          monitoring: params.storedCtx.monitoring,
        }),
    });
  }

  await measureListStep({
    params,
    name: 'nr.list.hydrate',
    run: () =>
      hydrateStoredNrEvents({
        service: params.storedCtx.nostrResolution,
        events: storedEvents,
        contextRelays: parseRelayUrls(process.env.BOT_RELAYS ?? ''),
        monitoring: params.storedCtx.monitoring,
      }),
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
    const profilePubkeys = await measureListStep({
      params,
      name: 'nr.list.profile-keys',
      run: () => collectProfilePubkeys(listData),
    });

    const profiles = await measureListStep({
      params,
      name: 'nr.list.profiles',
      run: () =>
        params.storedCtx.wot.getProfiles({
          pubkeys: profilePubkeys,
          waitForMissing: false,
          refreshCached: !localMutation,
        }),
    });

    const followedPubkeys = new Set(
      await params.storedCtx.wot.getFollows(params.storedCtx.masterPubkey),
    );

    return measureListStep({
      params,
      name: 'nr.list.web-build',
      run: () =>
        renderNrListWeb({
          alias: params.alias,
          listData,
          effectiveModel: params.storedCtx.agent.getEffectiveModel({
            backend: listData.settings.backend,
            model: listData.settings.model,
            workspaceTarget: null,
          }),
          schedulerResource: getNrSchedulerResource(params.db),
          profiles,
          followedPubkeys,
        }),
    });
  }

  return renderNrListText({ listData });
}

export async function adaptListCommand(
  params: NrCommandAdapterParams,
): Promise<string | WebNodeRoot> {
  const monitor = params.storedCtx.monitoring;

  if (monitor.currentContext() || !monitor.isEnabled()) {
    return runListCommand(params);
  }

  return monitor.withSpan({
    name: 'nr.list',
    attributes: {
      source: params.source,
      mode: String(params.parsed.options.mode ?? 'timeline'),
    },
    parent: null,
    run: () => runListCommand(params),
  });
}
