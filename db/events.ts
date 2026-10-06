import type { Database as DatabaseType } from 'bun:sqlite';

import type { NostrResolutionService } from '@src/nostr/resolution-service';

import { extractDirectActivityTargetId } from '../activity';
import { classifyEvent } from '../classifier';
import type {
  EventClassification,
  NostrEvent,
  NrEvent,
  ParsedNrEventResult,
} from '../commands/shared/types';
import { seedNostrEventsOrThrow } from '../nostr-resolution';

import {
  rowToNrEvent,
  type EventRow,
  type RecordNrSkippedEventProps,
  type SkippedEventRow,
} from './types';

export function hasNrEvent(db: DatabaseType, id: string): boolean {
  const row = db
    .prepare('SELECT 1 AS found FROM nr_events WHERE id = ? LIMIT 1')
    .get(id) as { found: number } | undefined;

  return row != null;
}

export function hasNrSkippedEvent(db: DatabaseType, id: string): boolean {
  const row = db
    .prepare(
      'SELECT 1 AS found FROM nr_skipped_events WHERE event_id = ? LIMIT 1',
    )
    .get(id) as { found: number } | undefined;

  return row != null;
}

export function recordNrSkippedEvent({
  db,
  event,
  classification,
}: RecordNrSkippedEventProps): SkippedEventRow {
  const skippedAt = Date.now();

  db.run(
    `
    INSERT INTO nr_skipped_events (
      event_id,
      pubkey,
      event_created_at,
      reason,
      model,
      skipped_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      pubkey = excluded.pubkey,
      event_created_at = excluded.event_created_at,
      reason = excluded.reason,
      model = excluded.model,
      skipped_at = excluded.skipped_at
  `,
    [
      event.id,
      event.pubkey,
      event.created_at,
      classification.skipReason,
      classification.model,
      skippedAt,
    ],
  );

  const row = db
    .prepare('SELECT * FROM nr_skipped_events WHERE event_id = ?')
    .get(event.id) as SkippedEventRow | undefined;

  if (!row) {
    throw new Error(`Failed to record skipped event ${event.id}`);
  }

  return row;
}

export function getEventRow(db: DatabaseType, id: string): EventRow | null {
  const row = db
    .prepare(
      `
      SELECT
        e.*,
        c.summary,
        c.model,
        c.classified_at,
        c.classification_json
      FROM nr_events e
      LEFT JOIN nr_classifications c ON c.event_id = e.id
      WHERE e.id = ?
    `,
    )
    .get(id) as EventRow | undefined;

  return row ?? null;
}

export function getNr(db: DatabaseType, id: string | number): NrEvent | null {
  const row = getEventRow(db, String(id));

  return row ? rowToNrEvent(row) : null;
}

type StoreClassificationProps = {
  db: DatabaseType;
  eventId: string;
  classification: EventClassification;
  now: number;
};

export function storeClassification({
  db,
  eventId,
  classification,
  now,
}: StoreClassificationProps): void {
  db.run('DELETE FROM nr_event_tags WHERE event_id = ?', [eventId]);

  db.run(
    `
    INSERT INTO nr_classifications (
      event_id,
      summary,
      model,
      classified_at,
      classification_json
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      summary = excluded.summary,
      model = excluded.model,
      classified_at = excluded.classified_at,
      classification_json = excluded.classification_json
  `,
    [
      eventId,
      classification.summary,
      classification.model,
      now,
      JSON.stringify(classification),
    ],
  );

  const insertTag = db.prepare(
    'INSERT OR IGNORE INTO nr_event_tags (event_id, type, tag) VALUES (?, ?, ?)',
  );

  for (const tag of classification.topics) {
    insertTag.run(eventId, 'topic', tag);
  }

  for (const tag of classification.moods) {
    insertTag.run(eventId, 'mood', tag);
  }
}

export type ParseAndStoreEventProps = {
  db: DatabaseType;
  event: NostrEvent;
  forceReclassify: boolean;
  relayHints: string[];
  threadContext: NostrEvent[];
  referencedEvents: NostrEvent[];
  nostrResolution: NostrResolutionService | null;
  classify: (
    event: NostrEvent,
  ) => Promise<EventClassification> | EventClassification;
};

