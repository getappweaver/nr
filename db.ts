// ---------------------------------------------------------------------------
// plugins/nr/db.ts — open SQLite + Nostr event cache and classification store
// ---------------------------------------------------------------------------

import { join } from 'path';

import { Database, type Database as DatabaseType } from 'bun:sqlite';

import type { NostrResolutionService } from '@src/nostr/resolution-service';

import { classifyEvent } from './classifier';
import {
  categoryForNrEvent,
  normalizeNrFeedCategories,
  type NrFeedCategory,
} from './commands/list/categories';
import type {
  EventClassification,
  NostrEvent,
  NrEvent,
  NrFetchScope,
  NrFetchRelayCursor,
  NrFetchStatus,
  NrFetchWindow,
  NrInteraction,
  NrInteractionType,
  NrAudienceReaction,
  NrAuthorPreference,
  NrAuthorPreferenceValue,
  NrInterestSignal,
  NrInterestSignalType,
  NrListMode,
  NrListData,
  NrTagGroup,
  NrTaxonomyTerm,
  NrTaxonomyTermType,
  NrProfileEvent,
  ParsedNrEventResult,
} from './commands/shared/types';
import { seedNostrEventsOrThrow } from './nostr-resolution';
import { extractEventReferences } from './references';
import { createNrSettingsTable, getNrSettings } from './settings';
import { extractNip10References } from './thread-context';

type EventRow = {
  id: string;
  pubkey: string;
  kind: number;
  event_created_at: number;
  content: string;
  raw_json: string;
  inserted_at: number;
  read_at: number | null;
  archived_at: number | null;
  relay_hints_json: string | null;
  thread_context_json: string | null;
  referenced_events_json: string | null;
  summary: string | null;
  model: string | null;
  classified_at: number | null;
  classification_json: string | null;
};

type TagRow = {
  tag: string;
  count: number;
};

type FetchWindowRow = {
  id: number;
  since: number;
  until: number;
  scope: string;
  status: string;
  event_count: number;
  relay_count: number;
  author_count: number;
  error: string | null;
  created_at: number;
  updated_at: number;
};

