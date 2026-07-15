import { recordNrInteraction, recordNrInterestSignal } from '../../db';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import type { NrInteractionType } from '../shared/types';

function stringOption(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integerOption(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);

    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}

function interactionType(value: string | null): NrInteractionType | null {
  return value === 'liked' ||
    value === 'replied' ||
    value === 'reposted' ||
    value === 'quoted'
    ? value
    : null;
}

export function adaptInteractionRecordCommand(
  params: NrCommandAdapterParams,
): string {
  void params.command;
  void params.source;
  void params.identity;
  void params.runAgent;

  const targetEventId = stringOption(params.parsed.options.target_event_id);

  const interactionEventId = stringOption(
    params.parsed.options.interaction_event_id,
  );

  const userPubkey = stringOption(params.parsed.options.user_pubkey);
  const type = interactionType(stringOption(params.parsed.options.type));

  const interactionCreatedAt = integerOption(
    params.parsed.options.interaction_created_at,
  );

  if (
    !targetEventId ||
    !interactionEventId ||
    !userPubkey ||
    !type ||
    interactionCreatedAt === null
  ) {
    return 'Missing interaction record fields.';
  }

  recordNrInteraction({
    db: params.db,
    targetEventId,
    interactionEventId,
    userPubkey,
    type,
    interactionCreatedAt,
    source: 'web',
  });

  const signalType = {
    liked: 'like',
    replied: 'reply',
    reposted: 'repost',
    quoted: 'quote',
  } as const;

  recordNrInterestSignal({
    db: params.db,
    targetEventId,
    type: signalType[type],
    createdAt: interactionCreatedAt * 1000,
    topics: null,
    moods: null,
    source: 'interaction',
  });

  return `Recorded ${type}: ${targetEventId}`;
}
