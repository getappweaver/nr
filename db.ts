// ---------------------------------------------------------------------------
// plugins/nr/db.ts — open SQLite + Nostr event cache and classification store
// ---------------------------------------------------------------------------

import { join } from 'path';

import { Database, type Database as DatabaseType } from 'bun:sqlite';

import { classifyEvent } from './classifier';
import type {
  EventClassification,
  NostrEvent,
  NrEvent,
  NrFetchScope,
  NrFetchStatus,
  NrFetchWindow,
  NrInteraction,
  NrInteractionType,
  NrListMode,
  NrListData,
  NrTagGroup,
  NrTaxonomyTerm,
  NrTaxonomyTermType,
  ParsedNrEventResult,
} from './commands/shared/types';
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

type SkippedEventRow = {
  event_id: string;
  pubkey: string;
  event_created_at: number;
  reason: string | null;
  model: string | null;
  skipped_at: number;
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
    CREATE INDEX IF NOT EXISTS idx_nr_interactions_target
    ON nr_interactions(target_event_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nr_interactions_user_target_type
    ON nr_interactions(user_pubkey, target_event_id, type)
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
  classify,
}: ParseAndStoreEventProps): Promise<ParsedNrEventResult> {
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
      JSON.stringify(threadContext),
      JSON.stringify(referencedEvents),
    ],
  );

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

export function markEventState({
  db,
  eventId,
  state,
}: MarkEventStateProps): NrEvent | null {
  const existing = getNr(db, eventId);

  if (!existing) {
    return null;
  }

  const column = markColumnForState(state);
  const value = markValueForState(state);

  const relatedIds = [
    ...relatedEventIds(existing.thread_context_json),
    ...relatedEventIds(existing.referenced_events_json),
  ];

  db.run(`UPDATE nr_events SET ${column} = ? WHERE id = ?`, [value, eventId]);

  if (relatedIds.length > 0) {
    const markRelated = db.prepare(
      `UPDATE nr_events SET ${column} = ? WHERE id = ?`,
    );

    for (const relatedId of relatedIds) {
      markRelated.run(value, relatedId);
    }
  }

  return getNr(db, eventId);
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
  const column = markColumnForState(state);
  const predicate = predicateForState(state);

  const rows = db
    .prepare(
      `
      SELECT DISTINCT e.id AS id
      FROM nr_events e
      JOIN nr_event_tags t ON t.event_id = e.id
      WHERE e.${column} ${predicate} AND t.type = ? AND t.tag = ?
    `,
    )
    .all(type, tag) as Array<{ id: string }>;

  for (const row of rows) {
    markEventState({
      db,
      eventId: row.id,
      state,
    });
  }

  return {
    type,
    tag,
    eventCount: rows.length,
  };
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
};

function listEventsForTag({
  db,
  type,
  tag,
  hiddenEventIds,
  mode,
}: ListEventsForTagProps): NrEvent[] {
  const predicate = listModePredicate(mode);

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
      WHERE t.type = ? AND t.tag = ? AND ${predicate}
      ORDER BY e.event_created_at DESC
    `,
    )
    .all(type, tag) as EventRow[];

  return rows
    .map(rowToNrEvent)
    .filter(
      (event) =>
        !hiddenEventIds.has(event.id) && eventHasCompleteContext(event),
    );
}

type BuildGroupsProps = {
  db: DatabaseType;
  type: 'topic' | 'mood';
  hiddenEventIds: Set<string>;
  mode: NrListMode;
};

function buildGroups({
  db,
  type,
  hiddenEventIds,
  mode,
}: BuildGroupsProps): NrTagGroup[] {
  return listTags({ db, type, mode })
    .map((row) => {
      const events = listEventsForTag({
        db,
        type,
        tag: row.tag,
        hiddenEventIds,
        mode,
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

export function getNrListData({ db, mode }: GetNrListDataProps): NrListData {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const hiddenEventIds = relatedEventIdsForMode(db, mode);

  const topicGroups = buildGroups({
    db,
    type: 'topic',
    hiddenEventIds,
    mode,
  });

  const moodGroups = buildGroups({
    db,
    type: 'mood',
    hiddenEventIds,
    mode,
  });

  const visibleUnreadEventIds = new Set(
    [...topicGroups, ...moodGroups].flatMap((group) =>
      group.events.map((event) => event.id),
    ),
  );

  return {
    mode,
    topicGroups,
    moodGroups,
    unreadTotal: visibleUnreadEventIds.size,
    fetchWindows: listNrFetchWindows({
      db,
      since: nowSeconds - 24 * 60 * 60,
      until: nowSeconds,
      scopes: ['follows'],
    }),
    interactions: listNrInteractions(db),
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
  createNrTable(db);
  createNrSettingsTable(db);

  return db;
}