type FetchRelayCursorRow = {
  since: number;
  until: number;
  scope: string;
  relay: string;
  authors_hash: string;
  authors_json: string;
  next_until: number;
  completed: number;
  fetched_event_count: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

type SkippedEventRow = {
  event_id: string;
  pubkey: string;
  event_created_at: number;
  reason: string | null;
  model: string | null;
  skipped_at: number;
};

type EvaluationQueueRow = {
  event_id: string;
  raw_event_json: string;
  relay_hints_json: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  error: string | null;
  created_at: number;
  updated_at: number;
  processing_started_at: number | null;
};

export type NrEvaluationQueueItem = {
  eventId: string;
  event: NostrEvent;
  relayHints: string[];
  attempts: number;
};

export type EnqueueNrEvaluationProps = {
  db: DatabaseType;
  event: NostrEvent;
  relayHints: string[];
};

export type RecoverNrEvaluationQueueProps = {
  db: DatabaseType;
  staleBeforeMs: number;
};

export type FinishNrEvaluationProps = {
  db: DatabaseType;
  eventId: string;
  error: string | null;
};

type InteractionRow = {
  interaction_event_id: string;
  target_event_id: string;
  user_pubkey: string;
  type: string;
  interaction_created_at: number;
  discovered_at: number;
  source: string;
};

type InterestSignalRow = {
  target_event_id: string;
  type: string;
  weight: number;
  topics_json: string;
  moods_json: string;
  source: string;
  created_at: number;
  updated_at: number;
};

type AuthorPreferenceRow = {
  pubkey: string;
  preference: string;
  created_at: number;
  updated_at: number;
};

type TaxonomyTermRow = {
  id: number;
  type: string;
  tag: string;
  description: string | null;
  active: number;
  created_at: number;
  updated_at: number;
};

export type RecordNrFetchWindowProps = {
  db: DatabaseType;
  since: number;
  until: number;
  scope: NrFetchScope;
  status: NrFetchStatus;
  eventCount: number;
  relayCount: number;
  authorCount: number;
  error: string | null;
};

export type ListNrFetchWindowsProps = {
  db: DatabaseType;
  since: number;
  until: number;
  scopes: NrFetchScope[] | null;
};

export type SaveNrFetchRelayCursorProps = {
  db: DatabaseType;
  since: number;
  until: number;
  scope: NrFetchScope;
  relay: string;
  authorsHash: string;
  authors: string[];
  nextUntil: number;
  completed: boolean;
  fetchedEventCount: number;
  lastError: string | null;
};

export type ListNrFetchRelayCursorsProps = {
  db: DatabaseType;
  since: number;
  until: number;
  scope: NrFetchScope;
};

export type RecordNrSkippedEventProps = {
  db: DatabaseType;
  event: NostrEvent;
  classification: EventClassification;
};

export type RecordNrInteractionProps = {
  db: DatabaseType;
  interactionEventId: string;
  targetEventId: string;
  userPubkey: string;
  type: NrInteractionType;
  interactionCreatedAt: number;
  source: 'web';
};

export type MarkTaggedEventsReadProps = {
  db: DatabaseType;
  type: 'topic' | 'mood';
  tag: string;
};

export type MarkTaggedEventsReadResult = {
  type: 'topic' | 'mood';
  tag: string;
  eventCount: number;
};

export type SyncNrTaxonomyTermsProps = {
  db: DatabaseType;
  type: NrTaxonomyTermType;
  activeTags: string[];
  newTag: string | null;
};

export type NrFollowsCache = {
  ownerPubkey: string;
  eventId: string;
  eventCreatedAt: number;
  fetchedAt: number;
  followPubkeys: string[];
};

function safeParseTags(raw: string | null): {
  topics: string[];
  moods: string[];
} {
  if (!raw) {
    return { topics: [], moods: [] };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<EventClassification>;

    return {
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
      moods: Array.isArray(parsed.moods) ? parsed.moods : [],
    };
  } catch {
    return { topics: [], moods: [] };
  }
}

function safeParseStringArray(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

function rowToNrEvent(row: EventRow): NrEvent {
  const parsed = safeParseTags(row.classification_json);

  return {
    id: row.id,
    pubkey: row.pubkey,
    kind: row.kind,
    event_created_at: row.event_created_at,
    content: row.content,
    raw_json: row.raw_json,
    inserted_at: row.inserted_at,
    read_at: row.read_at,
    archived_at: row.archived_at,
    relay_hints: safeParseStringArray(row.relay_hints_json),
    thread_context_json: row.thread_context_json ?? '[]',
    referenced_events_json: row.referenced_events_json ?? '[]',
    summary: row.summary ?? '',
    model: row.model ?? '',
    classified_at: row.classified_at ?? 0,
    classification_json: row.classification_json ?? '{}',
    topics: parsed.topics,
    moods: parsed.moods,
  };
}

function rowToNrFetchWindow(row: FetchWindowRow): NrFetchWindow {
  return {
    id: row.id,
    since: row.since,
    until: row.until,
    scope: row.scope as NrFetchScope,
    status: row.status as NrFetchStatus,
    eventCount: row.event_count,
    relayCount: row.relay_count,
    authorCount: row.author_count,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToNrFetchRelayCursor(row: FetchRelayCursorRow): NrFetchRelayCursor {
  return {
    since: row.since,
    until: row.until,
    scope: row.scope as NrFetchScope,
    relay: row.relay,
    authorsHash: row.authors_hash,
    authors: safeParseStringArray(row.authors_json),
    nextUntil: row.next_until,
    completed: row.completed === 1,
    fetchedEventCount: row.fetched_event_count,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToNrInteraction(row: InteractionRow): NrInteraction {
  return {
    interactionEventId: row.interaction_event_id,
    targetEventId: row.target_event_id,
    userPubkey: row.user_pubkey,
    type: row.type as NrInteractionType,
    interactionCreatedAt: row.interaction_created_at,
    discoveredAt: row.discovered_at,
    source: row.source as 'web',
  };
}

function rowToNrTaxonomyTerm(row: TaxonomyTermRow): NrTaxonomyTerm {
  return {
    id: row.id,
    type: row.type as NrTaxonomyTermType,
    tag: row.tag,
    description: row.description,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToNrInterestSignal(row: InterestSignalRow): NrInterestSignal {
  return {
    targetEventId: row.target_event_id,
    type: row.type as NrInterestSignalType,
    weight: row.weight,
    topics: safeParseStringArray(row.topics_json),
    moods: safeParseStringArray(row.moods_json),
    source: row.source as NrInterestSignal['source'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToNrAuthorPreference(row: AuthorPreferenceRow): NrAuthorPreference {
  return {
    pubkey: row.pubkey,
    preference: row.preference as NrAuthorPreferenceValue,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeTaxonomyTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function assertFetchWindowRange(since: number, until: number): void {
  if (!Number.isInteger(since) || !Number.isInteger(until) || since >= until) {
    throw new Error('Fetch window requires integer since < until timestamps.');
  }
}

export function createNrTable(db: DatabaseType): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS nr_events (
      id               TEXT    PRIMARY KEY,
      pubkey           TEXT    NOT NULL,
      kind             INTEGER NOT NULL,
      event_created_at INTEGER NOT NULL,
      content          TEXT    NOT NULL,
      raw_json         TEXT    NOT NULL,
      inserted_at      INTEGER NOT NULL,
      read_at          INTEGER,
      archived_at      INTEGER
    )
  `);

  ensureNrEventColumn(db, 'archived_at', 'INTEGER');
  ensureNrEventColumn(db, 'relay_hints_json', 'TEXT');
  ensureNrEventColumn(db, 'thread_context_json', 'TEXT');
  ensureNrEventColumn(db, 'referenced_events_json', 'TEXT');

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_classifications (
      event_id            TEXT    PRIMARY KEY REFERENCES nr_events(id) ON DELETE CASCADE,
      summary             TEXT    NOT NULL,
      model               TEXT    NOT NULL,
      classified_at       INTEGER NOT NULL,
      classification_json TEXT    NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_event_tags (
      event_id TEXT NOT NULL REFERENCES nr_events(id) ON DELETE CASCADE,
      type     TEXT NOT NULL CHECK (type IN ('topic', 'mood')),
      tag      TEXT NOT NULL,
      PRIMARY KEY (event_id, type, tag)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_taxonomy_terms (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT    NOT NULL CHECK (type IN ('topic', 'mood')),
      tag         TEXT    NOT NULL,
      description TEXT,
      active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      UNIQUE(type, tag)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_taxonomy_terms_active
    ON nr_taxonomy_terms(active, type, tag)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_follows_cache (
      owner_pubkey      TEXT PRIMARY KEY,
      event_id          TEXT    NOT NULL,
      event_created_at  INTEGER NOT NULL,
      raw_json          TEXT    NOT NULL,
      follow_pubkeys    TEXT    NOT NULL,
      fetched_at        INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_fetch_windows (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      since        INTEGER NOT NULL,
      until        INTEGER NOT NULL,
      scope        TEXT    NOT NULL,
      status       TEXT    NOT NULL CHECK (status IN ('fetched', 'partial', 'failed')),
      event_count  INTEGER NOT NULL DEFAULT 0,
      relay_count  INTEGER NOT NULL DEFAULT 0,
      author_count INTEGER NOT NULL DEFAULT 0,
      error        TEXT,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      UNIQUE(since, until, scope)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_fetch_windows_time
    ON nr_fetch_windows(since, until)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_fetch_windows_scope_time
    ON nr_fetch_windows(scope, since, until)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_fetch_relay_cursors (
      since               INTEGER NOT NULL,
      until               INTEGER NOT NULL,
      scope               TEXT    NOT NULL,
      relay               TEXT    NOT NULL,
      authors_hash        TEXT    NOT NULL,
      authors_json        TEXT    NOT NULL,
      next_until          INTEGER NOT NULL,
      completed           INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
      fetched_event_count INTEGER NOT NULL DEFAULT 0,
      last_error          TEXT,
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL,
      PRIMARY KEY (since, until, scope, relay, authors_hash)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_fetch_relay_cursors_window
    ON nr_fetch_relay_cursors(since, until, scope, completed)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_skipped_events (
      event_id         TEXT    PRIMARY KEY,
      pubkey           TEXT    NOT NULL,
      event_created_at INTEGER NOT NULL,
      reason           TEXT,
      model            TEXT,
      skipped_at       INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_evaluation_queue (
      event_id              TEXT PRIMARY KEY,
      raw_event_json        TEXT NOT NULL,
      relay_hints_json      TEXT NOT NULL,
      status                TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      attempts              INTEGER NOT NULL DEFAULT 0,
      error                 TEXT,
      created_at            INTEGER NOT NULL,
      updated_at            INTEGER NOT NULL,
      processing_started_at INTEGER
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_evaluation_queue_pending
    ON nr_evaluation_queue(status, created_at)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_skipped_events_created_at
    ON nr_skipped_events(event_created_at)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_interactions (
      interaction_event_id TEXT    PRIMARY KEY,
      target_event_id      TEXT    NOT NULL,
      user_pubkey          TEXT    NOT NULL,
      type                 TEXT    NOT NULL CHECK (type IN ('liked', 'replied', 'reposted', 'quoted')),
      interaction_created_at INTEGER NOT NULL,
      discovered_at        INTEGER NOT NULL,
      source               TEXT    NOT NULL CHECK (source IN ('web'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_list_filters (
      mode            TEXT PRIMARY KEY CHECK (mode IN ('timeline', 'for-you', 'profile')),
      categories_json TEXT NOT NULL,
      updated_at      INTEGER NOT NULL
    )
  `);

  migrateNrListFilterModes(db);

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_profile_events (
      id                     TEXT PRIMARY KEY,
      event_created_at       INTEGER NOT NULL,
      event_json             TEXT NOT NULL,
      referenced_events_json TEXT NOT NULL,
      cached_at              INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_profile_events_created_at
    ON nr_profile_events(event_created_at DESC)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_profile_cache_state (
      id              INTEGER PRIMARY KEY CHECK (id = 1),
      categories_json TEXT NOT NULL,
      updated_at      INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_activity_targets (
      activity_event_id TEXT NOT NULL REFERENCES nr_events(id) ON DELETE CASCADE,
      target_event_id   TEXT NOT NULL,
      PRIMARY KEY (activity_event_id, target_event_id)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_activity_targets_target
    ON nr_activity_targets(target_event_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_interactions_target
    ON nr_interactions(target_event_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_interactions_user_target_type
    ON nr_interactions(user_pubkey, target_event_id, type)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_interest_signals (
      target_event_id TEXT    NOT NULL,
      type            TEXT    NOT NULL CHECK (type IN ('like', 'reply', 'repost', 'quote', 'archive', 'local_like', 'local_dislike')),
      weight          INTEGER NOT NULL,
      topics_json     TEXT    NOT NULL,
      moods_json      TEXT    NOT NULL,
      source          TEXT    NOT NULL CHECK (source IN ('interaction', 'archive', 'private', 'seed')),
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (target_event_id, type)
    )
  `);

  ensureNrInterestSignalColumn(
    db,
    'source',
    "TEXT NOT NULL DEFAULT 'private' CHECK (source IN ('interaction', 'archive', 'private', 'seed'))",
  );

  migrateNrInterestSignalTypes(db);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_interest_signals_updated
    ON nr_interest_signals(updated_at DESC)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_author_preferences (
      pubkey     TEXT PRIMARY KEY,
      preference TEXT    NOT NULL CHECK (preference IN ('like', 'dislike')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_author_preferences_updated
    ON nr_author_preferences(updated_at DESC)
  `);

  backfillNrInterestSignals(db);
  refreshNrInterestSignalWeights(db);
}

function refreshNrInterestSignalWeights(db: DatabaseType): void {
  db.run(`
    UPDATE nr_interest_signals
    SET weight = CASE type
      WHEN 'like' THEN 1
      WHEN 'reply' THEN 2
      WHEN 'repost' THEN 3
      WHEN 'quote' THEN 2
      WHEN 'archive' THEN 5
      WHEN 'local_like' THEN 5
      WHEN 'local_dislike' THEN -5
      ELSE weight
    END
  `);
}

function ensureNrEventColumn(
  db: DatabaseType,
  name: string,
  definition: string,
): void {
  const columns = db.prepare('PRAGMA table_info(nr_events)').all() as Array<{
    name: string;
  }>;

  if (columns.some((column) => column.name === name)) {
    return;
  }

  db.run(`ALTER TABLE nr_events ADD COLUMN ${name} ${definition}`);
}

function ensureNrInterestSignalColumn(
  db: DatabaseType,
  name: string,
  definition: string,
): void {
  const columns = db
    .prepare('PRAGMA table_info(nr_interest_signals)')
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === name)) {
    return;
  }

  db.run(`ALTER TABLE nr_interest_signals ADD COLUMN ${name} ${definition}`);
}

function migrateNrInterestSignalTypes(db: DatabaseType): void {
  const table = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'nr_interest_signals'",
    )
    .get() as { sql: string } | null;

  if (table?.sql.includes("'local_like'")) {
    return;
  }

  db.transaction(() => {
    db.run(`
      CREATE TABLE nr_interest_signals_next (
        target_event_id TEXT    NOT NULL,
        type            TEXT    NOT NULL CHECK (type IN ('like', 'reply', 'repost', 'quote', 'archive', 'local_like', 'local_dislike')),
        weight          INTEGER NOT NULL,
        topics_json     TEXT    NOT NULL,
        moods_json      TEXT    NOT NULL,
        source          TEXT    NOT NULL CHECK (source IN ('interaction', 'archive', 'private', 'seed')),
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        PRIMARY KEY (target_event_id, type)
      )
    `);

    db.run(`
      INSERT INTO nr_interest_signals_next (
        target_event_id, type, weight, topics_json, moods_json, source, created_at, updated_at
      )
      SELECT
        target_event_id,
        CASE
          WHEN type = 'dislike' THEN 'local_dislike'
          WHEN type = 'like' AND source = 'private' THEN 'local_like'
          ELSE type
        END,
        weight,
        topics_json,
        moods_json,
        source,
        created_at,
        updated_at
      FROM nr_interest_signals
    `);

    db.run('DROP TABLE nr_interest_signals');

    db.run(
      'ALTER TABLE nr_interest_signals_next RENAME TO nr_interest_signals',
    );
  })();
}

function migrateNrListFilterModes(db: DatabaseType): void {
  const table = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'nr_list_filters'",
    )
    .get() as { sql: string } | null;

  if (table?.sql.includes("'for-you'")) {
    return;
  }

  db.transaction(() => {
    db.run(`
      CREATE TABLE nr_list_filters_next (
        mode            TEXT PRIMARY KEY CHECK (mode IN ('timeline', 'for-you', 'profile')),
        categories_json TEXT NOT NULL,
        updated_at      INTEGER NOT NULL
      )
    `);

    db.run(`
      INSERT INTO nr_list_filters_next (mode, categories_json, updated_at)
      SELECT mode, categories_json, updated_at
      FROM nr_list_filters
    `);

    db.run(`
      INSERT INTO nr_list_filters_next (mode, categories_json, updated_at)
      SELECT 'for-you', categories_json, updated_at
      FROM nr_list_filters
      WHERE mode = 'timeline'
    `);

    db.run('DROP TABLE nr_list_filters');
    db.run('ALTER TABLE nr_list_filters_next RENAME TO nr_list_filters');
  })();
}

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

function rowToNrEvaluationQueueItem(
  row: EvaluationQueueRow,
): NrEvaluationQueueItem | null {
  try {
    const event = JSON.parse(row.raw_event_json) as NostrEvent;

    return {
      eventId: row.event_id,
      event,
      relayHints: safeParseStringArray(row.relay_hints_json),
      attempts: row.attempts,
    };
  } catch {
    return null;
  }
}

export function enqueueNrEvaluation({
  db,
  event,
  relayHints,
}: EnqueueNrEvaluationProps): boolean {
  return db.transaction(() => {
    const existing = db
      .prepare(
        'SELECT relay_hints_json, status FROM nr_evaluation_queue WHERE event_id = ?',
      )
      .get(event.id) as
      | { relay_hints_json: string; status: EvaluationQueueRow['status'] }
      | undefined;

    const now = Date.now();

    const hints = [
      ...new Set([
        ...(existing ? safeParseStringArray(existing.relay_hints_json) : []),
        ...relayHints,
      ]),
    ];

    if (!existing) {
      db.run(
        `INSERT INTO nr_evaluation_queue (
          event_id, raw_event_json, relay_hints_json, status, attempts, error, created_at, updated_at, processing_started_at
        ) VALUES (?, ?, ?, 'pending', 0, NULL, ?, ?, NULL)`,
        [event.id, JSON.stringify(event), JSON.stringify(hints), now, now],
      );

      db.run(
        `DELETE FROM nr_evaluation_queue
         WHERE event_id IN (
           SELECT event_id
           FROM nr_evaluation_queue
           WHERE status = 'completed'
           ORDER BY updated_at DESC
           LIMIT -1 OFFSET ?
         )`,
        [NR_EVALUATION_QUEUE_COMPLETED_LIMIT],
      );

      return true;
    }

    db.run(
      `UPDATE nr_evaluation_queue
       SET raw_event_json = ?,
           relay_hints_json = ?,
           status = CASE WHEN status = 'failed' THEN 'pending' ELSE status END,
           error = CASE WHEN status = 'failed' THEN NULL ELSE error END,
           processing_started_at = CASE WHEN status = 'failed' THEN NULL ELSE processing_started_at END,
           updated_at = ?
       WHERE event_id = ?`,
      [JSON.stringify(event), JSON.stringify(hints), now, event.id],
    );

    db.run(
      `DELETE FROM nr_evaluation_queue
       WHERE event_id IN (
         SELECT event_id
         FROM nr_evaluation_queue
         WHERE status = 'completed'
         ORDER BY updated_at DESC
         LIMIT -1 OFFSET ?
       )`,
      [NR_EVALUATION_QUEUE_COMPLETED_LIMIT],
    );

    return false;
  })();
}

export function recoverNrEvaluationQueue({
  db,
  staleBeforeMs,
}: RecoverNrEvaluationQueueProps): number {
  const result = db.run(
    `UPDATE nr_evaluation_queue
     SET status = 'pending',
         error = 'Recovered stale processing claim.',
         processing_started_at = NULL,
         updated_at = ?
     WHERE status = 'processing' AND processing_started_at < ?`,
    [Date.now(), staleBeforeMs],
  );

  return result.changes;
}

export function claimNrEvaluation(
  db: DatabaseType,
): NrEvaluationQueueItem | null {
  return db.transaction(() => {
    const row = db
      .prepare(
        `SELECT * FROM nr_evaluation_queue
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .get() as EvaluationQueueRow | undefined;

    if (!row) {
      return null;
    }

    const now = Date.now();

    db.run(
      `UPDATE nr_evaluation_queue
       SET status = 'processing', attempts = attempts + 1, processing_started_at = ?, updated_at = ?
       WHERE event_id = ? AND status = 'pending'`,
      [now, now, row.event_id],
    );

    const claimed = db
      .prepare('SELECT * FROM nr_evaluation_queue WHERE event_id = ?')
      .get(row.event_id) as EvaluationQueueRow | undefined;

    const item = claimed ? rowToNrEvaluationQueueItem(claimed) : null;

    if (item) {
      return item;
    }

    db.run(
      `UPDATE nr_evaluation_queue
       SET status = 'failed', error = 'Stored queue event is invalid JSON.', processing_started_at = NULL, updated_at = ?
       WHERE event_id = ?`,
      [Date.now(), row.event_id],
    );

    return null;
  })();
}

export function completeNrEvaluation({
  db,
  eventId,
  error,
}: FinishNrEvaluationProps): void {
  db.run(
    `UPDATE nr_evaluation_queue
     SET status = 'completed', error = ?, processing_started_at = NULL, updated_at = ?
     WHERE event_id = ? AND status = 'processing'`,
    [error, Date.now(), eventId],
  );
}

export function failNrEvaluation({
  db,
  eventId,
  error,
}: FinishNrEvaluationProps): void {
  db.run(
    `UPDATE nr_evaluation_queue
     SET status = 'failed', error = ?, processing_started_at = NULL, updated_at = ?
     WHERE event_id = ? AND status = 'processing'`,
    [error, Date.now(), eventId],
  );
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

export function recordNrInteraction({
  db,
  interactionEventId,
  targetEventId,
  userPubkey,
  type,
  interactionCreatedAt,
  source,
}: RecordNrInteractionProps): NrInteraction {
  const discoveredAt = Date.now();

  db.run(
    `
    INSERT INTO nr_interactions (
      interaction_event_id,
      target_event_id,
      user_pubkey,
      type,
      interaction_created_at,
      discovered_at,
      source
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(interaction_event_id) DO UPDATE SET
      target_event_id = excluded.target_event_id,
      user_pubkey = excluded.user_pubkey,
      type = excluded.type,
      interaction_created_at = excluded.interaction_created_at,
      discovered_at = excluded.discovered_at,
      source = excluded.source
  `,
    [
      interactionEventId,
      targetEventId,
      userPubkey,
      type,
      interactionCreatedAt,
      discoveredAt,
      source,
    ],
  );

  const row = db
    .prepare('SELECT * FROM nr_interactions WHERE interaction_event_id = ?')
    .get(interactionEventId) as InteractionRow | undefined;

  if (!row) {
    throw new Error(`Failed to record interaction ${interactionEventId}`);
  }

  return rowToNrInteraction(row);
}

export function listNrInteractions(db: DatabaseType): NrInteraction[] {
  const rows = db
    .prepare(
      `
      SELECT *
      FROM nr_interactions
      ORDER BY interaction_created_at DESC
    `,
    )
    .all() as InteractionRow[];

  return rows.map(rowToNrInteraction);
}

export function listNrAudienceReactions(
  db: DatabaseType,
  targetEventId: string,
): NrAudienceReaction[] {
  const rows = db
    .prepare(
      `SELECT event.pubkey, event.content, event.event_created_at
       FROM nr_activity_targets target
       JOIN nr_events event ON event.id = target.activity_event_id
       WHERE target.target_event_id = ? AND event.kind = 7
       ORDER BY event.event_created_at DESC`,
    )
    .all(targetEventId) as Array<{
    pubkey: string;
    content: string;
    event_created_at: number;
  }>;

  const byPubkey = new Map<string, NrAudienceReaction>();

  for (const row of rows) {
    if (!byPubkey.has(row.pubkey)) {
      byPubkey.set(row.pubkey, {
        pubkey: row.pubkey,
        content: row.content,
        createdAt: row.event_created_at,
      });
    }
  }

  return [...byPubkey.values()];
}

const NR_INTEREST_WEIGHTS: Record<NrInterestSignalType, number> = {
  like: 1,
  reply: 2,
  repost: 3,
  quote: 2,
  archive: 5,
  local_like: 5,
  local_dislike: -5,
};

const NR_EVALUATION_QUEUE_COMPLETED_LIMIT = 10_000;

function interestTags({
  db,
  targetEventId,
  type,
}: {
  db: DatabaseType;
  targetEventId: string;
  type: 'topic' | 'mood';
}): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT tag
       FROM (
         SELECT tag.tag
         FROM nr_event_tags tag
         WHERE tag.event_id = ? AND tag.type = ?
         UNION
         SELECT tag.tag
         FROM nr_activity_targets activity
         JOIN nr_event_tags tag ON tag.event_id = activity.activity_event_id
         WHERE activity.target_event_id = ? AND tag.type = ?
       )
       ORDER BY tag COLLATE NOCASE ASC`,
    )
    .all(targetEventId, type, targetEventId, type) as Array<{ tag: string }>;

  return rows.map((row) => row.tag);
}

export function recordNrInterestSignal({
  db,
  targetEventId,
  type,
  createdAt,
  topics: providedTopics,
  moods: providedMoods,
  source,
}: {
  db: DatabaseType;
  targetEventId: string;
  type: NrInterestSignalType;
  createdAt: number;
  topics: string[] | null;
  moods: string[] | null;
  source: NrInterestSignal['source'];
}): NrInterestSignal {
  const now = Date.now();

  const topics =
    providedTopics ?? interestTags({ db, targetEventId, type: 'topic' });

  const moods =
    providedMoods ?? interestTags({ db, targetEventId, type: 'mood' });

  db.run(
    `INSERT INTO nr_interest_signals (
       target_event_id, type, weight, topics_json, moods_json, source, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(target_event_id, type) DO UPDATE SET
       weight = excluded.weight,
       topics_json = excluded.topics_json,
       moods_json = excluded.moods_json,
       source = excluded.source,
       updated_at = excluded.updated_at`,
    [
      targetEventId,
      type,
      NR_INTEREST_WEIGHTS[type],
      JSON.stringify(topics),
      JSON.stringify(moods),
      source,
      createdAt,
      now,
    ],
  );

  const row = db
    .prepare(
      'SELECT * FROM nr_interest_signals WHERE target_event_id = ? AND type = ?',
    )
    .get(targetEventId, type) as InterestSignalRow | null;

  if (!row) {
    throw new Error(`Failed to record ${type} signal for ${targetEventId}`);
  }

  return rowToNrInterestSignal(row);
}

export function listNrInterestSignals(db: DatabaseType): NrInterestSignal[] {
  return (
    db
      .prepare(
        'SELECT * FROM nr_interest_signals ORDER BY updated_at DESC, target_event_id ASC',
      )
      .all() as InterestSignalRow[]
  ).map(rowToNrInterestSignal);
}

export function clearSeededNrInterestSignals(db: DatabaseType): number {
  const existing = db
    .prepare(
      "SELECT COUNT(*) AS count FROM nr_interest_signals WHERE source = 'seed'",
    )
    .get() as { count: number };

  db.run("DELETE FROM nr_interest_signals WHERE source = 'seed'");

  return existing.count;
}

export function setNrLocalPreference({
  db,
  targetEventId,
  preference,
}: {
  db: DatabaseType;
  targetEventId: string;
  preference: 'like' | 'dislike' | 'none';
}): NrInterestSignal | null {
  return db.transaction(() => {
    db.run(
      `DELETE FROM nr_interest_signals
       WHERE target_event_id = ?
         AND type IN ('local_like', 'local_dislike')`,
      [targetEventId],
    );

    if (preference === 'none') {
      return null;
    }

    return recordNrInterestSignal({
      db,
      targetEventId,
      type: preference === 'like' ? 'local_like' : 'local_dislike',
      createdAt: Date.now(),
      topics: null,
      moods: null,
      source: 'private',
    });
  })();
}

export function setNrAuthorPreference({
  db,
  pubkey,
  preference,
}: {
  db: DatabaseType;
  pubkey: string;
  preference: NrAuthorPreferenceValue | 'none';
}): NrAuthorPreference | null {
  const normalizedPubkey = pubkey.trim().toLowerCase();

  if (!normalizedPubkey) {
    return null;
  }

  return db.transaction(() => {
    const now = Date.now();

    if (preference === 'none') {
      db.run('DELETE FROM nr_author_preferences WHERE pubkey = ?', [
        normalizedPubkey,
      ]);

      return null;
    }

    db.run(
      `INSERT INTO nr_author_preferences (pubkey, preference, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(pubkey) DO UPDATE SET
         preference = excluded.preference,
         updated_at = excluded.updated_at`,
      [normalizedPubkey, preference, now, now],
    );

    const row = db
      .prepare('SELECT * FROM nr_author_preferences WHERE pubkey = ?')
      .get(normalizedPubkey) as AuthorPreferenceRow | null;

    return row ? rowToNrAuthorPreference(row) : null;
  })();
}

export function listNrAuthorPreferences(
  db: DatabaseType,
): NrAuthorPreference[] {
  return (
    db
      .prepare(
        'SELECT * FROM nr_author_preferences ORDER BY updated_at DESC, pubkey ASC',
      )
      .all() as AuthorPreferenceRow[]
  ).map(rowToNrAuthorPreference);
}

function backfillNrInterestSignals(db: DatabaseType): void {
  const interactionTypes: Record<NrInteractionType, NrInterestSignalType> = {
    liked: 'like',
    replied: 'reply',
    reposted: 'repost',
    quoted: 'quote',
  };

  const interactions = db
    .prepare(
      `SELECT target_event_id, type, interaction_created_at
       FROM nr_interactions
       ORDER BY interaction_created_at ASC`,
    )
    .all() as Array<{
    target_event_id: string;
    type: NrInteractionType;
    interaction_created_at: number;
  }>;

  for (const interaction of interactions) {
    recordNrInterestSignal({
      db,
      targetEventId: interaction.target_event_id,
      type: interactionTypes[interaction.type],
      createdAt: interaction.interaction_created_at * 1000,
      topics: null,
      moods: null,
      source: 'interaction',
    });
  }

  const archivedTargets = db
    .prepare(
      `SELECT DISTINCT
         COALESCE(activity.target_event_id, event.id) AS target_event_id,
         event.archived_at
       FROM nr_events event
       LEFT JOIN nr_activity_targets activity
         ON activity.activity_event_id = event.id
       WHERE event.archived_at IS NOT NULL`,
    )
    .all() as Array<{ target_event_id: string; archived_at: number }>;

  for (const archived of archivedTargets) {
    recordNrInterestSignal({
      db,
      targetEventId: archived.target_event_id,
      type: 'archive',
      createdAt: archived.archived_at,
      topics: null,
      moods: null,
      source: 'archive',
    });
  }
}

export function listNrTaxonomyTerms(db: DatabaseType): NrTaxonomyTerm[] {
  const rows = db
    .prepare(
      `
      SELECT *
      FROM nr_taxonomy_terms
      ORDER BY type ASC, tag COLLATE NOCASE ASC
    `,
    )
    .all() as TaxonomyTermRow[];

  return rows.map(rowToNrTaxonomyTerm);
}

export function listActiveNrTaxonomyTerms({
  db,
  type,
}: {
  db: DatabaseType;
  type: NrTaxonomyTermType;
}): NrTaxonomyTerm[] {
  const rows = db
    .prepare(
      `
      SELECT *
      FROM nr_taxonomy_terms
      WHERE active = 1 AND type = ?
      ORDER BY tag COLLATE NOCASE ASC
    `,
    )
    .all(type) as TaxonomyTermRow[];

  return rows.map(rowToNrTaxonomyTerm);
}

export function syncNrTaxonomyTerms({
  db,
  type,
  activeTags,
  newTag,
}: SyncNrTaxonomyTermsProps): NrTaxonomyTerm[] {
  const now = Date.now();

  const desiredTags = new Set(
    activeTags.map(normalizeTaxonomyTag).filter((tag) => tag.length > 0),
  );

  const normalizedNewTag = newTag ? normalizeTaxonomyTag(newTag) : '';

  if (normalizedNewTag.length > 0) {
    desiredTags.add(normalizedNewTag);
  }

  db.run(
    'UPDATE nr_taxonomy_terms SET active = 0, updated_at = ? WHERE type = ?',
    [now, type],
  );

  const upsert = db.prepare(
    `
    INSERT INTO nr_taxonomy_terms (
      type,
      tag,
      description,
      active,
      created_at,
      updated_at
    ) VALUES (?, ?, NULL, 1, ?, ?)
    ON CONFLICT(type, tag) DO UPDATE SET
      active = 1,
      updated_at = excluded.updated_at
  `,
  );

  for (const tag of desiredTags) {
    upsert.run(type, tag, now, now);
  }

  return listActiveNrTaxonomyTerms({ db, type });
}

function parseFollowPubkeys(event: NostrEvent): string[] {
  return [
    ...new Set(
      event.tags
        .filter((tag) => tag[0] === 'p' && typeof tag[1] === 'string')
        .map((tag) => tag[1]!.trim())
        .filter(Boolean),
    ),
  ];
}

export function storeFollowsCache({
  db,
  ownerPubkey,
  event,
}: {
  db: DatabaseType;
  ownerPubkey: string;
  event: NostrEvent;
}): NrFollowsCache {
  const followPubkeys = parseFollowPubkeys(event);
  const fetchedAt = Date.now();

  db.run(
    `
    INSERT INTO nr_follows_cache (
      owner_pubkey,
      event_id,
      event_created_at,
      raw_json,
      follow_pubkeys,
      fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_pubkey) DO UPDATE SET
      event_id = excluded.event_id,
      event_created_at = excluded.event_created_at,
      raw_json = excluded.raw_json,
      follow_pubkeys = excluded.follow_pubkeys,
      fetched_at = excluded.fetched_at
  `,
    [
      ownerPubkey,
      event.id,
      event.created_at,
      JSON.stringify(event),
      JSON.stringify(followPubkeys),
      fetchedAt,
    ],
  );

  return {
    ownerPubkey,
    eventId: event.id,
    eventCreatedAt: event.created_at,
    fetchedAt,
    followPubkeys,
  };
}

export function getFollowsCache(
  db: DatabaseType,
  ownerPubkey: string,
): NrFollowsCache | null {
  const row = db
    .prepare(
      `
      SELECT
        owner_pubkey,
        event_id,
        event_created_at,
        follow_pubkeys,
        fetched_at
      FROM nr_follows_cache
      WHERE owner_pubkey = ?
    `,
    )
    .get(ownerPubkey) as
    | {
        owner_pubkey: string;
        event_id: string;
        event_created_at: number;
        follow_pubkeys: string;
        fetched_at: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    ownerPubkey: row.owner_pubkey,
    eventId: row.event_id,
    eventCreatedAt: row.event_created_at,
    fetchedAt: row.fetched_at,
    followPubkeys: JSON.parse(row.follow_pubkeys) as string[],
  };
}

export function recordNrFetchWindow({
  db,
  since,
  until,
  scope,
  status,
  eventCount,
  relayCount,
  authorCount,
  error,
}: RecordNrFetchWindowProps): NrFetchWindow {
  assertFetchWindowRange(since, until);

  const now = Date.now();

  db.run(
    `
    INSERT INTO nr_fetch_windows (
      since,
      until,
      scope,
      status,
      event_count,
      relay_count,
      author_count,
      error,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(since, until, scope) DO UPDATE SET
      status = excluded.status,
      event_count = excluded.event_count,
      relay_count = excluded.relay_count,
      author_count = excluded.author_count,
      error = excluded.error,
      updated_at = excluded.updated_at
  `,
    [
      since,
      until,
      scope,
      status,
      eventCount,
      relayCount,
      authorCount,
      error,
      now,
      now,
    ],
  );

  const row = db
    .prepare(
      `
      SELECT *
      FROM nr_fetch_windows
      WHERE since = ? AND until = ? AND scope = ?
    `,
    )
    .get(since, until, scope) as FetchWindowRow | undefined;

  if (!row) {
    throw new Error('Failed to record fetch window.');
  }

  return rowToNrFetchWindow(row);
}

export function listNrFetchWindows({
  db,
  since,
  until,
  scopes,
}: ListNrFetchWindowsProps): NrFetchWindow[] {
  assertFetchWindowRange(since, until);

  const scopeFilter = scopes && scopes.length > 0;

  const scopePlaceholders = scopeFilter
    ? ` AND scope IN (${scopes.map(() => '?').join(', ')})`
    : '';

  const rows = db
    .prepare(
      `
      SELECT *
      FROM nr_fetch_windows
      WHERE until > ? AND since < ?${scopePlaceholders}
      ORDER BY since DESC, until DESC, scope ASC
    `,
    )
    .all(
      ...(scopeFilter ? [since, until, ...scopes] : [since, until]),
    ) as FetchWindowRow[];

  return rows.map(rowToNrFetchWindow);
}

export function saveNrFetchRelayCursor({
  db,
  since,
  until,
  scope,
  relay,
  authorsHash,
  authors,
  nextUntil,
  completed,
  fetchedEventCount,
  lastError,
}: SaveNrFetchRelayCursorProps): NrFetchRelayCursor {
  assertFetchWindowRange(since, until);

  if (!Number.isInteger(nextUntil) || nextUntil < since || nextUntil > until) {
    throw new Error('Fetch relay cursor requires nextUntil inside its window.');
  }

  if (!Number.isInteger(fetchedEventCount) || fetchedEventCount < 0) {
    throw new Error('Fetch relay cursor requires a non-negative event count.');
  }

  const now = Date.now();

  db.run(
    `
    INSERT INTO nr_fetch_relay_cursors (
      since,
      until,
      scope,
      relay,
      authors_hash,
      authors_json,
      next_until,
      completed,
      fetched_event_count,
      last_error,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(since, until, scope, relay, authors_hash) DO UPDATE SET
      authors_json = excluded.authors_json,
      next_until = excluded.next_until,
      completed = excluded.completed,
      fetched_event_count = excluded.fetched_event_count,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `,
    [
      since,
      until,
      scope,
      relay,
      authorsHash,
      JSON.stringify(authors),
      nextUntil,
      completed ? 1 : 0,
      fetchedEventCount,
      lastError,
      now,
      now,
    ],
  );

  const row = db
    .prepare(
      `
      SELECT *
      FROM nr_fetch_relay_cursors
      WHERE since = ? AND until = ? AND scope = ? AND relay = ? AND authors_hash = ?
    `,
    )
    .get(since, until, scope, relay, authorsHash) as
    | FetchRelayCursorRow
    | undefined;

  if (!row) {
    throw new Error('Failed to save fetch relay cursor.');
  }

  return rowToNrFetchRelayCursor(row);
}

export function listNrFetchRelayCursors({
  db,
  since,
  until,
  scope,
}: ListNrFetchRelayCursorsProps): NrFetchRelayCursor[] {
  assertFetchWindowRange(since, until);

  const rows = db
    .prepare(
      `
      SELECT *
      FROM nr_fetch_relay_cursors
      WHERE since = ? AND until = ? AND scope = ?
      ORDER BY relay ASC, authors_hash ASC
    `,
    )
    .all(since, until, scope) as FetchRelayCursorRow[];

  return rows.map(rowToNrFetchRelayCursor);
}

function getEventRow(db: DatabaseType, id: string): EventRow | null {
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

function storeClassification({
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

type ParseAndStoreEventProps = {
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

  if (event.kind !== 1) {
    const targetIds = [
      ...new Set(
        [...threadContext, ...referencedEvents].map((item) => item.id),
      ),
    ];

    db.run('DELETE FROM nr_activity_targets WHERE activity_event_id = ?', [
      event.id,
    ]);

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
           SELECT MAX(target.read_at)
           FROM nr_activity_targets activity
           JOIN nr_events target ON target.id = activity.target_event_id
           WHERE activity.activity_event_id = ?
             AND target.read_at IS NOT NULL
         )
       )
       WHERE id = ?`,
      [event.id, event.id],
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

export type NrMarkState = 'read' | 'unread' | 'archived' | 'unarchived';

type MarkEventStateProps = {
  db: DatabaseType;
  eventId: string;
  state: NrMarkState;
};

type MarkTaggedEventsStateProps = {
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

type MarkEventIdsStateProps = {
  db: DatabaseType;
  eventIds: string[];
  state: NrMarkState;
};

const MARK_EVENT_IDS_CHUNK_SIZE = 400;

function markEventIdsState({
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

  for (let index = 0; index < ids.length; index += MARK_EVENT_IDS_CHUNK_SIZE) {
    const chunk = ids.slice(index, index + MARK_EVENT_IDS_CHUNK_SIZE);
    const selectedValues = chunk.map(() => '(?)').join(', ');

    db.prepare(
      `WITH selected(id) AS (
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
         UNION
         SELECT id FROM related
         WHERE typeof(id) = 'text' AND length(id) > 0
         UNION
         SELECT activity.activity_event_id
         FROM nr_activity_targets activity
         JOIN selected s ON s.id = activity.target_event_id
       )
       UPDATE nr_events
       SET ${column} = ?
       WHERE id IN (SELECT id FROM targets)`,
    ).run(...chunk, value);
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

  if (!existing && activityIds.length === 0) {
    return null;
  }

  markEventIdsState({ db, eventIds: [eventId], state });

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
        `SELECT DISTINCT e.id AS id
         FROM nr_events e
         JOIN nr_event_tags t ON t.event_id = e.id
         WHERE e.${column} ${predicate} AND t.type = ? AND t.tag = ?`,
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

function relatedEventIds(rawJson: string): string[] {
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

function eventHasCompleteContext(event: NrEvent): boolean {
  try {
    const rawEvent = JSON.parse(event.raw_json) as NostrEvent;
    const threadIds = new Set(relatedEventIds(event.thread_context_json));

    const referencedIds = new Set(
      relatedEventIds(event.referenced_events_json),
    );

    return (
      extractNip10References(rawEvent).every((reference) =>
        threadIds.has(reference.id),
      ) &&
      extractEventReferences(event.content).every((reference) =>
        referencedIds.has(reference.id),
      )
    );
  } catch {
    return false;
  }
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

function listModePredicate(mode: NrListMode): string {
  return mode === 'archive' ? 'e.archived_at IS NOT NULL' : 'e.read_at IS NULL';
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

type ListTagsProps = {
  db: DatabaseType;
  type: 'topic' | 'mood';
  mode: NrListMode;
};

function listTags({ db, type, mode }: ListTagsProps): TagRow[] {
  const predicate = listModePredicate(mode);

  return db
    .prepare(
      `
      SELECT t.tag AS tag, COUNT(DISTINCT e.id) AS count
      FROM nr_event_tags t
      JOIN nr_events e ON e.id = t.event_id
      WHERE t.type = ? AND ${predicate}
      GROUP BY t.tag
      ORDER BY count DESC, t.tag COLLATE NOCASE ASC
    `,
    )
    .all(type) as TagRow[];
}

type ListEventsForTagProps = {
  db: DatabaseType;
  type: 'topic' | 'mood';
  tag: string;
  hiddenEventIds: Set<string>;
  mode: NrListMode;
  categories: NrFeedCategory[];
};

function listEventsForTag({
  db,
  type,
  tag,
  hiddenEventIds,
  mode,
  categories,
}: ListEventsForTagProps): NrEvent[] {
  const predicate = listModePredicate(mode);

  const unreadTargetPredicate =
    mode === 'archive'
      ? ''
      : `AND NOT EXISTS (
          SELECT 1
          FROM nr_activity_targets activity_target
          JOIN nr_events target ON target.id = activity_target.target_event_id
          WHERE activity_target.activity_event_id = e.id
            AND target.read_at IS NOT NULL
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
      WHERE t.type = ? AND t.tag = ? AND ${predicate} ${unreadTargetPredicate}
      ORDER BY e.event_created_at DESC
    `,
    )
    .all(type, tag) as EventRow[];

  return rows.map(rowToNrEvent).filter((event) => {
    if (
      hiddenEventIds.has(event.id) ||
      (event.kind === 1 && !eventHasCompleteContext(event))
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

type BuildGroupsProps = {
  db: DatabaseType;
  type: 'topic' | 'mood';
  hiddenEventIds: Set<string>;
  mode: NrListMode;
  categories: NrFeedCategory[];
};

function buildGroups({
  db,
  type,
  hiddenEventIds,
  mode,
  categories,
}: BuildGroupsProps): NrTagGroup[] {
  return listTags({ db, type, mode })
    .map((row) => {
      const events = listEventsForTag({
        db,
        type,
        tag: row.tag,
        hiddenEventIds,
        mode,
        categories,
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

function relatedEventIdsForMode(
  db: DatabaseType,
  mode: NrListMode,
): Set<string> {
  const predicate = listModePredicate(mode);

  const rows = db
    .prepare(
      `
      SELECT thread_context_json, referenced_events_json
      FROM nr_events e
      WHERE ${predicate}
    `,
    )
    .all() as Array<{
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

type GetNrListDataProps = {
  db: DatabaseType;
  mode: NrListMode;
};

function scoringTopics(topics: string[]): string[] {
  return [
    ...new Set(
      topics
        .map((topic) => topic.trim().toLowerCase())
        .filter((topic) => topic && topic !== 'general'),
    ),
  ];
}

export function buildNrTopicAffinities(
  signals: NrInterestSignal[],
): Map<string, number> {
  const affinities = new Map<string, number>();

  for (const signal of signals) {
    const topics = scoringTopics(signal.topics);

    if (topics.length === 0) {
      continue;
    }

    const contribution = signal.weight / topics.length;

    for (const topic of topics) {
      affinities.set(topic, (affinities.get(topic) ?? 0) + contribution);
    }
  }

  return affinities;
}

const NR_AUTHOR_PREFERENCE_WEIGHTS: Record<NrAuthorPreferenceValue, number> = {
  like: 2,
  dislike: -6,
};

export function buildNrAuthorAffinities(
  preferences: NrAuthorPreference[],
): Map<string, number> {
  const affinities = new Map<string, number>();

  for (const preference of preferences) {
    affinities.set(
      preference.pubkey.toLowerCase(),
      NR_AUTHOR_PREFERENCE_WEIGHTS[preference.preference],
    );
  }

  return affinities;
}

type ScoreNrEventForYouProps = {
  event: NrEvent;
  topicAffinities: ReadonlyMap<string, number>;
  authorAffinities: ReadonlyMap<string, number>;
};

export function scoreNrEventForYou({
  event,
  topicAffinities,
  authorAffinities,
}: ScoreNrEventForYouProps): number {
  const topics = scoringTopics(event.topics);
  const authorScore = authorAffinities.get(event.pubkey.toLowerCase()) ?? 0;

  if (topics.length === 0) {
    return authorScore;
  }

  const total = topics.reduce(
    (score, topic) => score + (topicAffinities.get(topic) ?? 0),
    0,
  );

  return total / topics.length + authorScore;
}

export function getNrListData({ db, mode }: GetNrListDataProps): NrListData {
  const nowSeconds = Math.floor(Date.now() / 1000);

  const selectedCategories =
    mode === 'archive'
      ? normalizeNrFeedCategories([])
      : getNrListFilter({
          db,
          mode,
        });

  const hiddenEventIds = relatedEventIdsForMode(db, mode);

  const topicGroups = buildGroups({
    db,
    type: 'topic',
    hiddenEventIds,
    mode,
    categories: selectedCategories,
  });

  if (mode === 'timeline') {
    topicGroups.sort(
      (left, right) =>
        left.unreadCount - right.unreadCount ||
        left.tag.localeCompare(right.tag),
    );
  }

  const moodGroups = buildGroups({
    db,
    type: 'mood',
    hiddenEventIds,
    mode,
    categories: selectedCategories,
  });

  const activityTargetPredicate =
    mode === 'archive'
      ? ''
      : `AND NOT EXISTS (
          SELECT 1
          FROM nr_activity_targets activity_target
          JOIN nr_events target ON target.id = activity_target.target_event_id
          WHERE activity_target.activity_event_id = e.id
            AND target.read_at IS NOT NULL
        )`;

  const activityEvents = (
    db
      .prepare(
        `SELECT e.*, c.summary, c.model, c.classified_at, c.classification_json
         FROM nr_events e
         LEFT JOIN nr_classifications c ON c.event_id = e.id
         WHERE e.kind != 1 AND ${listModePredicate(mode)} ${activityTargetPredicate}
         ORDER BY e.event_created_at DESC`,
      )
      .all() as EventRow[]
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
      ...activityEvents,
    ].map((event) => event.id),
  );

  const interestSignals = listNrInterestSignals(db);
  const authorPreferences = listNrAuthorPreferences(db);
  const topicAffinities = buildNrTopicAffinities(interestSignals);
  const authorAffinities = buildNrAuthorAffinities(authorPreferences);

  const forYouEvents = [
    ...new Map(
      [...topicGroups, ...moodGroups]
        .flatMap((group) => group.events)
        .concat(activityEvents)
        .map((event) => [event.id, event]),
    ).values(),
  ]
    .filter(
      (event) =>
        scoreNrEventForYou({ event, topicAffinities, authorAffinities }) >= 0,
    )
    .sort((left, right) => {
      const scoreDifference =
        scoreNrEventForYou({
          event: right,
          topicAffinities,
          authorAffinities,
        }) -
        scoreNrEventForYou({
          event: left,
          topicAffinities,
          authorAffinities,
        });

      return scoreDifference || right.event_created_at - left.event_created_at;
    });

  const forYouScores = Object.fromEntries(
    forYouEvents.map((event) => [
      event.id,
      scoreNrEventForYou({ event, topicAffinities, authorAffinities }),
    ]),
  );

  return {
    mode,
    selectedCategories,
    profileEvents: [],
    forYouEvents,
    forYouScores,
    activityEvents,
    topicGroups,
    moodGroups,
    unreadTotal:
      mode === 'for-you' ? forYouEvents.length : visibleUnreadEventIds.size,
    fetchWindows: listNrFetchWindows({
      db,
      since: nowSeconds - 24 * 60 * 60,
      until: nowSeconds,
      scopes: ['follows'],
    }),
    interactions: listNrInteractions(db),
    interestSignals,
    authorPreferences,
    taxonomyTerms: listNrTaxonomyTerms(db),
    settings: getNrSettings(db),
  };
}

export function openDb(): Database {
  const db = new Database(join(import.meta.dir, 'db.sqlite'), {
    strict: true,
  });

  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA busy_timeout=5000');
  createNrTable(db);
  createNrSettingsTable(db);

  return db;
}
