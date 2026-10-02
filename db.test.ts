import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';

import type { SeedEventsProps } from '@src/nostr/event-resolution-types';
import type { NostrResolutionService } from '@src/nostr/resolution-service';

import { adaptSignalRecordCommand } from './commands/signal-record/adapter';
import {
  createNrTable,
  getNr,
  getNrListData,
  getZappedSatsByTarget,
  markEventRead,
  markEventState,
  markTaggedEventsState,
  parseAndStoreEvent,
} from './db';
import { createNrSettingsTable } from './settings';
import type { NrCommandAdapterParams } from './types/adapter-params';

test('shared-cache seeding preserves NR classification and read/archive state', async () => {
  const db = new Database(':memory:');

  createNrTable(db);

  const event = finalizeEvent(
    { kind: 1, created_at: 1, content: 'post', tags: [] },
    generateSecretKey(),
  );

  const parent = finalizeEvent(
    { kind: 1, created_at: 0, content: 'parent', tags: [] },
    generateSecretKey(),
  );

  const seedCalls: SeedEventsProps[] = [];

  const service = {
    seedEvents: async (props: SeedEventsProps) => {
      seedCalls.push(props);

      return {
        seeded: props.entries.length,
        skipped: 0,
        invalid: 0,
        results: [],
      };
    },
  } as unknown as NostrResolutionService;

  let classifyCalls = 0;

  const classify = () => {
    classifyCalls += 1;

    return {
      topics: ['nostr'],
      moods: ['focused'],
      summary: 'summary',
      language: 'en',
      model: 'test',
      confidence: 1,
      skip: false,
      skipReason: null,
    };
  };

  await parseAndStoreEvent({
    db,
    event,
    forceReclassify: false,
    relayHints: ['wss://relay.example'],
    threadContext: [parent],
    referencedEvents: [],
    nostrResolution: service,
    classify,
  });

  markEventRead(db, event.id);
  markEventState({ db, eventId: event.id, state: 'archived' });

  await parseAndStoreEvent({
    db,
    event,
    forceReclassify: false,
    relayHints: ['wss://relay.example'],
    threadContext: [parent],
    referencedEvents: [],
    nostrResolution: service,
    classify,
  });

  const stored = getNr(db, event.id);

  expect(stored?.read_at).not.toBeNull();
  expect(stored?.archived_at).not.toBeNull();
  expect(stored?.summary).toBe('summary');
  expect(classifyCalls).toBe(1);
  expect(seedCalls).toHaveLength(2);

  expect(JSON.parse(stored!.thread_context_json)).toEqual([{ id: parent.id }]);

  db.close();
});

test('marking a tag read changes only its unread events', () => {
  const db = new Database(':memory:');

  createNrTable(db);

  const insertEvent = db.prepare(
    'INSERT INTO nr_events (id, pubkey, kind, event_created_at, content, raw_json, inserted_at) VALUES (?, ?, 1, 1, ?, ?, 1)',
  );

  for (const id of ['one', 'two']) {
    insertEvent.run(id, 'author', id, '{}');
  }

  db.run(
    "INSERT INTO nr_event_tags (event_id, type, tag) VALUES ('one', 'topic', 'nostr'), ('two', 'topic', 'bitcoin')",
  );

  expect(
    markTaggedEventsState({ db, type: 'topic', tag: 'nostr', state: 'read' })
      .eventCount,
  ).toBe(1);

  expect(getNr(db, 'one')?.read_at).not.toBeNull();
  expect(getNr(db, 'two')?.read_at).toBeNull();

  db.close();
});

test('does not persist compact context when shared-cache seeding fails', async () => {
  const db = new Database(':memory:');

  createNrTable(db);

  const event = finalizeEvent(
    { kind: 1, created_at: 1, content: 'post', tags: [] },
    generateSecretKey(),
  );

  const service = {
    seedEvents: async () => {
      throw new Error('cache unavailable');
    },
  } as unknown as NostrResolutionService;

  await expect(
    parseAndStoreEvent({
      db,
      event,
      forceReclassify: false,
      relayHints: [],
      threadContext: [],
      referencedEvents: [],
      nostrResolution: service,
      classify: () => {
        throw new Error('classification should not run');
      },
    }),
  ).rejects.toThrow('cache unavailable');

  expect(getNr(db, event.id)).toBeNull();
  db.close();
});

