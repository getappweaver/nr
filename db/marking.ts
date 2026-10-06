import type { Database as DatabaseType } from 'bun:sqlite';

import type { NrEvent } from '../commands/shared/types';

import { getNr } from './events';
import type {
  MarkTaggedEventsReadProps,
  MarkTaggedEventsReadResult,
  NrMarkState,
} from './types';

export function markEventRead(
  db: DatabaseType,
  eventId: string,
): NrEvent | null {
  return markEventState({
    db,
    eventId,
    state: 'read',
  });
}

export function isEventRead(db: DatabaseType, eventId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS is_read
       FROM nr_read_events
       WHERE event_id = ?
       UNION
       SELECT 1 AS is_read
       FROM nr_events
       WHERE id = ? AND read_at IS NOT NULL
       LIMIT 1`,
    )
    .get(eventId, eventId) as { is_read?: number } | undefined;

  return Boolean(row?.is_read);
}

export type MarkEventStateProps = {
  db: DatabaseType;
  eventId: string;
  state: NrMarkState;
};

export type MarkTaggedEventsStateProps = {
  db: DatabaseType;
  type: 'topic' | 'mood';
  tag: string;
  state: NrMarkState;
};

function markColumnForState(state: NrMarkState): 'read_at' | 'archived_at' {
  return state === 'read' || state === 'unread' ? 'read_at' : 'archived_at';
}

function markValueForState(state: NrMarkState): number | null {
  return state === 'read' || state === 'archived' ? Date.now() : null;
}

function predicateForState(state: NrMarkState): string {
  return state === 'read' || state === 'archived' ? 'IS NULL' : 'IS NOT NULL';
}

export type MarkEventIdsStateProps = {
  db: DatabaseType;
  eventIds: string[];
  state: NrMarkState;
};

const MARK_EVENT_IDS_CHUNK_SIZE = 400;

export function markEventIdsState({
  db,
  eventIds,
  state,
}: MarkEventIdsStateProps): void {
  const ids = [...new Set(eventIds)];

  if (ids.length === 0) {
    return;
  }

  const column = markColumnForState(state);
  const value = markValueForState(state);

  // Read/unread cascade to thread context and activities (seeing a post
  // implies seeing its context). Archive/unarchive apply to exactly the
  // selected events so one item can be archived independently.
  const cascade = state === 'read' || state === 'unread';

  const markChunk = db.transaction((chunk: string[]) => {
    const selectedValues = chunk.map(() => '(?)').join(', ');

    const cte = `WITH selected(id) AS (
         VALUES ${selectedValues}
       ),
       related(id) AS (
         SELECT CASE
           WHEN context.type = 'object'
             THEN json_extract(context.value, '$.id')
           ELSE NULL
         END
         FROM nr_events e
         JOIN selected s ON s.id = e.id
         JOIN json_each(
           CASE WHEN json_valid(e.thread_context_json)
             AND json_type(e.thread_context_json) = 'array'
             THEN e.thread_context_json ELSE '[]' END
         ) context
         UNION
         SELECT CASE
           WHEN reference.type = 'object'
             THEN json_extract(reference.value, '$.id')
           ELSE NULL
         END
         FROM nr_events e
         JOIN selected s ON s.id = e.id
         JOIN json_each(
           CASE WHEN json_valid(e.referenced_events_json)
             AND json_type(e.referenced_events_json) = 'array'
             THEN e.referenced_events_json ELSE '[]' END
         ) reference
       ),
      targets(id) AS (
        SELECT id FROM selected
        ${
          cascade
            ? `UNION
        SELECT id FROM related
        WHERE typeof(id) = 'text' AND length(id) > 0
        UNION
        SELECT activity.activity_event_id
        FROM nr_activity_targets activity
        WHERE activity.target_event_id IN (
          SELECT id FROM selected
          UNION
          SELECT id FROM related WHERE typeof(id) = 'text' AND length(id) > 0
        )`
            : ''
        }
      )`;

    db.prepare(
      `${cte}
       UPDATE nr_events
       SET ${column} = ?
       WHERE id IN (SELECT id FROM targets)`,
    ).run(...chunk, value);

    if (state === 'read') {
      db.prepare(
        `${cte}
         INSERT OR REPLACE INTO nr_read_events (event_id, read_at)
         SELECT id, ?
         FROM targets
         WHERE typeof(id) = 'text' AND length(id) > 0`,
      ).run(...chunk, value);
    } else if (state === 'unread') {
      db.prepare(
        `${cte}
         DELETE FROM nr_read_events
         WHERE event_id IN (
           SELECT id
           FROM targets
           WHERE typeof(id) = 'text' AND length(id) > 0
         )`,
      ).run(...chunk);
    }
  });

  for (let index = 0; index < ids.length; index += MARK_EVENT_IDS_CHUNK_SIZE) {
    const chunk = ids.slice(index, index + MARK_EVENT_IDS_CHUNK_SIZE);
    markChunk(chunk);
  }
}

export function markEventState({
  db,
  eventId,
  state,
}: MarkEventStateProps): NrEvent | null {
  const existing = getNr(db, eventId);

  const activityIds = db
    .prepare(
      'SELECT activity_event_id FROM nr_activity_targets WHERE target_event_id = ?',
    )
    .all(eventId) as Array<{ activity_event_id: string }>;

  markEventIdsState({ db, eventIds: [eventId], state });

  if (!existing && activityIds.length === 0) {
    return null;
  }

  return existing
    ? getNr(db, eventId)
    : activityIds[0]
      ? getNr(db, activityIds[0].activity_event_id)
      : null;
}

export function markTaggedEventsRead({
  db,
  type,
  tag,
}: MarkTaggedEventsReadProps): MarkTaggedEventsReadResult {
  return markTaggedEventsState({
    db,
    type,
    tag,
    state: 'read',
  });
}

export function markTaggedEventsState({
  db,
  type,
  tag,
  state,
}: MarkTaggedEventsStateProps): MarkTaggedEventsReadResult {
  const markTagged = db.transaction(() => {
    const column = markColumnForState(state);
    const predicate = predicateForState(state);

    const rows = db
      .prepare(
        `SELECT e.id AS id
          FROM nr_event_tags t
          JOIN nr_events e ON e.id = t.event_id
          WHERE t.type = ? AND t.tag = ? AND e.${column} ${predicate}`,
      )
      .all(type, tag) as Array<{ id: string }>;

    markEventIdsState({
      db,
      eventIds: rows.map((row) => row.id),
      state,
    });

    return {
      type,
      tag,
      eventCount: rows.length,
    };
  });

  return markTagged.immediate();
}
