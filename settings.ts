import type { Database } from 'bun:sqlite';

import {
  CapabilityResourceRefSchema,
  type CapabilityResourceRef,
} from '@src/capabilities/types';
type LegacyAgentBackendName = 'opencode' | 'cursor';
import type { NostrSharePrefixes } from '@src/web/nostr-share';

export type NrSignalReviewMode = 'ask' | 'always' | 'never';
export type NrEvaluationMode = 'llm' | 'classifier';

export type NrSettings = {
  mode: NrEvaluationMode;
  jevApiBase: string;
  jevHasApiKey: boolean;
  jevTopics: string;
  jevTopicBatchSize: number;
  jevMoods: string;
  jevLanguages: string;
  jevStateInstructions: string;
  jevTopicQuestion: string;
  jevMoodQuestion: string;
  jevLanguageQuestion: string;
  jevRelevanceQuestion: string;
  backend: LegacyAgentBackendName | null;
  model: string | null;
  imageBackend: LegacyAgentBackendName | null;
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
export const DEFAULT_NR_JEV_API_BASE = 'https://api.typesafe.ai';
export const DEFAULT_NR_JEV_TOPICS =
  'nostr, bitcoin, ai, software, privacy, music, art, politics, science, health, finance, sports, food, travel';
export const DEFAULT_NR_JEV_TOPIC_BATCH_SIZE = 10;
export const DEFAULT_NR_JEV_MOODS =
  'neutral, happy, funny, thoughtful, sad, angry, inviting';
export const DEFAULT_NR_JEV_LANGUAGES =
  'en, tr, de, es, fr, pt, it, nl, ja, zh, ko, ar, ru, und';
export const DEFAULT_NR_JEV_STATE_INSTRUCTIONS =
  'Classify the central content of `event`. Use `thread` and `references` only to disambiguate the event. Treat `preferences` as personal relevance signals, not as descriptions of the event.';
export const DEFAULT_NR_JEV_TOPIC_QUESTION =
  'Which candidate topic is most central to `event`? Choose none if none fits; do not infer a topic just because it is in `preferences`.';
export const DEFAULT_NR_JEV_MOOD_QUESTION =
  'What tone or intent does `event` express? Choose neutral if no other mood is clearly expressed.';
export const DEFAULT_NR_JEV_LANGUAGE_QUESTION =
  'What is the primary language of `event.content`? Choose und when it cannot be determined.';
export const DEFAULT_NR_JEV_RELEVANCE_QUESTION =
  'How relevant is `event` to the user given `preferences`? A passing mention is not a central match. Explicit manual preferences take priority over inferred signals.';

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
  mode: 'mode',
  jevApiKey: 'jev_api_key',
  jevApiBase: 'jev_api_base',
  jevTopics: 'jev_topics',
  jevTopicBatchSize: 'jev_topic_batch_size',
  jevMoods: 'jev_moods',
  jevLanguages: 'jev_languages',
  jevStateInstructions: 'jev_state_instructions',
  jevTopicQuestion: 'jev_topic_question',
  jevMoodQuestion: 'jev_mood_question',
  jevLanguageQuestion: 'jev_language_question',
  jevRelevanceQuestion: 'jev_relevance_question',
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

function parseBackend(value: string | null): LegacyAgentBackendName | null {
  return value === 'opencode' || value === 'cursor' ? 'opencode' : null;
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

function jevTopicBatchSize(value: string | null): number {
  const parsed = value ? Number(value) : Number.NaN;

  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 50
    ? parsed
    : DEFAULT_NR_JEV_TOPIC_BATCH_SIZE;
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
    mode:
      getSetting(db, SETTINGS_KEYS.mode) === 'classifier'
        ? 'classifier'
        : 'llm',
    jevApiBase:
      getSetting(db, SETTINGS_KEYS.jevApiBase) || DEFAULT_NR_JEV_API_BASE,
    jevHasApiKey: Boolean(getNrJevApiKey(db)),
    jevTopics: getSetting(db, SETTINGS_KEYS.jevTopics) ?? DEFAULT_NR_JEV_TOPICS,
    jevTopicBatchSize: jevTopicBatchSize(
      getSetting(db, SETTINGS_KEYS.jevTopicBatchSize),
    ),
    jevMoods: getSetting(db, SETTINGS_KEYS.jevMoods) ?? DEFAULT_NR_JEV_MOODS,
    jevLanguages:
      getSetting(db, SETTINGS_KEYS.jevLanguages) ?? DEFAULT_NR_JEV_LANGUAGES,
    jevStateInstructions:
      getSetting(db, SETTINGS_KEYS.jevStateInstructions) ??
      DEFAULT_NR_JEV_STATE_INSTRUCTIONS,
    jevTopicQuestion:
      getSetting(db, SETTINGS_KEYS.jevTopicQuestion) ??
      DEFAULT_NR_JEV_TOPIC_QUESTION,
    jevMoodQuestion:
      getSetting(db, SETTINGS_KEYS.jevMoodQuestion) ??
      DEFAULT_NR_JEV_MOOD_QUESTION,
    jevLanguageQuestion:
      getSetting(db, SETTINGS_KEYS.jevLanguageQuestion) ??
      DEFAULT_NR_JEV_LANGUAGE_QUESTION,
    jevRelevanceQuestion:
      getSetting(db, SETTINGS_KEYS.jevRelevanceQuestion) ??
      DEFAULT_NR_JEV_RELEVANCE_QUESTION,
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
  mode: NrEvaluationMode;
  jevApiKey?: string | null;
  jevApiBase: string;
  jevTopics: string;
  jevTopicBatchSize: number;
  jevMoods: string;
  jevLanguages: string;
  jevStateInstructions: string;
  jevTopicQuestion: string;
  jevMoodQuestion: string;
  jevLanguageQuestion: string;
  jevRelevanceQuestion: string;
  backend: LegacyAgentBackendName | null;
  model: string | null;
  imageBackend: LegacyAgentBackendName | null;
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
  mode,
  jevApiKey,
  jevApiBase,
  jevTopics,
  jevTopicBatchSize,
  jevMoods,
  jevLanguages,
  jevStateInstructions,
  jevTopicQuestion,
  jevMoodQuestion,
  jevLanguageQuestion,
  jevRelevanceQuestion,
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
  setSetting(db, SETTINGS_KEYS.mode, mode);

  if (jevApiKey !== undefined) {
    if (jevApiKey?.trim()) {
      setSetting(db, SETTINGS_KEYS.jevApiKey, jevApiKey.trim());
    } else {
      deleteSetting(db, SETTINGS_KEYS.jevApiKey);
    }
  }

  for (const [key, value] of [
    [SETTINGS_KEYS.jevApiBase, jevApiBase],
    [SETTINGS_KEYS.jevTopics, jevTopics],
    [SETTINGS_KEYS.jevTopicBatchSize, String(jevTopicBatchSize)],
    [SETTINGS_KEYS.jevMoods, jevMoods],
    [SETTINGS_KEYS.jevLanguages, jevLanguages],
    [SETTINGS_KEYS.jevStateInstructions, jevStateInstructions],
    [SETTINGS_KEYS.jevTopicQuestion, jevTopicQuestion],
    [SETTINGS_KEYS.jevMoodQuestion, jevMoodQuestion],
    [SETTINGS_KEYS.jevLanguageQuestion, jevLanguageQuestion],
    [SETTINGS_KEYS.jevRelevanceQuestion, jevRelevanceQuestion],
  ]) {
    setSetting(db, key, value);
  }

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
  for (const key of [
    SETTINGS_KEYS.mode,
    SETTINGS_KEYS.jevApiKey,
    SETTINGS_KEYS.jevApiBase,
    SETTINGS_KEYS.jevTopics,
    SETTINGS_KEYS.jevTopicBatchSize,
    SETTINGS_KEYS.jevMoods,
    SETTINGS_KEYS.jevLanguages,
    SETTINGS_KEYS.jevStateInstructions,
    SETTINGS_KEYS.jevTopicQuestion,
    SETTINGS_KEYS.jevMoodQuestion,
    SETTINGS_KEYS.jevLanguageQuestion,
    SETTINGS_KEYS.jevRelevanceQuestion,
  ]) {
    deleteSetting(db, key);
  }

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

export function getNrJevApiKey(db: Database): string | null {
  return getSetting(db, SETTINGS_KEYS.jevApiKey);
}

export function nrImageAgentSelection(settings: NrSettings): {
  backend: LegacyAgentBackendName | null;
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

export function clearNrSchedulerResource(db: Database): void {
  deleteSetting(db, SCHEDULER_RESOURCE_KEY);
}
