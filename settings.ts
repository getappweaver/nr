import type { Database } from 'bun:sqlite';

import {
  CapabilityResourceRefSchema,
  type CapabilityResourceRef,
} from '@src/capabilities/types';
import type { AgentBackendName } from '@src/db';
import type { NostrSharePrefixes } from '@src/web/nostr-share';

export type NrSignalReviewMode = 'ask' | 'always' | 'never';

export type NrSettings = {
  backend: AgentBackendName | null;
  model: string | null;
  imageBackend: AgentBackendName | null;
  imageModel: string | null;
  instructions: string;
  eventSharePrefix: string;
  profileSharePrefix: string;
  defaultLanguage: string | null;
  translationTargetLanguage: string | null;
  filterToLatestFetchedSlotOnOpen: boolean;
  alwaysResolveUnresolvedReferences: boolean;
  relayFetchConcurrency: number;
  aiEvaluationConcurrency: number;
  evaluateImages: boolean;
  maxImagesPerEvent: number;
  maxImageBytes: number;
  imageFetchTimeoutSec: number;
  archiveSignalReviewMode: NrSignalReviewMode;
  likeSignalReviewMode: NrSignalReviewMode;
  replySignalReviewMode: NrSignalReviewMode;
  repostQuoteSignalReviewMode: NrSignalReviewMode;
};

export const DEFAULT_NR_SHARE_PREFIX = 'nostr://';
export const DEFAULT_NR_RELAY_FETCH_CONCURRENCY = 3;
export const DEFAULT_NR_AI_EVALUATION_CONCURRENCY = 2;
export const DEFAULT_NR_FILTER_TO_LATEST_FETCHED_SLOT_ON_OPEN = true;
export const DEFAULT_NR_ALWAYS_RESOLVE_UNRESOLVED_REFERENCES = false;
export const DEFAULT_NR_EVALUATE_IMAGES = false;
export const DEFAULT_NR_MAX_IMAGES_PER_EVENT = 1;
export const DEFAULT_NR_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_NR_IMAGE_FETCH_TIMEOUT_SEC = 60;
export const DEFAULT_NR_SIGNAL_REVIEW_MODE: NrSignalReviewMode = 'ask';

export const DEFAULT_NR_CLASSIFICATION_INSTRUCTIONS = `Classify this Nostr event for a personal unread radar.

Interest context:
$NR_CONTEXT

Return ONLY JSON with this shape:
{
  "topics": ["short-topic-tags"],
  "moods": ["short-mood-tags"],
  "summary": "one concise sentence",
  "language": "en",
  "confidence": 0.0,
  "skip": boolean,
  "skipReason": string | null
}

Guidelines:
- Use lowercase, compact, hyphenated tags.
- Treat topics as search/index keywords that identify the concrete subjects of the event.
- Moods describe tone or intent.
- Set "language" to the lowercase BCP 47 code for the event's primary language, such as "en", "tr", or "de". Use "und" only when no language can be determined.
- Make the topics cover the same concrete details captured by the summary.
- Treat interested topics and positive-signal topics as evidence that the user wants to see events centrally about those subjects.
- Treat uninterested topics and negative-signal topics as evidence that the user wants to skip events centrally about those subjects. Manual preferences override inferred signals, and a central interested topic can outweigh an inferred negative topic.
- Do not skip an event merely because it does not match an interested topic, and do not skip for an incidental mention of an uninterested topic.
- Set "skip": true when the event is primarily about an uninterested or negative-signal topic and has no stronger interested-topic reason to retain it.
- Prefer 2-5 topics and 1-3 moods when the event has enough detail.
- Keep one useful broad anchor when relevant, then add specific keywords for the central entities, concepts, and relationships.
- Include named organizations, people, legislation, protocols, products, projects, assets, releases, locations, events, and concrete subtopics when central to the event. Examples include "ditto", "opus-5", "shakespeare", "nip-55", and "clarity-act".
- Prefer meaningful compound keywords when they express the actual focus or relationship, such as "bitcoin-chain-split", "bitcoin-podcast", "bitcoin-governance", "india-protests", "github-india", "nostr-troubleshooting", and "nostr-podcast".
- Prefer varied, specific vocabulary over repeatedly falling back to a small set of broad categories. Do not use "informative", "technical", "casual", "personal", "social", or "general" as topics when concrete keywords are available.
- Use moods only for an expressed tone or intent, not content type. For example, do not use "informative" as a mood.
- If unsure, use topic "general" and mood "neutral".
- If "skip": true, explain briefly in "skipReason".
- If "skip": false, use "skipReason": null.
- Still fill topics, moods, summary, language, and confidence even when "skip": true.`;

