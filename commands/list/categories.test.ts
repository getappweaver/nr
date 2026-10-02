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

test('identifies kind 9735 as zaps category', () => {
  expect(
    categoryForNrEvent({
      id: 'zap_receipt_id',
      pubkey: 'wallet_pubkey',
      created_at: 1,
      kind: 9735,
      content: '',
      tags: [
        ['p', 'recipient_pubkey'],
        ['bolt11', 'lnbc...'],
      ],
      sig: 'signature',
    }),
  ).toBe('zaps');
});
