import { expect, test } from 'bun:test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';

import { extractNip10References } from './thread-context';

test('extracts NIP-10 root and parent event references', () => {
  const rootId = 'a'.repeat(64);
  const parentId = 'b'.repeat(64);

  const event = finalizeEvent(
    {
      kind: 1,
      created_at: 1,
      content: 'reply',
      tags: [
        ['e', rootId, 'wss://root.example', 'root'],
        ['e', parentId, 'wss://parent.example', 'reply'],
      ],
    },
    generateSecretKey(),
  );

  expect(extractNip10References(event)).toEqual([
    { id: rootId, relay: 'wss://root.example/', marker: 'root' },
    { id: parentId, relay: 'wss://parent.example/', marker: 'reply' },
  ]);
});

test('extracts NIP-22 uppercase root and lowercase parent references', () => {
  const rootId = 'c'.repeat(64);
  const parentId = 'd'.repeat(64);
  const rootPubkey = 'e'.repeat(64);
  const parentPubkey = 'f'.repeat(64);

  const event = finalizeEvent(
    {
      kind: 1111,
      created_at: 1,
      content: 'comment',
      tags: [
        ['E', rootId, 'wss://root.example', rootPubkey],
        ['K', '1'],
        ['P', rootPubkey],
        ['e', parentId, 'wss://parent.example', parentPubkey],
        ['k', '1111'],
        ['p', parentPubkey],
      ],
    },
    generateSecretKey(),
  );

  expect(extractNip10References(event)).toEqual([
    { id: rootId, relay: 'wss://root.example/', marker: 'root' },
    { id: parentId, relay: 'wss://parent.example/', marker: 'reply' },
  ]);
});
