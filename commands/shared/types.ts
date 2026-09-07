import { z } from 'zod';

import type { NrSettings } from '../../settings';

export const NostrEventSchema = z.object({
  id: z.string().min(1),
  pubkey: z.string().min(1),
  created_at: z.number().int(),
  kind: z.number().int(),
  tags: z.array(z.array(z.string())),
  content: z.string(),
  sig: z.string().min(1),
});

export type NostrEvent = z.infer<typeof NostrEventSchema>;

export const NrEventSchema = z.object({
  id: z.string(),
  pubkey: z.string(),
  kind: z.number(),
  event_created_at: z.number(),
  content: z.string(),
  raw_json: z.string(),
  inserted_at: z.number(),
  read_at: z.number().nullable(),
  archived_at: z.number().nullable(),
  relay_hints: z.array(z.string()),
  thread_context_json: z.string(),
  referenced_events_json: z.string(),
  summary: z.string(),
  model: z.string(),
  classified_at: z.number(),
  classification_json: z.string(),
  topics: z.array(z.string()),
  moods: z.array(z.string()),
  language: z.string(),
});

export type NrEvent = z.infer<typeof NrEventSchema>;

export type NrTagGroup = {
  type: 'topic' | 'mood' | 'language';
  tag: string;
  unreadCount: number;
  events: NrEvent[];
};

export type NrListMode =
  'timeline' | 'for-you' | 'profile' | 'archive' | 'signals';

export type NrListTimeRange = {
  since: number;
  until: number;
};

export type NrListTimeRangeSource = 'request' | 'latest-fetched-slot' | 'none';

export type NrListTimeSelection = {
  initialized: boolean;
  ranges: NrListTimeRange[];
};

export type NrUnreadFetchSlot = {
  since: number;
  until: number;
  status: Extract<NrFetchStatus, 'fetched' | 'partial'>;
  unreadCount: number;
};

export type NrFetchScope = 'follows';

export type NrFetchStatus = 'fetched' | 'partial' | 'failed';

export type NrFetchWindow = {
  id: number;
  since: number;
  until: number;
  scope: NrFetchScope;
  status: NrFetchStatus;
  eventCount: number;
  relayCount: number;
  authorCount: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};

export type NrFetchRelayCursor = {
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
  createdAt: number;
  updatedAt: number;
};

export type NrInteractionType = 'liked' | 'replied' | 'reposted' | 'quoted';

export type NrInteraction = {
  interactionEventId: string;
  targetEventId: string;
  userPubkey: string;
  type: NrInteractionType;
  interactionCreatedAt: number;
  discoveredAt: number;
  source: 'web';
};

export type NrAudienceReaction = {
  pubkey: string;
  content: string;
  createdAt: number;
};

export type NrInterestSignalType =
  | 'like'
  | 'reply'
  | 'repost'
  | 'quote'
  | 'archive'
  | 'local_like'
  | 'local_dislike';

export type NrInterestSignal = {
  targetEventId: string;
  type: NrInterestSignalType;
  weight: number;
  topics: string[];
  moods: string[];
  authorPubkey: string | null;
  source: 'interaction' | 'archive' | 'private' | 'seed';
  createdAt: number;
  updatedAt: number;
};

export type NrAuthorPreferenceValue = 'like' | 'dislike';

export type NrAuthorPreference = {
  pubkey: string;
  preference: NrAuthorPreferenceValue;
  createdAt: number;
  updatedAt: number;
};

export type NrTaxonomyTermType = 'topic' | 'mood';

export type NrTaxonomyPreference = 'interested' | 'uninterested';

export type NrTaxonomyTerm = {
  id: number;
  type: NrTaxonomyTermType;
  tag: string;
  description: string | null;
  preference: NrTaxonomyPreference;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

export type NrSignalTopicAggregate = {
  topic: string;
  signalCount: number;
  totalWeight: number;
  affinity: number;
  matchedEventCount: number;
  byType: Array<{ type: NrInterestSignalType; count: number; weight: number }>;
  signals: NrInterestSignal[];
};

export type NrSignalAuthorAggregate = {
  authorPubkey: string;
  signalCount: number;
  totalWeight: number;
  learnedAffinity: number;
  matchedEventCount: number;
  byType: Array<{ type: NrInterestSignalType; count: number; weight: number }>;
  signals: NrInterestSignal[];
};

export type NrListData = {
  mode: NrListMode;
  selectedTimeRanges: NrListTimeRange[];
  selectedTimeRangeSource: NrListTimeRangeSource;
  timeFilterInitialized: boolean;
  selectedCategories: import('../list/categories').NrFeedCategory[];
  profileEvents: NrProfileEvent[];
  forYouEvents: NrEvent[];
  forYouHasMore: boolean;
  forYouScores: Record<string, number>;
  archivedEventIds: string[];
  evaluatedImageCounts: Record<string, number>;
  conversationContextEvents: NrEvent[];
  activityEvents: NrEvent[];
  topicGroups: NrTagGroup[];
  moodGroups: NrTagGroup[];
  languageGroups: NrTagGroup[];
  unreadTotal: number;
  fetchCoverageNowSeconds: number;
  fetchWindows: NrFetchWindow[];
  unreadFetchSlots: NrUnreadFetchSlot[];
  interactions: NrInteraction[];
  interestSignals: NrInterestSignal[];
  signalTopicAggregates: NrSignalTopicAggregate[];
  signalAuthorAggregates: NrSignalAuthorAggregate[];
  authorPreferences: NrAuthorPreference[];
  taxonomyTerms: NrTaxonomyTerm[];
  settings: NrSettings;
};

export type NrProfileEvent = {
  event: NostrEvent;
  referencedEvents: NostrEvent[];
};

export type ParsedNrEventResult = {
  event: NrEvent;
  inserted: boolean;
  reclassified: boolean;
};

export type EventClassification = {
  topics: string[];
  moods: string[];
  summary: string;
  language: string;
  model: string;
  confidence: number;
  skip: boolean;
  skipReason: string | null;
};

export type Nr = NrEvent;
