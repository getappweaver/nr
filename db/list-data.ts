import type { Database as DatabaseType } from 'bun:sqlite';
import type { Event as NostrEvent } from 'nostr-tools';

import { parseEventReferences } from '@src/nostr/event-references';

import {
  categoryForNrEvent,
  normalizeNrFeedCategories,
} from '../commands/list/categories';
import {
  calculateNrFetchCoverage,
  calculateNrFetchCoverageBuckets,
  newestFetchedNrCoverageBucket,
} from '../commands/list/fetch-coverage';
import { extractEventReferences } from '../references';
import { getNrSettings } from '../settings';

import { getNr } from './events';
import { listNrFetchWindows } from './fetch-windows';
import { countNrEvaluatedImagesByEvent } from './images';
import {
  buildNrExplicitAuthorBiases,
  buildNrLearnedAuthorAffinities,
  buildNrSignalAggregates,
  buildNrTopicAffinities,
  getZappedSatsByTarget,
  scoreNrEventForYou,
} from './scoring';
import {
  listNrAuthorPreferences,
  listNrInteractions,
  listNrInterestSignals,
} from './signals';
import { listNrTaxonomyTerms } from './taxonomy';
import type {
  EventRow,
  FetchWindowRow,
  NrEvent,
  NrFeedCategory,
  NrFetchWindow,
  NrListData,
  NrListMode,
  NrListTimeRange,
  NrListTimeRangeSource,
  NrListTimeSelection,
  NrProfileEvent,
  NrTagGroup,
  NrUnreadFetchSlot,
  TagRow,
} from './types';
import { rowToNrEvent, rowToNrFetchWindow } from './types';

export function listModePredicate(mode: NrListMode): string {
  return mode === 'archive' ? 'e.archived_at IS NOT NULL' : 'e.read_at IS NULL';
}

export type EventTimeRangePredicate = {
  sql: string;
  params: number[];
};

export function eventTimeRangePredicate(
  ranges: NrListTimeRange[],
): EventTimeRangePredicate {
  if (ranges.length === 0) {
    return { sql: '', params: [] };
  }

  return {
    sql: `AND (${ranges
      .map(() => '(e.event_created_at >= ? AND e.event_created_at < ?)')
      .join(' OR ')})`,
    params: ranges.flatMap((range) => [range.since, range.until]),
  };
}

export function getNrListFilter({
  db,
  mode,
}: {
  db: DatabaseType;
  mode: 'timeline' | 'for-you' | 'profile';
}): NrFeedCategory[] {
  const row = db
    .prepare('SELECT categories_json FROM nr_list_filters WHERE mode = ?')
    .get(mode) as { categories_json: string } | null;

  if (!row) {
    return normalizeNrFeedCategories([]);
  }

  try {
    return normalizeNrFeedCategories(
      JSON.parse(row.categories_json) as unknown,
    );
  } catch {
    return normalizeNrFeedCategories([]);
  }
}

export function saveNrListFilter({
  db,
  mode,
  categories,
}: {
  db: DatabaseType;
  mode: 'timeline' | 'for-you' | 'profile';
  categories: NrFeedCategory[];
}): NrFeedCategory[] {
  const normalized = normalizeNrFeedCategories(categories);

  db.run(
    `INSERT INTO nr_list_filters (mode, categories_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(mode) DO UPDATE SET categories_json = excluded.categories_json, updated_at = excluded.updated_at`,
    [mode, JSON.stringify(normalized), Date.now()],
  );

  return normalized;
}