const SETTINGS_KEYS = {
  backend: 'backend',
  model: 'model',
  imageBackend: 'image_backend',
  imageModel: 'image_model',
  instructions: 'instructions',
  eventSharePrefix: 'event_share_prefix',
  profileSharePrefix: 'profile_share_prefix',
  defaultLanguage: 'default_language',
  translationTargetLanguage: 'translation_target_language',
  filterToLatestFetchedSlotOnOpen: 'filter_to_latest_fetched_slot_on_open',
  alwaysResolveUnresolvedReferences: 'always_resolve_unresolved_references',
  relayFetchConcurrency: 'relay_fetch_concurrency',
  aiEvaluationConcurrency: 'ai_evaluation_concurrency',
  evaluateImages: 'evaluate_images',
  maxImagesPerEvent: 'max_images_per_event',
  maxImageBytes: 'max_image_bytes',
  imageFetchTimeoutSec: 'image_fetch_timeout_sec',
  archiveSignalReviewMode: 'archive_signal_review_mode',
  likeSignalReviewMode: 'like_signal_review_mode',
  replySignalReviewMode: 'reply_signal_review_mode',
  repostQuoteSignalReviewMode: 'repost_quote_signal_review_mode',
} as const;

const SCHEDULER_RESOURCE_KEY = 'scheduler_resource';

export function createNrSettingsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS nr_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

function getSetting(db: Database, key: string): string | null {
  const row = db
    .prepare('SELECT value FROM nr_settings WHERE key = ?')
    .get(key) as { value: string } | undefined;

  return row?.value ?? null;
}

function setSetting(db: Database, key: string, value: string): void {
  db.run('INSERT OR REPLACE INTO nr_settings (key, value) VALUES (?, ?)', [
    key,
    value,
  ]);
}

function deleteSetting(db: Database, key: string): void {
  db.run('DELETE FROM nr_settings WHERE key = ?', [key]);
}

function parseBackend(value: string | null): AgentBackendName | null {
  if (value === 'cursor' || value === 'opencode') {
    return value;
  }

  return null;
}

function sharePrefix(value: string | null): string {
  return value?.trim() || DEFAULT_NR_SHARE_PREFIX;
}

function relayFetchConcurrency(value: string | null): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_NR_RELAY_FETCH_CONCURRENCY;
}

function aiEvaluationConcurrency(value: string | null): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_NR_AI_EVALUATION_CONCURRENCY;
}

function maxImagesPerEvent(value: string | null): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_NR_MAX_IMAGES_PER_EVENT;
}

function maxImageBytes(value: string | null): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_NR_MAX_IMAGE_BYTES;
}

function imageFetchTimeoutSec(value: string | null): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_NR_IMAGE_FETCH_TIMEOUT_SEC;
}

function booleanSetting(value: string | null, fallback: boolean): boolean {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return fallback;
}

function signalReviewMode(value: string | null): NrSignalReviewMode {
  if (value === 'ask' || value === 'always' || value === 'never') {
    return value;
  }

  return DEFAULT_NR_SIGNAL_REVIEW_MODE;
}

