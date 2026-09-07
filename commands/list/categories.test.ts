import { expect, test } from 'bun:test';

import { categoryForNrEvent } from './categories';

test('treats a marked NIP-10 mention as a post rather than a reply', () => {
  expect(
    categoryForNrEvent({
      id: 'source',
      pubkey: 'author',
      created_at: 1,
      kind: 1,
      content: 'nostr:nevent1example',
      tags: [['e', 'target', '', 'mention', 'target-author']],
      sig: 'signature',
    }),
  ).toBe('posts');
});