export function listNrProfileEvents({
  db,
  categories,
}: {
  db: DatabaseType;
  categories: NrFeedCategory[];
}): NrProfileEvent[] {
  const state = db
    .prepare('SELECT categories_json FROM nr_profile_cache_state WHERE id = 1')
    .get() as { categories_json: string } | null;

  if (!state || state.categories_json !== JSON.stringify(categories)) {
    return [];
  }

  const rows = db
    .prepare(
      `SELECT event_json, referenced_events_json
       FROM nr_profile_events
       ORDER BY event_created_at DESC
       LIMIT 50`,
    )
    .all() as Array<{ event_json: string; referenced_events_json: string }>;

  return rows.flatMap((row) => {
    try {
      const event = JSON.parse(row.event_json) as NostrEvent;

      const referencedEvents = JSON.parse(
        row.referenced_events_json,
      ) as NostrEvent[];

      return [{ event, referencedEvents }];
    } catch {
      return [];
    }
  });
}

export function saveNrProfileEvents({
  db,
  events,
  categories,
}: {
  db: DatabaseType;
  events: NrProfileEvent[];
  categories: NrFeedCategory[];
}): void {
  db.run('DELETE FROM nr_profile_events');

  const insert = db.prepare(
    `INSERT INTO nr_profile_events (
      id, event_created_at, event_json, referenced_events_json, cached_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      event_json = excluded.event_json,
      referenced_events_json = excluded.referenced_events_json,
      cached_at = excluded.cached_at`,
  );

  for (const { event, referencedEvents } of events) {
    insert.run(
      event.id,
      event.created_at,
      JSON.stringify(event),
      JSON.stringify(referencedEvents),
      Date.now(),
    );
  }

  db.run(
    `DELETE FROM nr_profile_events WHERE id NOT IN (
      SELECT id FROM nr_profile_events ORDER BY event_created_at DESC LIMIT 50
    )`,
  );

  db.run(
    `INSERT INTO nr_profile_cache_state (id, categories_json, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET categories_json = excluded.categories_json, updated_at = excluded.updated_at`,
    [JSON.stringify(categories), Date.now()],
  );
}

export function relatedEventIds(rawJson: string): string[] {
  try {
    const parsed = JSON.parse(rawJson) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return [
      ...new Set(
        parsed
          .map((item) =>
            item && typeof item === 'object' && 'id' in item
              ? (item as { id?: unknown }).id
              : null,
          )
          .filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          ),
      ),
    ];
  } catch {
    return [];
  }
}

export function eventHasCompleteContext(event: NrEvent): boolean {
  try {
    const rawEvent = JSON.parse(event.raw_json) as NostrEvent;
    const threadIds = new Set(relatedEventIds(event.thread_context_json));

    const referencedIds = new Set(
      relatedEventIds(event.referenced_events_json),
    );

    const threadEdges = parseEventReferences(rawEvent).filter(
      (edge) => edge.role === 'thread-root' || edge.role === 'thread-parent',
    );

    return (
      threadEdges.every((edge) =>
        edge.target.type === 'event'
          ? threadIds.has(edge.target.eventId)
          : threadIds.size > 0,
      ) &&
      extractEventReferences(event.content).every((reference) =>
        referencedIds.has(reference.id),
      )
    );
  } catch {
    return false;
  }
}

export type ListTagsProps = {
  db: DatabaseType;
  type: 'topic' | 'mood';
  mode: NrListMode;
  timeRanges: NrListTimeRange[];
};

export function listTags({
  db,
  type,
  mode,
  timeRanges,
}: ListTagsProps): TagRow[] {
  const predicate = listModePredicate(mode);
  const timePredicate = eventTimeRangePredicate(timeRanges);

  const unreadTargetPredicate =
    mode === 'archive'
      ? ''
      : `AND NOT EXISTS (
          SELECT 1
          FROM nr_activity_targets activity_target
          WHERE activity_target.activity_event_id = e.id
            AND (
              EXISTS (
                SELECT 1 FROM nr_read_events read_event
                WHERE read_event.event_id = activity_target.target_event_id
              )
              OR EXISTS (
                SELECT 1 FROM nr_events target
                WHERE target.id = activity_target.target_event_id
                  AND target.read_at IS NOT NULL
              )
            )
        )`;

  return db
    .prepare(
      `
      SELECT t.tag AS tag, COUNT(DISTINCT e.id) AS count
      FROM nr_event_tags t
      JOIN nr_events e ON e.id = t.event_id
      WHERE t.type = ? AND ${predicate} ${timePredicate.sql} ${unreadTargetPredicate}
      GROUP BY t.tag
      ORDER BY count DESC, t.tag COLLATE NOCASE ASC
    `,
    )
    .all(type, ...timePredicate.params) as TagRow[];
}

