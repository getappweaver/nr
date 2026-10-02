import { nip57 } from 'nostr-tools';

import type { NostrEvent } from './commands/shared/types';

export type ParsedZapReceipt = {
  zapperPubkey: string;
  recipientPubkey: string | null;
  targetEventId: string | null;
  amountSats: number;
  comment: string | null;
};

function tagValue(tags: string[][], name: string): string | null {
  const found = tags.find((tag) => tag[0] === name);

  return found?.[1]?.trim() || null;
}

export function parseZapReceipt(event: NostrEvent): ParsedZapReceipt {
  let zapRequest: NostrEvent | null = null;
  const description = tagValue(event.tags, 'description');

  if (description) {
    try {
      const parsed = JSON.parse(description) as unknown;

      if (
        parsed &&
        typeof parsed === 'object' &&
        'kind' in parsed &&
        (parsed as { kind: number }).kind === 9734
      ) {
        zapRequest = parsed as NostrEvent;
      }
    } catch {
      zapRequest = null;
    }
  }

  const senderPubkeyFromReceipt = tagValue(event.tags, 'P');

  const zapperPubkey =
    senderPubkeyFromReceipt || zapRequest?.pubkey || event.pubkey;

  const recipientPubkey =
    tagValue(event.tags, 'p') ||
    (zapRequest ? tagValue(zapRequest.tags, 'p') : null);

  const targetEventId =
    tagValue(event.tags, 'e') ||
    (zapRequest ? tagValue(zapRequest.tags, 'e') : null);

  let amountSats = 0;

  if (zapRequest) {
    const msatsStr = tagValue(zapRequest.tags, 'amount');

    if (msatsStr) {
      const msats = Number(msatsStr);

      if (Number.isFinite(msats) && msats > 0) {
        amountSats = Math.floor(msats / 1000);
      }
    }
  }

  if (amountSats <= 0) {
    const directAmount = tagValue(event.tags, 'amount');

    if (directAmount) {
      const num = Number(directAmount);

      if (Number.isFinite(num) && num > 0) {
        amountSats = num > 1_000_000 ? Math.floor(num / 1000) : Math.floor(num);
      }
    }
  }

  if (amountSats <= 0) {
    const bolt11 = tagValue(event.tags, 'bolt11');

    if (bolt11) {
      try {
        const decoded = nip57.getSatoshisAmountFromBolt11(bolt11);

        if (Number.isFinite(decoded) && decoded > 0) {
          amountSats = Math.floor(decoded);
        }
      } catch {
        amountSats = 0;
      }
    }
  }

  const comment = zapRequest?.content?.trim() || null;

  return {
    zapperPubkey,
    recipientPubkey,
    targetEventId,
    amountSats: Math.max(0, amountSats),
    comment,
  };
}

export function calculateZapScore(sats: number): number {
  if (!Number.isFinite(sats) || sats < 1) {
    return 0;
  }

  return Math.min(5.0, 0.1 + Math.log10(sats));
}