export function nrSharePrefixes(settings: NrSettings): NostrSharePrefixes {
  return {
    nevent: settings.eventSharePrefix,
    nprofile: settings.profileSharePrefix,
  };
}

export function getNrSettings(db: Database): NrSettings {
  return {
    backend: parseBackend(getSetting(db, SETTINGS_KEYS.backend)),
    model: getSetting(db, SETTINGS_KEYS.model),
    imageBackend: parseBackend(getSetting(db, SETTINGS_KEYS.imageBackend)),
    imageModel: getSetting(db, SETTINGS_KEYS.imageModel),
    instructions:
      getSetting(db, SETTINGS_KEYS.instructions) ??
      DEFAULT_NR_CLASSIFICATION_INSTRUCTIONS,
    eventSharePrefix: sharePrefix(
      getSetting(db, SETTINGS_KEYS.eventSharePrefix),
    ),
    profileSharePrefix: sharePrefix(
      getSetting(db, SETTINGS_KEYS.profileSharePrefix),
    ),
    defaultLanguage: getSetting(db, SETTINGS_KEYS.defaultLanguage),
    translationTargetLanguage: getSetting(
      db,
      SETTINGS_KEYS.translationTargetLanguage,
    ),
    filterToLatestFetchedSlotOnOpen: booleanSetting(
      getSetting(db, SETTINGS_KEYS.filterToLatestFetchedSlotOnOpen),
      DEFAULT_NR_FILTER_TO_LATEST_FETCHED_SLOT_ON_OPEN,
    ),
    alwaysResolveUnresolvedReferences: booleanSetting(
      getSetting(db, SETTINGS_KEYS.alwaysResolveUnresolvedReferences),
      DEFAULT_NR_ALWAYS_RESOLVE_UNRESOLVED_REFERENCES,
    ),
    relayFetchConcurrency: relayFetchConcurrency(
      getSetting(db, SETTINGS_KEYS.relayFetchConcurrency),
    ),
    aiEvaluationConcurrency: aiEvaluationConcurrency(
      getSetting(db, SETTINGS_KEYS.aiEvaluationConcurrency),
    ),
    evaluateImages: booleanSetting(
      getSetting(db, SETTINGS_KEYS.evaluateImages),
      DEFAULT_NR_EVALUATE_IMAGES,
    ),
    maxImagesPerEvent: maxImagesPerEvent(
      getSetting(db, SETTINGS_KEYS.maxImagesPerEvent),
    ),
    maxImageBytes: maxImageBytes(getSetting(db, SETTINGS_KEYS.maxImageBytes)),
    imageFetchTimeoutSec: imageFetchTimeoutSec(
      getSetting(db, SETTINGS_KEYS.imageFetchTimeoutSec),
    ),
    archiveSignalReviewMode: signalReviewMode(
      getSetting(db, SETTINGS_KEYS.archiveSignalReviewMode),
    ),
    likeSignalReviewMode: signalReviewMode(
      getSetting(db, SETTINGS_KEYS.likeSignalReviewMode),
    ),
    replySignalReviewMode: signalReviewMode(
      getSetting(db, SETTINGS_KEYS.replySignalReviewMode),
    ),
    repostQuoteSignalReviewMode: signalReviewMode(
      getSetting(db, SETTINGS_KEYS.repostQuoteSignalReviewMode),
    ),
  };
}

type SaveNrSettingsProps = {
  db: Database;
  backend: AgentBackendName | null;
  model: string | null;
  imageBackend: AgentBackendName | null;
  imageModel: string | null;
  instructions: string | null;
  eventSharePrefix: string;
  profileSharePrefix: string;
  defaultLanguage: string | null;
  translationTargetLanguage: string | null;
  filterToLatestFetchedSlotOnOpen: boolean;
  alwaysResolveUnresolvedReferences: boolean;
  relayFetchConcurrency: number;
  aiEvaluationConcurrency: number;
  evaluateImages: boolean;
  maxImagesPerEvent: number;
  maxImageBytes: number;
  imageFetchTimeoutSec: number;
  archiveSignalReviewMode: NrSignalReviewMode;
  likeSignalReviewMode: NrSignalReviewMode;
  replySignalReviewMode: NrSignalReviewMode;
  repostQuoteSignalReviewMode: NrSignalReviewMode;
};