export type ListEventsForTagProps = {
  db: DatabaseType;
  type: 'topic' | 'mood';
  tag: string;
  hiddenEventIds: Set<string>;
  mode: NrListMode;
  categories: NrFeedCategory[];
  timeRanges: NrListTimeRange[];
};

export function listEventsForTag({
  db,
  type,
  tag,
  hiddenEventIds,
  mode,
  categories,
  timeRanges,
}: ListEventsForTagProps): NrEvent[] {
  const predicate = listModePredicate(mode);
  const timePredicate = eventTimeRangePredicate(timeRanges);

  const unreadTargetPredicate =
    mode === 'archive'
      ? ''
      : `AND NOT EXISTS (
          SELECT 1
          FROM nr_activity_targets activity_target
          WHERE activity_target.activity_event_id = e.id
            AND (
              EXISTS (
                SELECT 1 FROM nr_read_events read_event
                WHERE read_event.event_id = activity_target.target_event_id
              )
              OR EXISTS (
                SELECT 1 FROM nr_events target
                WHERE target.id = activity_target.target_event_id
                  AND target.read_at IS NOT NULL
              )
            )
        )`;

  const rows = db
    .prepare(
      `
      SELECT
        e.*,
        c.summary,
        c.model,
        c.classified_at,
        c.classification_json
      FROM nr_events e
      JOIN nr_event_tags t ON t.event_id = e.id
      LEFT JOIN nr_classifications c ON c.event_id = e.id
      WHERE t.type = ? AND t.tag = ? AND ${predicate} ${timePredicate.sql} ${unreadTargetPredicate}
      ORDER BY e.event_created_at DESC
    `,
    )
    .all(type, tag, ...timePredicate.params) as EventRow[];

  return rows.map(rowToNrEvent).filter((event) => {
    if (
      hiddenEventIds.has(event.id) ||
      ((event.kind === 1 || event.kind === 1111) &&
        !eventHasCompleteContext(event))
    ) {
      return false;
    }

    if (mode === 'archive') {
      return true;
    }

    try {
      const category = categoryForNrEvent(
        JSON.parse(event.raw_json) as NostrEvent,
      );

      return category !== null && categories.includes(category);
    } catch {
      return false;
    }
  });
}

export type BuildGroupsProps = {
  db: DatabaseType;
  type: 'topic' | 'mood';
  hiddenEventIds: Set<string>;
  mode: NrListMode;
  categories: NrFeedCategory[];
  timeRanges: NrListTimeRange[];
};

export function buildGroups({
  db,
  type,
  hiddenEventIds,
  mode,
  categories,
  timeRanges,
}: BuildGroupsProps): NrTagGroup[] {
  return listTags({ db, type, mode, timeRanges })
    .map((row) => {
      const events = listEventsForTag({
        db,
        type,
        tag: row.tag,
        hiddenEventIds,
        mode,
        categories,
        timeRanges,
      });

      return {
        type,
        tag: row.tag,
        unreadCount: events.length,
        events,
      };
    })
    .filter((group) => group.events.length > 0);
}

export type ListForYouCandidatesProps = {
  db: DatabaseType;
  hiddenEventIds: Set<string>;
  categories: NrFeedCategory[];
  timeRanges: NrListTimeRange[];
};