test('NIP-22 comments remain unread when their parent is already read', async () => {
  const db = new Database(':memory:');
  createNrTable(db);
  createNrSettingsTable(db);

  const parent = finalizeEvent(
    { kind: 1, created_at: 1, content: 'parent', tags: [] },
    generateSecretKey(),
  );

  const comment = finalizeEvent(
    {
      kind: 1111,
      created_at: 2,
      content: 'comment',
      tags: [
        ['E', parent.id, '', parent.pubkey],
        ['K', '1'],
        ['P', parent.pubkey],
        ['e', parent.id, '', parent.pubkey],
        ['k', '1'],
        ['p', parent.pubkey],
      ],
    },
    generateSecretKey(),
  );

  const service = {
    seedEvents: async () => ({
      seeded: 1,
      skipped: 0,
      invalid: 0,
      results: [],
    }),
  } as unknown as NostrResolutionService;

  const classify = () => ({
    topics: ['nostr'],
    moods: ['focused'],
    summary: 'summary',
    language: 'en',
    model: 'test',
    confidence: 1,
    skip: false,
    skipReason: null,
  });

  await parseAndStoreEvent({
    db,
    event: parent,
    forceReclassify: false,
    relayHints: [],
    threadContext: [],
    referencedEvents: [],
    nostrResolution: service,
    classify,
  });

  markEventRead(db, parent.id);

  await parseAndStoreEvent({
    db,
    event: comment,
    forceReclassify: false,
    relayHints: [],
    threadContext: [parent],
    referencedEvents: [],
    nostrResolution: service,
    classify,
  });

  expect(getNr(db, comment.id)?.read_at).toBeNull();

  const listData = getNrListData({
    db,
    mode: 'timeline',
    timeSelection: {
      initialized: true,
      ranges: [{ since: 0, until: 3_600 }],
    },
  });

  expect(
    listData.topicGroups
      .flatMap((group) => group.events)
      .some((event) => event.id === comment.id),
  ).toBe(true);

  db.close();
});

test('stores kind 9735 zap receipt as activity target and calculates zap scores', async () => {
  const db = new Database(':memory:');
  createNrTable(db);
  createNrSettingsTable(db);

  const note = finalizeEvent(
    { kind: 1, created_at: 100, content: 'Zapped post', tags: [] },
    generateSecretKey(),
  );

  const zapRequest = finalizeEvent(
    {
      kind: 9734,
      created_at: 110,
      content: 'Zap!',
      tags: [
        ['e', note.id],
        ['p', note.pubkey],
        ['amount', '1000000'],
      ],
    },
    generateSecretKey(),
  );

  const zapReceipt = finalizeEvent(
    {
      kind: 9735,
      created_at: 120,
      content: '',
      tags: [
        ['p', note.pubkey],
        ['P', zapRequest.pubkey],
        ['e', note.id],
        ['description', JSON.stringify(zapRequest)],
        ['bolt11', 'lnbc10u...'],
      ],
    },
    generateSecretKey(),
  );

  const classify = () => ({
    topics: ['nostr'],
    moods: ['focused'],
    summary: 'summary',
    language: 'en',
    model: 'test',
    confidence: 1,
    skip: false,
    skipReason: null,
  });

  const service = {
    seedEvents: async () => ({
      seeded: 0,
      skipped: 0,
      invalid: 0,
      results: [],
    }),
  } as unknown as NostrResolutionService;

  await parseAndStoreEvent({
    db,
    event: note,
    forceReclassify: false,
    relayHints: [],
    threadContext: [],
    referencedEvents: [],
    nostrResolution: service,
    classify,
  });

  await parseAndStoreEvent({
    db,
    event: zapReceipt,
    forceReclassify: false,
    relayHints: [],
    threadContext: [],
    referencedEvents: [note],
    nostrResolution: service,
    classify,
  });

  const zappedSats = getZappedSatsByTarget(db);
  expect(zappedSats.get(note.id)).toBe(1000);

  const listData = getNrListData({
    db,
    mode: 'for-you',
    timeSelection: {
      initialized: true,
      ranges: [],
    },
  });

  expect(listData.forYouScores[note.id]).toBeCloseTo(3.1, 2);

  db.close();
});

test('repost_quote signal-record marks target event read when signal_read_post is true', async () => {
  const db = new Database(':memory:');
  createNrTable(db);

  const note = finalizeEvent(
    { kind: 1, created_at: 100, content: 'repost me', tags: [] },
    generateSecretKey(),
  );

  await parseAndStoreEvent({
    db,
    event: note,
    forceReclassify: false,
    relayHints: [],
    threadContext: [],
    referencedEvents: [],
    nostrResolution: {
      seedEvents: async () => ({
        seeded: 0,
        skipped: 0,
        invalid: 0,
        results: [],
      }),
    } as unknown as NostrResolutionService,
    classify: () => ({
      topics: ['nostr'],
      moods: ['focused'],
      summary: 'summary',
      language: 'en',
      model: 'test',
      confidence: 1,
      skip: false,
      skipReason: null,
    }),
  });

  expect(getNr(db, note.id)?.read_at).toBeNull();

  adaptSignalRecordCommand({
    source: 'web',
    db,
    alias: 'nr',
    parsed: {
      options: {
        target_event_id: note.id,
        action_category: 'repost_quote',
        signal_type: 'repost',
        signal_outcome: 'without_signal',
        signal_read_post: true,
      },
    },
  } as unknown as NrCommandAdapterParams);

  expect(getNr(db, note.id)?.read_at).not.toBeNull();

  db.close();
});
