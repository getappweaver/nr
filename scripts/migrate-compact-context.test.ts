import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';

import { migrateCompactContext } from './migrate-compact-context';

test('compacts context without changing NR user state', () => {
  const db = new Database(':memory:');

  const root = finalizeEvent(
    { kind: 1, created_at: 2, content: 'root', tags: [] },
    generateSecretKey(),
  );

  const parent = finalizeEvent(
    { kind: 1, created_at: 1, content: 'parent', tags: [] },
    generateSecretKey(),
  );

  db.run(`
    CREATE TABLE nr_events (
      id TEXT PRIMARY KEY,
      read_at INTEGER,
      archived_at INTEGER,
      thread_context_json TEXT,
      referenced_events_json TEXT
    )
  `);

  db.run(`INSERT INTO nr_events VALUES (?, ?, ?, ?, ?)`, [
    root.id,
    100,
    200,
    JSON.stringify([parent]),
    JSON.stringify([parent, parent]),
  ]);

  const preview = migrateCompactContext({ db, apply: false });

  expect(preview).toEqual({ rows: 1, changedRows: 1, contextEntries: 2 });

  const before = db.prepare(`SELECT * FROM nr_events`).get() as Record<
    string,
    unknown
  >;

  expect(JSON.parse(String(before.thread_context_json))).toEqual([
    expect.objectContaining({ id: parent.id, content: parent.content }),
  ]);

  migrateCompactContext({ db, apply: true });

  const after = db.prepare(`SELECT * FROM nr_events`).get() as Record<
    string,
    unknown
  >;

  expect(after.read_at).toBe(100);
  expect(after.archived_at).toBe(200);

  expect(JSON.parse(String(after.thread_context_json))).toEqual([
    { id: parent.id },
  ]);

  expect(JSON.parse(String(after.referenced_events_json))).toEqual([
    { id: parent.id },
  ]);

  db.close();
});