export function saveNrSettings({
  db,
  backend,
  model,
  imageBackend,
  imageModel,
  instructions,
  eventSharePrefix,
  profileSharePrefix,
  defaultLanguage,
  translationTargetLanguage,
  filterToLatestFetchedSlotOnOpen,
  alwaysResolveUnresolvedReferences,
  relayFetchConcurrency,
  aiEvaluationConcurrency,
  evaluateImages,
  maxImagesPerEvent,
  maxImageBytes,
  imageFetchTimeoutSec,
  archiveSignalReviewMode,
  likeSignalReviewMode,
  replySignalReviewMode,
  repostQuoteSignalReviewMode,
}: SaveNrSettingsProps): NrSettings {
  if (backend === null) {
    deleteSetting(db, SETTINGS_KEYS.backend);
  } else {
    setSetting(db, SETTINGS_KEYS.backend, backend);
  }

  if (model === null || model.trim().length === 0) {
    deleteSetting(db, SETTINGS_KEYS.model);
  } else {
    setSetting(db, SETTINGS_KEYS.model, model.trim());
  }

  if (imageBackend === null) {
    deleteSetting(db, SETTINGS_KEYS.imageBackend);
  } else {
    setSetting(db, SETTINGS_KEYS.imageBackend, imageBackend);
  }

  if (imageModel === null || imageModel.trim().length === 0) {
    deleteSetting(db, SETTINGS_KEYS.imageModel);
  } else {
    setSetting(db, SETTINGS_KEYS.imageModel, imageModel.trim());
  }

  if (instructions === null || instructions.trim().length === 0) {
    deleteSetting(db, SETTINGS_KEYS.instructions);
  } else {
    setSetting(db, SETTINGS_KEYS.instructions, instructions.trim());
  }

  setSetting(db, SETTINGS_KEYS.eventSharePrefix, eventSharePrefix.trim());
  setSetting(db, SETTINGS_KEYS.profileSharePrefix, profileSharePrefix.trim());

  if (defaultLanguage === null || defaultLanguage.trim().length === 0) {
    deleteSetting(db, SETTINGS_KEYS.defaultLanguage);
  } else {
    setSetting(db, SETTINGS_KEYS.defaultLanguage, defaultLanguage.trim());
  }

  if (
    translationTargetLanguage === null ||
    translationTargetLanguage.trim().length === 0
  ) {
    deleteSetting(db, SETTINGS_KEYS.translationTargetLanguage);
  } else {
    setSetting(
      db,
      SETTINGS_KEYS.translationTargetLanguage,
      translationTargetLanguage.trim(),
    );
  }

  setSetting(
    db,
    SETTINGS_KEYS.filterToLatestFetchedSlotOnOpen,
    String(filterToLatestFetchedSlotOnOpen),
  );

  setSetting(
    db,
    SETTINGS_KEYS.alwaysResolveUnresolvedReferences,
    String(alwaysResolveUnresolvedReferences),
  );

  setSetting(
    db,
    SETTINGS_KEYS.relayFetchConcurrency,
    String(relayFetchConcurrency),
  );

  setSetting(
    db,
    SETTINGS_KEYS.aiEvaluationConcurrency,
    String(aiEvaluationConcurrency),
  );

  setSetting(db, SETTINGS_KEYS.evaluateImages, String(evaluateImages));

  setSetting(db, SETTINGS_KEYS.maxImagesPerEvent, String(maxImagesPerEvent));

  setSetting(db, SETTINGS_KEYS.maxImageBytes, String(maxImageBytes));

  setSetting(
    db,
    SETTINGS_KEYS.imageFetchTimeoutSec,
    String(imageFetchTimeoutSec),
  );

  setSetting(
    db,
    SETTINGS_KEYS.archiveSignalReviewMode,
    archiveSignalReviewMode,
  );

  setSetting(db, SETTINGS_KEYS.likeSignalReviewMode, likeSignalReviewMode);
  setSetting(db, SETTINGS_KEYS.replySignalReviewMode, replySignalReviewMode);

  setSetting(
    db,
    SETTINGS_KEYS.repostQuoteSignalReviewMode,
    repostQuoteSignalReviewMode,
  );

  return getNrSettings(db);
}

