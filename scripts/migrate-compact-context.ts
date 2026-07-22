import { join } from 'path';

import { Database, type Database as DatabaseType } from 'bun:sqlite';

import { openNostrCacheDb, type NostrCacheDb } from '@src/nostr/cache/db';
import { parseVerifiedNostrEvent } from '@src/nostr/cache/schema';
import {
  isEphemeralKind,
  isReplaceableKind,
  putCachedEventById,
  upsertCachedReplaceableEvent,
} from '@src/nostr/cache/store';

type ContextRow = {
  id: string;
  thread_context_json: string | null;
  referenced_events_json: string | null;
};

type MigrationResult = {
  rows: number;
  changedRows: number;
  contextEntries: number;
};

function contextEvents(rows: ContextRow[]): unknown[] {
  const events = new Map<string, unknown>();

  for (const row of rows) {
    for (const raw of [row.thread_context_json, row.referenced_events_json]) {
      const parsed = JSON.parse(raw ?? '[]') as unknown;

      if (!Array.isArray(parsed)) {
        throw new Error(`Invalid context array for ${row.id}.`);
      }

      for (const entry of parsed) {
        if (
          entry &&
          typeof entry === 'object' &&
          'id' in entry &&
          typeof (entry as { id?: unknown }).id === 'string' &&
          'sig' in entry
        ) {
          events.set((entry as { id: string }).id, entry);
        }
      }
    }
  }

  return [...events.values()];
}

function seedContextCache({
  cacheDb,
  rows,
}: {
  cacheDb: NostrCacheDb;
  rows: ContextRow[];
}): number {
  const nowMs = Date.now();
  let seeded = 0;

  for (const input of contextEvents(rows)) {
    const event = parseVerifiedNostrEvent(input);

    if (isEphemeralKind(event.kind)) {
      throw new Error(
        `Cannot compact ephemeral context event ${event.id} (kind ${event.kind}).`,
      );
    }

    if (isReplaceableKind(event.kind)) {
      const identifier =
        event.kind >= 30_000 && event.kind < 40_000
          ? (event.tags.find((tag) => tag[0] === 'd')?.[1] ?? '')
          : null;

      upsertCachedReplaceableEvent({
        db: cacheDb,
        event,
        kind: event.kind,
        pubkey: event.pubkey,
        identifier,
        relayHints: [],
        nowMs,
        lastCheckedAt: 0,
      });
    } else {
      putCachedEventById({
        db: cacheDb,
        event,
        requestedEventId: event.id,
        relayHints: [],
        nowMs,
      });
    }

    seeded += 1;
  }

  return seeded;
}

function compactContext(raw: string | null, eventId: string): string {
  const parsed = JSON.parse(raw ?? '[]') as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid context array for ${eventId}.`);
  }

  const ids = parsed.map((entry) => {
    if (!entry || typeof entry !== 'object' || !('id' in entry)) {
      throw new Error(`Invalid context entry for ${eventId}.`);
    }

    const id = (entry as { id?: unknown }).id;

    if (typeof id !== 'string' || !/^[0-9a-f]{64}$/i.test(id)) {
      throw new Error(`Invalid context event id for ${eventId}.`);
    }

    return id.toLowerCase();
  });

  return JSON.stringify([...new Set(ids)].map((id) => ({ id })));
}

export function migrateCompactContext({
  db,
  apply,
}: {
  db: DatabaseType;
  apply: boolean;
}): MigrationResult {
  const rows = db
    .prepare(
      `SELECT id, thread_context_json, referenced_events_json FROM nr_events`,
    )
    .all() as ContextRow[];

  const updates = rows.map((row) => {
    const threadContextJson = compactContext(row.thread_context_json, row.id);

    const referencedEventsJson = compactContext(
      row.referenced_events_json,
      row.id,
    );

    return {
      id: row.id,
      threadContextJson,
      referencedEventsJson,
      changed:
        threadContextJson !== (row.thread_context_json ?? '[]') ||
        referencedEventsJson !== (row.referenced_events_json ?? '[]'),
    };
  });

  if (apply) {
    const update = db.prepare(
      `UPDATE nr_events
       SET thread_context_json = ?, referenced_events_json = ?
       WHERE id = ?`,
    );

    db.transaction(() => {
      for (const row of updates) {
        if (row.changed) {
          update.run(row.threadContextJson, row.referencedEventsJson, row.id);
        }
      }
    })();
  }

  return {
    rows: rows.length,
    changedRows: updates.filter((row) => row.changed).length,
    contextEntries: updates.reduce(
      (total, row) =>
        total +
        (JSON.parse(row.threadContextJson) as unknown[]).length +
        (JSON.parse(row.referencedEventsJson) as unknown[]).length,
      0,
    ),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const seedFromIndex = args.indexOf('--seed-from');
  const seedFrom = seedFromIndex >= 0 ? args[seedFromIndex + 1] : null;

  const knownIndexes = new Set([
    args.indexOf('--apply'),
    seedFromIndex,
    seedFromIndex >= 0 ? seedFromIndex + 1 : -1,
  ]);

  const unknown = args.filter((_argument, index) => !knownIndexes.has(index));

  if (unknown.length > 0 || (seedFromIndex >= 0 && !seedFrom)) {
    throw new Error(`Unknown option: ${unknown.join(' ')}`);
  }

  if (apply && seedFrom) {
    throw new Error('Use --apply or --seed-from, not both.');
  }

  const dbPath = join(import.meta.dir, '..', 'db.sqlite');

  const db = new Database(seedFrom ?? dbPath, {
    readonly: seedFrom !== null,
    strict: true,
  });

  try {
    if (apply) {
      const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
      const backupPath = `${dbPath}.before-compact-context-${timestamp}.backup`;

      db.run('VACUUM INTO ?', [backupPath]);
      console.log(`Backup: ${backupPath}`);
    }

    if (apply || seedFrom) {
      const rows = db
        .prepare(
          `SELECT id, thread_context_json, referenced_events_json FROM nr_events`,
        )
        .all() as ContextRow[];

      const cacheDb = openNostrCacheDb();

      try {
        console.log(
          `Seeded ${seedContextCache({ cacheDb, rows })} context events.`,
        );
      } finally {
        cacheDb.close();
      }
    }

    if (seedFrom) {
      console.log(`Seed source: ${seedFrom}`);
    } else {
      const result = migrateCompactContext({ db, apply });

      console.log(
        `${apply ? 'Migrated' : 'Would migrate'} ${result.changedRows}/${result.rows} rows with ${result.contextEntries} context entries.`,
      );

      if (!apply) {
        console.log('Run again with --apply to create a backup and migrate.');
      }
    }
  } finally {
    db.close();
  }
}
