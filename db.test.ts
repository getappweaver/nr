import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';

import type { SeedEventsProps } from '@src/nostr/event-resolution-types';
import type { NostrResolutionService } from '@src/nostr/resolution-service';

import {
  createNrTable,
  getNr,
  getNrListData,
  markEventRead,
  markEventState,
  parseAndStoreEvent,
} from './db';
import { createNrSettingsTable } from './settings';

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