export function listForYouCandidates({
  db,
  hiddenEventIds,
  categories,
  timeRanges,
}: ListForYouCandidatesProps): NrEvent[] {
  const timePredicate = eventTimeRangePredicate(timeRanges);

  const rows = db
    .prepare(
      `SELECT e.*, c.summary, c.model, c.classified_at, c.classification_json
       FROM nr_events e
       LEFT JOIN nr_classifications c ON c.event_id = e.id
        WHERE e.read_at IS NULL ${timePredicate.sql}
         AND NOT EXISTS (
           SELECT 1
           FROM nr_activity_targets activity_target
           WHERE activity_target.activity_event_id = e.id
             AND (
               EXISTS (
                 SELECT 1 FROM nr_read_events read_event
                 WHERE read_event.event_id = activity_target.target_event_id
               )
               OR EXISTS (
                 SELECT 1 FROM nr_events target
                 WHERE target.id = activity_target.target_event_id
                   AND target.read_at IS NOT NULL
               )
             )
         )
       ORDER BY e.event_created_at DESC`,
    )
    .all(...timePredicate.params) as EventRow[];

  return rows.map(rowToNrEvent).filter((event) => {
    if (
      hiddenEventIds.has(event.id) ||
      ((event.kind === 1 || event.kind === 1111) &&
        !eventHasCompleteContext(event))
    ) {
      return false;
    }

    if (categories.length === 0) {
      return true;
    }

    try {
      const category = categoryForNrEvent(
        JSON.parse(event.raw_json) as NostrEvent,
      );

      return category !== null && categories.includes(category);
    } catch {
      return false;
    }
  });
}

export type RelatedEventIdsForModeProps = {
  db: DatabaseType;
  mode: NrListMode;
  timeRanges: NrListTimeRange[];
};

export function relatedEventIdsForMode({
  db,
  mode,
  timeRanges,
}: RelatedEventIdsForModeProps): Set<string> {
  const predicate = listModePredicate(mode);
  const timePredicate = eventTimeRangePredicate(timeRanges);

  const rows = db
    .prepare(
      `
      SELECT thread_context_json, referenced_events_json
      FROM nr_events e
       WHERE ${predicate} ${timePredicate.sql}
    `,
    )
    .all(...timePredicate.params) as Array<{
    thread_context_json: string | null;
    referenced_events_json: string | null;
  }>;

  return new Set(
    rows.flatMap((row) => [
      ...relatedEventIds(row.thread_context_json ?? '[]'),
      ...relatedEventIds(row.referenced_events_json ?? '[]'),
    ]),
  );
}

export type GetNrListDataProps = {
  db: DatabaseType;
  mode: NrListMode;
  timeSelection: NrListTimeSelection;
};

export type ResolvedTimeSelection = {
  ranges: NrListTimeRange[];
  source: NrListTimeRangeSource;
};

export type ResolveListTimeSelectionProps = {
  mode: NrListMode;
  requested: NrListTimeSelection;
  filterToLatestFetchedSlotOnOpen: boolean;
  fetchWindows: NrFetchWindow[];
  nowSeconds: number;
};

export function resolveListTimeSelection({
  mode,
  requested,
  filterToLatestFetchedSlotOnOpen,
  fetchWindows,
  nowSeconds,
}: ResolveListTimeSelectionProps): ResolvedTimeSelection {
  if (requested.initialized) {
    return { ranges: requested.ranges, source: 'request' };
  }

  if (mode !== 'timeline' || !filterToLatestFetchedSlotOnOpen) {
    return { ranges: [], source: 'none' };
  }

  const newestFetchedBucket = newestFetchedNrCoverageBucket(
    calculateNrFetchCoverage({ fetchWindows, nowSeconds, hours: 24 }),
  );

  return newestFetchedBucket
    ? {
        ranges: [
          {
            since: newestFetchedBucket.since,
            until: newestFetchedBucket.until,
          },
        ],
        source: 'latest-fetched-slot',
      }
    : { ranges: [], source: 'none' };
}

export const NR_FETCH_SLOT_SECONDS = 60 * 60;

export type UnreadTimelineCandidateRow = EventRow & {
  has_tag: number;
  target_read: number;
};

