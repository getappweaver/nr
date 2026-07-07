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
});

export type NrEvent = z.infer<typeof NrEventSchema>;

export type NrTagGroup = {
  type: 'topic' | 'mood';
  tag: string;
  unreadCount: number;
  events: NrEvent[];
};

export type NrListMode = 'timeline' | 'archive';

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

export type NrTaxonomyTermType = 'topic' | 'mood';

export type NrTaxonomyTerm = {
  id: number;
  type: NrTaxonomyTermType;
  tag: string;
  description: string | null;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

export type NrListData = {
  mode: NrListMode;
  topicGroups: NrTagGroup[];
  moodGroups: NrTagGroup[];
  unreadTotal: number;
  fetchWindows: NrFetchWindow[];
  interactions: NrInteraction[];
  taxonomyTerms: NrTaxonomyTerm[];
  settings: NrSettings;
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
  model: string;
  confidence: number;
  skip: boolean;
  skipReason: string | null;
};

export type Nr = NrEvent;
