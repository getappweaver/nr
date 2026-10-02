import { expect, test } from 'bun:test';

import type { NostrEvent } from './commands/shared/types';
import { calculateZapScore, parseZapReceipt } from './zap';

test('parseZapReceipt parses standard NIP-57 zap receipt', () => {
  const zapRequest: NostrEvent = {
    id: 'req123',
    pubkey: 'sender_pubkey_hex',
    created_at: 1674164539,
    kind: 9734,
    tags: [
      ['e', 'target_note_id'],
      ['p', 'recipient_pubkey_hex'],
      ['amount', '21000'],
      ['relays', 'wss://relay.example.com'],
    ],
    content: 'Awesome contribution! ⚡',
    sig: 'sig',
  };

  const zapReceipt: NostrEvent = {
    id: 'rec123',
    pubkey: 'wallet_service_pubkey',
    created_at: 1674164545,
    kind: 9735,
    tags: [
      ['p', 'recipient_pubkey_hex'],
      ['P', 'sender_pubkey_hex'],
      ['e', 'target_note_id'],
      ['description', JSON.stringify(zapRequest)],
      ['bolt11', 'lnbc210n1...'],
    ],
    content: '',
    sig: 'receipt_sig',
  };

  const parsed = parseZapReceipt(zapReceipt);
  expect(parsed.zapperPubkey).toBe('sender_pubkey_hex');
  expect(parsed.targetEventId).toBe('target_note_id');
  expect(parsed.recipientPubkey).toBe('recipient_pubkey_hex');
  expect(parsed.amountSats).toBe(21);
  expect(parsed.comment).toBe('Awesome contribution! ⚡');
});

test('parseZapReceipt falls back to bolt11 if amount tag missing', () => {
  const zapRequest: NostrEvent = {
    id: 'req456',
    pubkey: 'sender_pubkey_hex',
    created_at: 1674164539,
    kind: 9734,
    tags: [
      ['e', 'target_note_id'],
      ['p', 'recipient_pubkey_hex'],
    ],
    content: '',
    sig: 'sig',
  };

  // lnbc10u = 10 micro-BTC = 1000 sats
  const bolt11 =
    'lnbc10u1p3unwfusp5t9r3yymhpfqculx78u027lxspgxcr2n2987mx2j55nnfs95nxnzqpp5jmrh92pfld78spqs78v9euf2385t83uvpwk9ldrlvf6ch7tpascqhp5zvkrmemgth3tufcvflmzjzfvjt023nazlhljz2n9hattj4f8jq8qxqyjw5qcqpjrzjqtc4fc44feggv7065fqe5m4ytjarg3repr5j9el35xhmtfexc42yczarjuqqfzqqqqqqqqlgqqqqqqgq9q9qxpqysgq079nkq507a5tw7xgttmj4u990j7wfggtrasah5gd4ywfr2pjcn29383tphp4t48gquelz9z78p4cq7ml3nrrphw5w6eckhjwmhezhnqpy6gyf0';

  const zapReceipt: NostrEvent = {
    id: 'rec456',
    pubkey: 'wallet_service_pubkey',
    created_at: 1674164545,
    kind: 9735,
    tags: [
      ['p', 'recipient_pubkey_hex'],
      ['e', 'target_note_id'],
      ['description', JSON.stringify(zapRequest)],
      ['bolt11', bolt11],
    ],
    content: '',
    sig: 'sig',
  };

  const parsed = parseZapReceipt(zapReceipt);
  expect(parsed.zapperPubkey).toBe('sender_pubkey_hex');
  expect(parsed.amountSats).toBe(1000);
  expect(parsed.comment).toBeNull();
});

test('calculateZapScore computes logarithmic points', () => {
  expect(calculateZapScore(0)).toBe(0);
  expect(calculateZapScore(-10)).toBe(0);
  expect(calculateZapScore(1)).toBeCloseTo(0.1, 2);
  expect(calculateZapScore(10)).toBeCloseTo(1.1, 2);
  expect(calculateZapScore(100)).toBeCloseTo(2.1, 2);
  expect(calculateZapScore(1000)).toBeCloseTo(3.1, 2);
  expect(calculateZapScore(10000)).toBeCloseTo(4.1, 2);
  expect(calculateZapScore(100000)).toBe(5.0);
  expect(calculateZapScore(1000000)).toBe(5.0);
});