export async function parseAndStoreEvent({
  db,
  event,
  forceReclassify,
  relayHints,
  threadContext,
  referencedEvents,
  nostrResolution,
  classify,
}: ParseAndStoreEventProps): Promise<ParsedNrEventResult> {
  if (nostrResolution) {
    await seedNostrEventsOrThrow({
      service: nostrResolution,
      events: [
        { event, relayHints },
        ...threadContext.map((item) => ({ event: item, relayHints: [] })),
        ...referencedEvents.map((item) => ({
          event: item,
          relayHints: [],
        })),
      ],
    });
  }

  const now = Date.now();
  const existing = getEventRow(db, event.id);

  db.run(
    `
    INSERT INTO nr_events (
      id,
      pubkey,
      kind,
      event_created_at,
      content,
      raw_json,
      inserted_at,
      read_at,
      relay_hints_json,
      thread_context_json,
      referenced_events_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      pubkey = excluded.pubkey,
      kind = excluded.kind,
      event_created_at = excluded.event_created_at,
      content = excluded.content,
      raw_json = excluded.raw_json,
      relay_hints_json = excluded.relay_hints_json,
      thread_context_json = excluded.thread_context_json,
      referenced_events_json = excluded.referenced_events_json
  `,
    [
      event.id,
      event.pubkey,
      event.kind,
      event.created_at,
      event.content,
      JSON.stringify(event),
      now,
      JSON.stringify([...new Set(relayHints)]),
      JSON.stringify(threadContext.map(({ id }) => ({ id }))),
      JSON.stringify(referencedEvents.map(({ id }) => ({ id }))),
    ],
  );

  db.run('DELETE FROM nr_activity_targets WHERE activity_event_id = ?', [
    event.id,
  ]);

  if (
    event.kind === 6 ||
    event.kind === 7 ||
    event.kind === 16 ||
    event.kind === 9735
  ) {
    const directTargetId = extractDirectActivityTargetId(event);

    const targetIds = directTargetId
      ? [directTargetId]
      : event.kind === 6 || event.kind === 16
        ? [
            ...new Set(
              [...threadContext, ...referencedEvents].map((item) => item.id),
            ),
          ]
        : [];

    const insertTarget = db.prepare(
      'INSERT OR IGNORE INTO nr_activity_targets (activity_event_id, target_event_id) VALUES (?, ?)',
    );

    for (const targetId of targetIds) {
      insertTarget.run(event.id, targetId);
    }

    db.run(
      `UPDATE nr_events
       SET read_at = COALESCE(
         read_at,
         (
           SELECT MAX(read_at)
           FROM (
             SELECT read_event.read_at
             FROM nr_activity_targets activity
             JOIN nr_read_events read_event ON read_event.event_id = activity.target_event_id
             WHERE activity.activity_event_id = ?
             UNION
             SELECT target.read_at
             FROM nr_activity_targets activity
             JOIN nr_events target ON target.id = activity.target_event_id
             WHERE activity.activity_event_id = ?
               AND target.read_at IS NOT NULL
           )
         )
       )
       WHERE id = ?`,
      [event.id, event.id, event.id],
    );

    db.run(
      `INSERT OR IGNORE INTO nr_read_events (event_id, read_at)
       SELECT id, read_at FROM nr_events WHERE id = ? AND read_at IS NOT NULL`,
      [event.id],
    );
  }

  const shouldClassify = forceReclassify || !existing?.classification_json;

  if (shouldClassify) {
    storeClassification({
      db,
      eventId: event.id,
      classification: await classify(event),
      now,
    });
  }

  const stored = getNr(db, event.id);

  if (!stored) {
    throw new Error(`Failed to store event ${event.id}`);
  }

  return {
    event: stored,
    inserted: !existing,
    reclassified: shouldClassify,
  };
}

export async function reevaluateEvent(
  db: DatabaseType,
  eventId: string,
): Promise<NrEvent | null> {
  const existing = getNr(db, eventId);

  if (!existing) {
    return null;
  }

  const event = JSON.parse(existing.raw_json) as NostrEvent;

  return (
    await parseAndStoreEvent({
      db,
      event,
      forceReclassify: true,
      relayHints: existing.relay_hints,
      threadContext: JSON.parse(existing.thread_context_json) as NostrEvent[],
      referencedEvents: JSON.parse(
        existing.referenced_events_json,
      ) as NostrEvent[],
      nostrResolution: null,
      classify: classifyEvent,
    })
  ).event;
}

export function listNrs(db: DatabaseType): NrEvent[] {
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
      LEFT JOIN nr_classifications c ON c.event_id = e.id
      ORDER BY e.event_created_at ASC
    `,
    )
    .all() as EventRow[];

  return rows.map(rowToNrEvent);
}
