import type { Database as DatabaseType } from 'bun:sqlite';

import type { NrFeedCategory } from '../commands/list/categories';
import type {
  EventClassification,
  NostrEvent,
  NrAuthorPreference,
  NrAuthorPreferenceValue,
  NrEvent,
  NrFetchRelayCursor,
  NrFetchScope,
  NrFetchStatus,
  NrFetchWindow,
  NrInteraction,
  NrInteractionType,
  NrAudienceReaction,
  NrInterestSignal,
  NrInterestSignalType,
  NrListMode,
  NrListData,
  NrListTimeRange,
  NrListTimeRangeSource,
  NrListTimeSelection,
  NrSignalAuthorAggregate,
  NrSignalTopicAggregate,
  NrUnreadFetchSlot,
  NrTagGroup,
  NrTaxonomyTerm,
  NrTaxonomyTermType,
  NrProfileEvent,
  ParsedNrEventResult,
} from '../commands/shared/types';

export type {
  EventClassification,
  NostrEvent,
  NrAuthorPreference,
  NrAuthorPreferenceValue,
  NrEvent,
  NrFetchRelayCursor,
  NrFetchScope,
  NrFetchStatus,
  NrFetchWindow,
  NrInteraction,
  NrInteractionType,
  NrAudienceReaction,
  NrInterestSignal,
  NrInterestSignalType,
  NrListMode,
  NrListData,
  NrListTimeRange,
  NrListTimeRangeSource,
  NrListTimeSelection,
  NrSignalAuthorAggregate,
  NrSignalTopicAggregate,
  NrUnreadFetchSlot,
  NrTagGroup,
  NrTaxonomyTerm,
  NrTaxonomyTermType,
  NrProfileEvent,
  ParsedNrEventResult,
  NrFeedCategory,
};

export type EventRow = {
  id: string;
  pubkey: string;
  kind: number;
  event_created_at: number;
  content: string;
  raw_json: string;
  inserted_at: number;
  read_at: number | null;
  archived_at: number | null;
  relay_hints_json: string | null;
  thread_context_json: string | null;
  referenced_events_json: string | null;
  summary: string | null;
  model: string | null;
  classified_at: number | null;
  classification_json: string | null;
};

export type TagRow = {
  tag: string;
  count: number;
};

export type FetchWindowRow = {
  id: number;
  since: number;
  until: number;
  scope: string;
  status: string;
  event_count: number;
  relay_count: number;
  author_count: number;
  error: string | null;
  created_at: number;
  updated_at: number;
};

