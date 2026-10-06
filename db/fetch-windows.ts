import type { Database as DatabaseType } from 'bun:sqlite';
import type { Event as NostrEvent } from 'nostr-tools';

import type {
  FetchRelayCursorRow,
  FetchWindowRow,
  ListNrFetchRelayCursorsProps,
  ListNrFetchWindowsProps,
  NrFetchRelayCursor,
  NrFetchWindow,
  NrFollowsCache,
  RecordNrFetchWindowProps,
  SaveNrFetchRelayCursorProps,
} from './types';
import { rowToNrFetchRelayCursor, rowToNrFetchWindow } from './types';

export function assertFetchWindowRange(since: number, until: number): void {
  if (!Number.isInteger(since) || !Number.isInteger(until) || since >= until) {
    throw new Error('Fetch window requires integer since < until timestamps.');
  }
}

export function parseFollowPubkeys(event: NostrEvent): string[] {
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
    FetchRelayCursorRow | undefined;

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
