import { parseEventReferences } from '@src/nostr/event-references';

import type { NostrEvent } from './commands/shared/types';
import { parseZapReceipt } from './zap';

export function extractDirectActivityTargetId(
  event: Pick<NostrEvent, 'kind' | 'tags' | 'content'>,
): string | null {
  if (event.kind === 7) {
    const replyTag = event.tags.find(
      (tag) =>
        tag[0] === 'e' &&
        tag[1]?.trim() &&
        tag[3]?.trim().toLowerCase() === 'reply',
    );

    if (replyTag?.[1]?.trim()) {
      return replyTag[1].trim();
    }

    const lastETag = event.tags
      .filter((tag) => tag[0] === 'e' && tag[1]?.trim())
      .at(-1);

    return lastETag?.[1]?.trim() || null;
  }

  if (event.kind === 9735) {
    const zap = parseZapReceipt(event as NostrEvent);

    return zap.targetEventId;
  }

  if (event.kind === 6) {
    try {
      const parsed = JSON.parse(event.content) as unknown;

      if (
        parsed &&
        typeof parsed === 'object' &&
        'id' in parsed &&
        typeof (parsed as { id: unknown }).id === 'string'
      ) {
        return (parsed as { id: string }).id;
      }
    } catch {
      // not JSON content
    }
  }

  if (event.kind === 6 || event.kind === 16) {
    const targetEdge = parseEventReferences(event as NostrEvent).find(
      (edge) => edge.role === 'repost-target' && edge.target.type === 'event',
    );

    if (targetEdge?.target.type === 'event') {
      return targetEdge.target.eventId;
    }

    const eTag = event.tags.find((tag) => tag[0] === 'e' && tag[1]?.trim());

    return eTag?.[1]?.trim() || null;
  }

  return null;
}