export type FetchRelayCursorRow = {
  since: number;
  until: number;
  scope: string;
  relay: string;
  authors_hash: string;
  authors_json: string;
  next_until: number;
  completed: number;
  fetched_event_count: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

export type SkippedEventRow = {
  event_id: string;
  pubkey: string;
  event_created_at: number;
  reason: string | null;
  model: string | null;
  skipped_at: number;
};

export type EvaluationQueueRow = {
  event_id: string;
  raw_event_json: string;
  relay_hints_json: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  error: string | null;
  created_at: number;
  updated_at: number;
  processing_started_at: number | null;
};

export type NrEvaluationQueueItem = {
  eventId: string;
  event: NostrEvent;
  relayHints: string[];
  attempts: number;
};

export type EnqueueNrEvaluationProps = {
  db: DatabaseType;
  event: NostrEvent;
  relayHints: string[];
};

export type RecoverNrEvaluationQueueProps = {
  db: DatabaseType;
  staleBeforeMs: number;
};

export type FinishNrEvaluationProps = {
  db: DatabaseType;
  eventId: string;
  error: string | null;
};

export type InteractionRow = {
  interaction_event_id: string;
  target_event_id: string;
  user_pubkey: string;
  type: string;
  interaction_created_at: number;
  discovered_at: number;
  source: string;
};

export type InterestSignalRow = {
  target_event_id: string;
  type: string;
  weight: number;
  topics_json: string;
  moods_json: string;
  author_pubkey: string | null;
  source: string;
  created_at: number;
  updated_at: number;
};

export type AuthorPreferenceRow = {
  pubkey: string;
  preference: string;
  created_at: number;
  updated_at: number;
};

export type TaxonomyTermRow = {
  id: number;
  type: string;
  tag: string;
  description: string | null;
  preference: string;
  active: number;
  created_at: number;
  updated_at: number;
};

export type RecordNrFetchWindowProps = {
  db: DatabaseType;
  since: number;
  until: number;
  scope: NrFetchScope;
  status: NrFetchStatus;
  eventCount: number;
  relayCount: number;
  authorCount: number;
  error: string | null;
};

export type ListNrFetchWindowsProps = {
  db: DatabaseType;
  since: number;
  until: number;
  scopes: NrFetchScope[] | null;
};

export type SaveNrFetchRelayCursorProps = {
  db: DatabaseType;
  since: number;
  until: number;
  scope: NrFetchScope;
  relay: string;
  authorsHash: string;
  authors: string[];
  nextUntil: number;
  completed: boolean;
  fetchedEventCount: number;
  lastError: string | null;
};

export type ListNrFetchRelayCursorsProps = {
  db: DatabaseType;
  since: number;
  until: number;
  scope: NrFetchScope;
};

export type RecordNrSkippedEventProps = {
  db: DatabaseType;
  event: NostrEvent;
  classification: EventClassification;
};

export type RecordNrInteractionProps = {
  db: DatabaseType;
  interactionEventId: string;
  targetEventId: string;
  userPubkey: string;
  type: NrInteractionType;
  interactionCreatedAt: number;
  source: 'web';
};

export type MarkTaggedEventsReadProps = {
  db: DatabaseType;
  type: 'topic' | 'mood';
  tag: string;
};

export type MarkTaggedEventsReadResult = {
  type: 'topic' | 'mood';
  tag: string;
  eventCount: number;
};

export type SyncNrTaxonomyTermsProps = {
  db: DatabaseType;
  type: NrTaxonomyTermType;
  interestedTags: string[];
  uninterestedTags: string[];
  newInterestedTag: string | null;
  newUninterestedTag: string | null;
};

export type NrFollowsCache = {
  ownerPubkey: string;
  eventId: string;
  eventCreatedAt: number;
  fetchedAt: number;
  followPubkeys: string[];
};

export type NrImageCacheEntry = {
  imageHash: string;
  mime: string;
  byteSize: number;
  description: string;
  model: string;
  evaluatedAt: number;
};

export type NrEventImage = {
  eventId: string;
  imageHash: string;
  sourceUrl: string;
};

export type NrEventImageEvaluation = {
  eventId: string;
  imageHash: string;
  sourceUrl: string;
  mime: string;
  byteSize: number;
  description: string;
  model: string;
  evaluatedAt: number;
};

export type NrMarkState = 'read' | 'unread' | 'archived' | 'unarchived';

export function safeParseTags(raw: string | null): {
  topics: string[];
  moods: string[];
  language: string;
  relevanceScore?: number;
} {
  if (!raw) {
    return { topics: [], moods: [], language: 'und' };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<EventClassification>;

    return {
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
      moods: Array.isArray(parsed.moods) ? parsed.moods : [],
      language:
        typeof parsed.language === 'string' ? parsed.language.trim() : 'und',
      relevanceScore:
        typeof parsed.relevanceScore === 'number' &&
        Number.isFinite(parsed.relevanceScore) &&
        parsed.relevanceScore >= 0 &&
        parsed.relevanceScore <= 3
          ? parsed.relevanceScore
          : undefined,
    };
  } catch {
    return { topics: [], moods: [], language: 'und' };
  }
}

export function safeParseStringArray(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

export function rowToNrEvent(row: EventRow): NrEvent {
  const parsed = safeParseTags(row.classification_json);

  return {
    id: row.id,
    pubkey: row.pubkey,
    kind: row.kind,
    event_created_at: row.event_created_at,
    content: row.content,
    raw_json: row.raw_json,
    inserted_at: row.inserted_at,
    read_at: row.read_at,
    archived_at: row.archived_at,
    relay_hints: safeParseStringArray(row.relay_hints_json),
    thread_context_json: row.thread_context_json ?? '[]',
    referenced_events_json: row.referenced_events_json ?? '[]',
    summary: row.summary ?? '',
    model: row.model ?? '',
    classified_at: row.classified_at ?? 0,
    classification_json: row.classification_json ?? '{}',
    topics: parsed.topics,
    moods: parsed.moods,
    language: parsed.language || 'und',
  };
}

export function rowToNrFetchWindow(row: FetchWindowRow): NrFetchWindow {
  return {
    id: row.id,
    since: row.since,
    until: row.until,
    scope: row.scope as NrFetchScope,
    status: row.status as NrFetchStatus,
    eventCount: row.event_count,
    relayCount: row.relay_count,
    authorCount: row.author_count,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToNrFetchRelayCursor(
  row: FetchRelayCursorRow,
): NrFetchRelayCursor {
  return {
    since: row.since,
    until: row.until,
    scope: row.scope as NrFetchScope,
    relay: row.relay,
    authorsHash: row.authors_hash,
    authors: safeParseStringArray(row.authors_json),
    nextUntil: row.next_until,
    completed: row.completed === 1,
    fetchedEventCount: row.fetched_event_count,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToNrInteraction(row: InteractionRow): NrInteraction {
  return {
    interactionEventId: row.interaction_event_id,
    targetEventId: row.target_event_id,
    userPubkey: row.user_pubkey,
    type: row.type as NrInteractionType,
    interactionCreatedAt: row.interaction_created_at,
    discoveredAt: row.discovered_at,
    source: row.source as 'web',
  };
}

export function rowToNrTaxonomyTerm(row: TaxonomyTermRow): NrTaxonomyTerm {
  return {
    id: row.id,
    type: row.type as NrTaxonomyTermType,
    tag: row.tag,
    description: row.description,
    preference: row.preference as NrTaxonomyTerm['preference'],
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToNrInterestSignal(
  row: InterestSignalRow,
): NrInterestSignal {
  return {
    targetEventId: row.target_event_id,
    type: row.type as NrInterestSignalType,
    weight: row.weight,
    topics: safeParseStringArray(row.topics_json),
    moods: safeParseStringArray(row.moods_json),
    authorPubkey: row.author_pubkey,
    source: row.source as NrInterestSignal['source'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToNrAuthorPreference(
  row: AuthorPreferenceRow,
): NrAuthorPreference {
  return {
    pubkey: row.pubkey,
    preference: row.preference as NrAuthorPreferenceValue,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToNrEvaluationQueueItem(
  row: EvaluationQueueRow,
): NrEvaluationQueueItem | null {
  try {
    const event = JSON.parse(row.raw_event_json) as NostrEvent;

    return {
      eventId: row.event_id,
      event,
      relayHints: safeParseStringArray(row.relay_hints_json),
      attempts: row.attempts,
    };
  } catch {
    return null;
  }
}
