import { verifyEvent, type Event as NostrToolsEvent } from 'nostr-tools';

import { NostrEventSchema } from '../shared/types';

export type SignalReviewTarget = {
  id: string;
  pubkey: string;
  kind: number;
  relayHints: string[];
};

export function verifiedSignalReviewTarget(
  eventJson: string | null,
  targetEventId: string,
): SignalReviewTarget | null {
  if (!eventJson) {
    return null;
  }

  try {
    const event = NostrEventSchema.parse(JSON.parse(eventJson));

    if (event.id !== targetEventId || !verifyEvent(event as NostrToolsEvent)) {
      return null;
    }

    return {
      id: event.id,
      pubkey: event.pubkey.toLowerCase(),
      kind: event.kind,
      relayHints: [],
    };
  } catch {
    return null;
  }
}