export function resetNrSettings(db: Database): NrSettings {
  deleteSetting(db, SETTINGS_KEYS.backend);
  deleteSetting(db, SETTINGS_KEYS.model);
  deleteSetting(db, SETTINGS_KEYS.imageBackend);
  deleteSetting(db, SETTINGS_KEYS.imageModel);
  deleteSetting(db, SETTINGS_KEYS.instructions);
  deleteSetting(db, SETTINGS_KEYS.eventSharePrefix);
  deleteSetting(db, SETTINGS_KEYS.profileSharePrefix);
  deleteSetting(db, SETTINGS_KEYS.defaultLanguage);
  deleteSetting(db, SETTINGS_KEYS.translationTargetLanguage);
  deleteSetting(db, SETTINGS_KEYS.filterToLatestFetchedSlotOnOpen);
  deleteSetting(db, SETTINGS_KEYS.alwaysResolveUnresolvedReferences);
  deleteSetting(db, SETTINGS_KEYS.relayFetchConcurrency);
  deleteSetting(db, SETTINGS_KEYS.aiEvaluationConcurrency);
  deleteSetting(db, SETTINGS_KEYS.evaluateImages);
  deleteSetting(db, SETTINGS_KEYS.maxImagesPerEvent);
  deleteSetting(db, SETTINGS_KEYS.maxImageBytes);
  deleteSetting(db, SETTINGS_KEYS.imageFetchTimeoutSec);
  deleteSetting(db, SETTINGS_KEYS.archiveSignalReviewMode);
  deleteSetting(db, SETTINGS_KEYS.likeSignalReviewMode);
  deleteSetting(db, SETTINGS_KEYS.replySignalReviewMode);
  deleteSetting(db, SETTINGS_KEYS.repostQuoteSignalReviewMode);

  return getNrSettings(db);
}

export function nrImageAgentSelection(settings: NrSettings): {
  backend: AgentBackendName | null;
  model: string | null;
} {
  return {
    backend: settings.imageBackend ?? settings.backend,
    model: settings.imageModel ?? settings.model,
  };
}

type SaveNrSignalReviewModeProps = {
  db: Database;
  category: 'archive' | 'like' | 'reply' | 'repost_quote';
  mode: NrSignalReviewMode;
};

export function saveNrSignalReviewMode({
  db,
  category,
  mode,
}: SaveNrSignalReviewModeProps): void {
  const key = {
    archive: SETTINGS_KEYS.archiveSignalReviewMode,
    like: SETTINGS_KEYS.likeSignalReviewMode,
    reply: SETTINGS_KEYS.replySignalReviewMode,
    repost_quote: SETTINGS_KEYS.repostQuoteSignalReviewMode,
  }[category];

  setSetting(db, key, mode);
}

export function getNrSchedulerResource(
  db: Database,
): CapabilityResourceRef | null {
  const raw = getSetting(db, SCHEDULER_RESOURCE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = CapabilityResourceRefSchema.safeParse(JSON.parse(raw));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveNrSchedulerResource(
  db: Database,
  resource: CapabilityResourceRef,
): void {
  setSetting(db, SCHEDULER_RESOURCE_KEY, JSON.stringify(resource));
}