export type ListUnreadFetchSlotsProps = {
  db: DatabaseType;
  categories: NrFeedCategory[];
  signalAuthorPubkeys: ReadonlySet<string>;
};

export function listUnreadFetchSlots({
  db,
  categories,
  signalAuthorPubkeys,
}: ListUnreadFetchSlotsProps): NrUnreadFetchSlot[] {
  const fetchWindows = (
    db
      .prepare(
        `SELECT *
         FROM nr_fetch_windows
         WHERE scope = 'follows'
         ORDER BY since DESC, until DESC`,
      )
      .all() as FetchWindowRow[]
  ).map(rowToNrFetchWindow);

  if (fetchWindows.length === 0) {
    return [];
  }

  const latestUntil = Math.max(...fetchWindows.map((window) => window.until));
  const latestCoveredSecond = Math.max(0, latestUntil - 1);

  const candidateRows = db
    .prepare(
      `SELECT
         e.*,
         c.summary,
         c.model,
         c.classified_at,
         c.classification_json,
         EXISTS(
           SELECT 1 FROM nr_event_tags tag WHERE tag.event_id = e.id
         ) AS has_tag,
         EXISTS(
           SELECT 1
           FROM nr_activity_targets activity_target
           WHERE activity_target.activity_event_id = e.id
             AND (
               EXISTS (
                 SELECT 1 FROM nr_read_events read_event
                 WHERE read_event.event_id = activity_target.target_event_id
               )
               OR EXISTS (
                 SELECT 1 FROM nr_events target
                 WHERE target.id = activity_target.target_event_id
                   AND target.read_at IS NOT NULL
               )
             )
         ) AS target_read
       FROM nr_events e
       LEFT JOIN nr_classifications c ON c.event_id = e.id
       WHERE e.read_at IS NULL
       ORDER BY e.event_created_at DESC`,
    )
    .all() as UnreadTimelineCandidateRow[];

  const candidates = candidateRows.map((row) => ({
    row,
    event: rowToNrEvent(row),
    since:
      Math.floor(row.event_created_at / NR_FETCH_SLOT_SECONDS) *
      NR_FETCH_SLOT_SECONDS,
  }));

  const hiddenIdsByHour = new Map<number, Set<string>>();

  for (const candidate of candidates) {
    const hiddenIds = hiddenIdsByHour.get(candidate.since) ?? new Set<string>();

    for (const id of [
      ...relatedEventIds(candidate.event.thread_context_json),
      ...relatedEventIds(candidate.event.referenced_events_json),
    ]) {
      hiddenIds.add(id);
    }

    hiddenIdsByHour.set(candidate.since, hiddenIds);
  }

  const unreadByHour = new Map<number, number>();

  for (const candidate of candidates) {
    let category: NrFeedCategory | null;

    try {
      category = categoryForNrEvent(
        JSON.parse(candidate.event.raw_json) as NostrEvent,
      );
    } catch {
      category = null;
    }

    if (!category || !categories.includes(category)) {
      continue;
    }

    const visible =
      candidate.event.kind === 1
        ? (candidate.row.has_tag === 1 ||
            signalAuthorPubkeys.has(candidate.event.pubkey.toLowerCase())) &&
          candidate.row.target_read === 0 &&
          !hiddenIdsByHour.get(candidate.since)?.has(candidate.event.id) &&
          eventHasCompleteContext(candidate.event)
        : candidate.row.target_read === 0;

    if (visible) {
      unreadByHour.set(
        candidate.since,
        (unreadByHour.get(candidate.since) ?? 0) + 1,
      );
    }
  }

  return calculateNrFetchCoverageBuckets({
    fetchWindows,
    nowSeconds: latestCoveredSecond,
    bucketStarts: [...unreadByHour.keys()].sort((left, right) => right - left),
  })
    .filter(
      (
        bucket,
      ): bucket is typeof bucket & {
        status: NrUnreadFetchSlot['status'];
      } =>
        (bucket.status === 'fetched' || bucket.status === 'partial') &&
        (unreadByHour.get(bucket.since) ?? 0) > 0,
    )
    .map((bucket) => ({
      since: bucket.since,
      until: bucket.until,
      status: bucket.status,
      unreadCount: unreadByHour.get(bucket.since) ?? 0,
    }));
}

