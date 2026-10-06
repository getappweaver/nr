import { join } from 'path';

import { Database, type Database as DatabaseType } from 'bun:sqlite';

import { extractDirectActivityTargetId } from '../activity';
import type { NostrEvent } from '../commands/shared/types';
import { createNrSettingsTable } from '../settings';

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

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_events_unread_created_at
    ON nr_events(event_created_at DESC)
    WHERE read_at IS NULL
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
    CREATE INDEX IF NOT EXISTS idx_nr_event_tags_type_tag_event
    ON nr_event_tags(type, tag, event_id)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_taxonomy_terms (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT    NOT NULL CHECK (type IN ('topic', 'mood')),
      tag         TEXT    NOT NULL,
      description TEXT,
      preference  TEXT    NOT NULL DEFAULT 'interested' CHECK (preference IN ('interested', 'uninterested')),
      active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      UNIQUE(type, tag)
    )
  `);

  ensureNrTaxonomyTermColumn(
    db,
    'preference',
    "TEXT NOT NULL DEFAULT 'interested' CHECK (preference IN ('interested', 'uninterested'))",
  );

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
    DELETE FROM nr_activity_targets
    WHERE activity_event_id IN (
      SELECT id FROM nr_events WHERE kind NOT IN (6, 7, 16, 9735)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_read_events (
      event_id TEXT PRIMARY KEY,
      read_at  INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_read_events_read_at
    ON nr_read_events(read_at)
  `);

  migrateNrReadAndActivityTargets(db);

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
      author_pubkey   TEXT,
      source          TEXT    NOT NULL CHECK (source IN ('interaction', 'archive', 'private', 'seed')),
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (target_event_id, type)
    )
  `);

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
    CREATE TABLE IF NOT EXISTS nr_image_cache (
      image_hash   TEXT    PRIMARY KEY,
      mime         TEXT    NOT NULL,
      byte_size    INTEGER NOT NULL,
      description  TEXT    NOT NULL,
      model        TEXT    NOT NULL,
      evaluated_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nr_event_images (
      event_id   TEXT NOT NULL REFERENCES nr_events(id) ON DELETE CASCADE,
      image_hash TEXT NOT NULL REFERENCES nr_image_cache(image_hash) ON DELETE CASCADE,
      source_url TEXT NOT NULL,
      PRIMARY KEY (event_id, image_hash)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_event_images_event
    ON nr_event_images(event_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_author_preferences_updated
    ON nr_author_preferences(updated_at DESC)
  `);

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

function ensureNrTaxonomyTermColumn(
  db: DatabaseType,
  name: string,
  definition: string,
): void {
  const columns = db
    .prepare('PRAGMA table_info(nr_taxonomy_terms)')
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === name)) {
    return;
  }

  db.run(`ALTER TABLE nr_taxonomy_terms ADD COLUMN ${name} ${definition}`);
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

function migrateNrReadAndActivityTargets(db: DatabaseType): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS nr_read_events (
      event_id TEXT PRIMARY KEY,
      read_at  INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_read_events_read_at
    ON nr_read_events(read_at)
  `);

  db.run(`
    INSERT OR IGNORE INTO nr_read_events (event_id, read_at)
    SELECT id, read_at FROM nr_events WHERE read_at IS NOT NULL
  `);

  const activityRows = db
    .prepare(
      `SELECT id, kind, raw_json
       FROM nr_events
       WHERE kind IN (7, 9735)`,
    )
    .all() as Array<{ id: string; kind: number; raw_json: string }>;

  const insertTarget = db.prepare(
    'INSERT OR IGNORE INTO nr_activity_targets (activity_event_id, target_event_id) VALUES (?, ?)',
  );

  const deleteTarget = db.prepare(
    'DELETE FROM nr_activity_targets WHERE activity_event_id = ?',
  );

  for (const row of activityRows) {
    try {
      const event = JSON.parse(row.raw_json) as NostrEvent;
      const targetId = extractDirectActivityTargetId(event);

      if (targetId) {
        deleteTarget.run(row.id);
        insertTarget.run(row.id, targetId);
      }
    } catch {
      // ignore malformed
    }
  }

  db.run(`
    UPDATE nr_events
    SET read_at = (
      SELECT MAX(read_at)
      FROM (
        SELECT read_event.read_at
        FROM nr_activity_targets activity
        JOIN nr_read_events read_event ON read_event.event_id = activity.target_event_id
        WHERE activity.activity_event_id = nr_events.id
        UNION
        SELECT target.read_at
        FROM nr_activity_targets activity
        JOIN nr_events target ON target.id = activity.target_event_id
        WHERE activity.activity_event_id = nr_events.id
          AND target.read_at IS NOT NULL
      )
    )
    WHERE kind IN (6, 7, 16, 9735)
      AND read_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM nr_activity_targets activity
        WHERE activity.activity_event_id = nr_events.id
          AND (
            EXISTS (
              SELECT 1 FROM nr_read_events read_event
              WHERE read_event.event_id = activity.target_event_id
            )
            OR EXISTS (
              SELECT 1 FROM nr_events target
              WHERE target.id = activity.target_event_id
                AND target.read_at IS NOT NULL
            )
          )
      )
  `);

  db.run(`
    INSERT OR IGNORE INTO nr_read_events (event_id, read_at)
    SELECT id, read_at FROM nr_events WHERE read_at IS NOT NULL
  `);
}

export function openDb(): Database {
  const db = new Database(join(import.meta.dir, '..', 'db.sqlite'), {
    strict: true,
  });

  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA busy_timeout=5000');
  createNrTable(db);
  createNrSettingsTable(db);

  return db;
}
