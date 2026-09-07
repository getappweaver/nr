import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';

import type { NostrResolutionService } from '@src/nostr/resolution-service';

import { handleNrAdapter } from '../../adapter';
import {
  createNrTable,
  parseAndStoreEvent,
  saveNrEventImage,
  saveNrImageCache,
} from '../../db';

test('images subcommand renders cached evaluations', async () => {
  const db = new Database(':memory:');
  createNrTable(db);

  const event = finalizeEvent(
    { kind: 1, created_at: 1, content: 'image post', tags: [] },
    generateSecretKey(),
  );

  await parseAndStoreEvent({
    db,
    event,
    forceReclassify: false,
    relayHints: [],
    threadContext: [],
    referencedEvents: [],
    nostrResolution: {
      seedEvents: async () => ({
        seeded: 1,
        skipped: 0,
        invalid: 0,
        results: [],
      }),
    } as unknown as NostrResolutionService,
    classify: () => ({
      topics: [],
      moods: [],
      summary: 'summary',
      language: 'en',
      model: 'test',
      confidence: 1,
      skip: false,
      skipReason: null,
    }),
  });

  saveNrImageCache({
    db,
    imageHash: 'image-hash',
    mime: 'image/jpeg',
    byteSize: 123,
    description: 'A test image description.',
    model: 'vision-test',
  });

  saveNrEventImage({
    db,
    eventId: event.id,
    imageHash: 'image-hash',
    sourceUrl: 'https://example.com/image.jpg',
  });

  const result = await handleNrAdapter({
    args: ['images'],
    prefix: '/',
    alias: 'nr',
    db,
    source: 'web',
    identity: null as never,
    storedCtx: null as never,
    agent: null as never,
    sendReply: null,
    jsonPayload: {
      arguments: { event_id: event.id },
      options: {},
    },
  });

  expect(result).toMatchObject({
    kind: 'ui',
    meta: { command: 'nr', subcommand: 'images' },
  });

  expect(JSON.stringify(result)).toContain('A test image description.');

  db.close();
});