export function getNrListData({
  db,
  mode,
  timeSelection,
}: GetNrListDataProps): NrListData {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const settings = getNrSettings(db);

  const fetchWindows = listNrFetchWindows({
    db,
    since: nowSeconds - 24 * 60 * 60,
    until: nowSeconds,
    scopes: ['follows'],
  });

  const resolvedTimeSelection = resolveListTimeSelection({
    mode,
    requested: timeSelection,
    filterToLatestFetchedSlotOnOpen: settings.filterToLatestFetchedSlotOnOpen,
    fetchWindows,
    nowSeconds,
  });

  const queryTimeRanges =
    mode === 'timeline' ? resolvedTimeSelection.ranges : [];

  const selectedCategories =
    mode === 'archive' || mode === 'signals'
      ? normalizeNrFeedCategories([])
      : getNrListFilter({
          db,
          mode,
        });

  const hiddenEventIds = relatedEventIdsForMode({
    db,
    mode,
    timeRanges: queryTimeRanges,
  });

  const topicGroups =
    mode === 'for-you' || mode === 'signals'
      ? []
      : buildGroups({
          db,
          type: 'topic',
          hiddenEventIds,
          mode,
          categories: selectedCategories,
          timeRanges: queryTimeRanges,
        });

  // Group/item ordering by score is applied after forYouScores are
  // computed (see below), so no ordering here.

  const moodGroups =
    mode === 'for-you' || mode === 'signals'
      ? []
      : buildGroups({
          db,
          type: 'mood',
          hiddenEventIds,
          mode,
          categories: selectedCategories,
          timeRanges: queryTimeRanges,
        });

  const defaultLanguage = (settings.defaultLanguage ?? 'en').toLowerCase();

  const languageEvents = [
    ...new Map(
      [...topicGroups, ...moodGroups]
        .flatMap((group) => group.events)
        .map((event) => [event.id, event]),
    ).values(),
  ];

  const languageGroups = [
    ...new Set(languageEvents.map((event) => event.language)),
  ]
    .filter(
      (language) =>
        language.length > 0 &&
        language.toLowerCase() !== defaultLanguage &&
        language.toLowerCase() !== 'und',
    )
    .sort((left, right) => left.localeCompare(right))
    .map((language) => {
      const events = languageEvents.filter(
        (event) => event.language === language,
      );

      return {
        type: 'language' as const,
        tag: language,
        unreadCount: events.length,
        events,
      };
    });

  const activityTargetPredicate =
    mode === 'archive'
      ? ''
      : `AND NOT EXISTS (
          SELECT 1
          FROM nr_activity_targets activity_target
          WHERE activity_target.activity_event_id = e.id
            AND (
              EXISTS (
                SELECT 1 FROM nr_read_events read_event
                WHERE read_event.event_id = activity_target.target_event_id
              )
              OR EXISTS (
                SELECT 1 FROM nr_events target
                WHERE target.id = activity_target.target_event_id
                  AND target.read_at IS NOT NULL
              )
            )
        )`;

  const activityTimePredicate = eventTimeRangePredicate(queryTimeRanges);

  const activityEvents =
    mode === 'for-you' || mode === 'signals'
      ? []
      : (
          db
            .prepare(
              `SELECT e.*, c.summary, c.model, c.classified_at, c.classification_json
         FROM nr_events e
         LEFT JOIN nr_classifications c ON c.event_id = e.id
           WHERE e.kind IN (6, 7, 16, 9735) AND ${listModePredicate(mode)} ${activityTimePredicate.sql} ${activityTargetPredicate}
         ORDER BY e.event_created_at DESC`,
            )
            .all(...activityTimePredicate.params) as EventRow[]
        )
          .map(rowToNrEvent)
          .filter((event) => {
            try {
              const category = categoryForNrEvent(
                JSON.parse(event.raw_json) as NostrEvent,
              );

              return category !== null && selectedCategories.includes(category);
            } catch {
              return false;
            }
          });

  const visibleUnreadEventIds = new Set(
    [
      ...topicGroups.flatMap((group) => group.events),
      ...moodGroups.flatMap((group) => group.events),
      ...languageGroups.flatMap((group) => group.events),
      ...activityEvents,
    ].map((event) => event.id),
  );

  const interestSignals = listNrInterestSignals(db);
  const authorPreferences = listNrAuthorPreferences(db);
  const topicAffinities = buildNrTopicAffinities(interestSignals);

  const learnedAuthorAffinities =
    buildNrLearnedAuthorAffinities(interestSignals);

  // Signals are the learned author history; selected slots constrain posts,
  // not when the author was liked, replied to, or otherwise reviewed.
  const eventsByAuthor = new Map<string, NrEvent[]>();

  if (mode === 'timeline' && learnedAuthorAffinities.size > 0) {
    for (const event of listForYouCandidates({
      db,
      hiddenEventIds,
      categories: selectedCategories,
      timeRanges: queryTimeRanges,
    })) {
      const pubkey = event.pubkey.toLowerCase();

      if (!learnedAuthorAffinities.has(pubkey)) {
        continue;
      }

      const events = eventsByAuthor.get(pubkey) ?? [];
      events.push(event);
      eventsByAuthor.set(pubkey, events);
      visibleUnreadEventIds.add(event.id);
    }
  }

  const authorGroups = [...eventsByAuthor].map(([pubkey, events]) => ({
    pubkey,
    events,
  }));

  const explicitAuthorBiases = buildNrExplicitAuthorBiases(authorPreferences);
  const zappedSats = getZappedSatsByTarget(db);

  const rankedForYouEvents =
    mode === 'for-you'
      ? listForYouCandidates({
          db,
          hiddenEventIds,
          categories: selectedCategories,
          timeRanges: [],
        })
          .map((event) => ({
            event,
            score: scoreNrEventForYou({
              event,
              topicAffinities,
              learnedAuthorAffinities,
              explicitAuthorBiases,
              zapSats: zappedSats.get(event.id) ?? 0,
            }),
          }))
          .filter(({ score }) => score >= 0)
          .sort(
            (left, right) =>
              right.score - left.score ||
              right.event.event_created_at - left.event.event_created_at,
          )
      : [];

  const forYouHasMore = rankedForYouEvents.length > 25;
  const selectedForYouEvents = rankedForYouEvents.slice(0, 25);
  const forYouEvents = selectedForYouEvents.map(({ event }) => event);

  const visibleEvents = [
    ...authorGroups.flatMap((group) => group.events),
    ...topicGroups.flatMap((group) => group.events),
    ...moodGroups.flatMap((group) => group.events),
    ...languageGroups.flatMap((group) => group.events),
    ...forYouEvents,
    ...activityEvents,
  ];

  const visibleIds = new Set(visibleEvents.map((event) => event.id));

  const conversationContextEvents = [
    ...new Set(
      visibleEvents.flatMap((event) => [
        ...relatedEventIds(event.thread_context_json),
        ...relatedEventIds(event.referenced_events_json),
      ]),
    ),
  ].flatMap((eventId) => {
    const event = visibleIds.has(eventId) ? null : getNr(db, eventId);

    return event ? [event] : [];
  });

  const visibleScoredEvents =
    mode === 'for-you'
      ? selectedForYouEvents
      : [
          ...new Map(
            [...topicGroups, ...moodGroups, ...authorGroups]
              .flatMap((group) => group.events)
              .filter((event) => event.kind === 1 || event.kind === 30023)
              .map((event) => [event.id, event]),
          ).values(),
        ].map((event) => ({
          event,
          score: scoreNrEventForYou({
            event,
            topicAffinities,
            learnedAuthorAffinities,
            explicitAuthorBiases,
            zapSats: zappedSats.get(event.id) ?? 0,
          }),
        }));

  const forYouScores = Object.fromEntries(
    [
      ...visibleScoredEvents,
      ...(mode === 'for-you'
        ? conversationContextEvents.map((event) => ({
            event,
            score: scoreNrEventForYou({
              event,
              topicAffinities,
              learnedAuthorAffinities,
              explicitAuthorBiases,
              zapSats: zappedSats.get(event.id) ?? 0,
            }),
          }))
        : []),
    ].map(({ event, score }) => [event.id, score]),
  );

  const scoreOf = (id: string): number =>
    forYouScores[id] ?? Number.NEGATIVE_INFINITY;

  const sortEventsByScore = (events: NrEvent[]) => {
    events.sort(
      (left, right) =>
        scoreOf(right.id) - scoreOf(left.id) ||
        right.event_created_at - left.event_created_at,
    );
  };

  const maxGroupScore = (group: Pick<NrTagGroup, 'events'>): number =>
    group.events.reduce(
      (max, event) => Math.max(max, scoreOf(event.id)),
      Number.NEGATIVE_INFINITY,
    );

  const sortGroupsByScore = (groups: NrTagGroup[]) => {
    for (const group of groups) {
      sortEventsByScore(group.events);
    }

    groups.sort(
      (left, right) =>
        maxGroupScore(right) - maxGroupScore(left) ||
        right.unreadCount - left.unreadCount ||
        left.tag.localeCompare(right.tag),
    );
  };

  sortGroupsByScore(topicGroups);
  sortGroupsByScore(moodGroups);

  for (const group of authorGroups) {
    sortEventsByScore(group.events);
  }

  authorGroups.sort(
    (left, right) =>
      maxGroupScore(right) - maxGroupScore(left) ||
      right.events.length - left.events.length ||
      left.pubkey.localeCompare(right.pubkey),
  );

  const signalAggregates =
    mode === 'signals'
      ? buildNrSignalAggregates({
          db,
          signals: interestSignals,
          topicAffinities,
          learnedAuthorAffinities,
        })
      : { topicAggregates: [], authorAggregates: [] };

  const archivedEventIds = (
    db
      .prepare('SELECT id FROM nr_events WHERE archived_at IS NOT NULL')
      .all() as Array<{ id: string }>
  ).map((row) => row.id);

  const evaluatedImageCounts = countNrEvaluatedImagesByEvent(db);

  return {
    mode,
    selectedTimeRanges: resolvedTimeSelection.ranges,
    selectedTimeRangeSource: resolvedTimeSelection.source,
    timeFilterInitialized: true,
    selectedCategories,
    profileEvents: [],
    forYouEvents,
    forYouHasMore,
    forYouScores,
    archivedEventIds,
    evaluatedImageCounts,
    conversationContextEvents,
    activityEvents,
    topicGroups,
    moodGroups,
    languageGroups,
    authorGroups,
    unreadTotal:
      mode === 'for-you'
        ? forYouEvents.length
        : mode === 'signals'
          ? interestSignals.length
          : visibleUnreadEventIds.size,
    fetchCoverageNowSeconds: nowSeconds,
    fetchWindows,
    unreadFetchSlots: listUnreadFetchSlots({
      db,
      categories: selectedCategories,
      signalAuthorPubkeys: new Set(learnedAuthorAffinities.keys()),
    }),
    interactions: listNrInteractions(db),
    interestSignals,
    signalTopicAggregates: signalAggregates.topicAggregates,
    signalAuthorAggregates: signalAggregates.authorAggregates,
    authorPreferences,
    taxonomyTerms: listNrTaxonomyTerms(db),
    settings,
  };
}
