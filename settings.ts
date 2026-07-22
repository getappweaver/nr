import type { Database } from 'bun:sqlite';

import type { AgentBackendName } from '@src/db';
import type { NostrSharePrefixes } from '@src/web/nostr-share';

export type NrSettings = {
  backend: AgentBackendName | null;
  model: string | null;
  instructions: string;
  eventSharePrefix: string;
  profileSharePrefix: string;
  relayFetchConcurrency: number;
  aiEvaluationConcurrency: number;
};

export const DEFAULT_NR_SHARE_PREFIX = 'nostr://';
export const DEFAULT_NR_RELAY_FETCH_CONCURRENCY = 3;
export const DEFAULT_NR_AI_EVALUATION_CONCURRENCY = 2;

export const DEFAULT_NR_CLASSIFICATION_INSTRUCTIONS = `Classify this Nostr event for a personal unread radar.

Existing taxonomy context:
$NR_CONTEXT

Return ONLY JSON with this shape:
{
  "topics": ["short-topic-tags"],
  "moods": ["short-mood-tags"],
  "summary": "one concise sentence",
  "confidence": 0.0,
  "skip": boolean,
  "skipReason": string | null
}

Guidelines:
- Use lowercase, compact tags.
- Topics describe what the event is about.
- Moods describe tone or intent.
- Reuse existing topic and mood tags from the context when they match.
- Consolidate similar concepts into the existing tags instead of creating near-duplicates.
- Prefer 2-5 topics and 1-3 moods when the event has enough detail.
- Include specific, durable topic tags for named organizations, people, legislation, protocols, products, assets, and concrete subtopics when central to the event. Use lowercase hyphenated forms, such as "blackrock", "clarity-act", and "bitcoin-price".
- Keep a useful broad topic alongside specific tags when relevant, such as "bitcoin" with "bitcoin-price". Do not use generic labels such as "informative" as topics.
- Use moods only for an expressed tone or intent, not content type. For example, do not use "informative" as a mood.
- If unsure, use topic "general" and mood "neutral".
- Set "skip": true only when the event is not useful for this user's unread radar, only if the user is defined that below.
- If "skip": true, explain briefly in "skipReason".
- If "skip": false, use "skipReason": null.
- Still fill topics, moods, summary, and confidence even when "skip": true.`;

const SETTINGS_KEYS = {
  backend: 'backend',
  model: 'model',
  instructions: 'instructions',
  eventSharePrefix: 'event_share_prefix',
  profileSharePrefix: 'profile_share_prefix',
  relayFetchConcurrency: 'relay_fetch_concurrency',
  aiEvaluationConcurrency: 'ai_evaluation_concurrency',
} as const;

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
    instructions:
      getSetting(db, SETTINGS_KEYS.instructions) ??
      DEFAULT_NR_CLASSIFICATION_INSTRUCTIONS,
    eventSharePrefix: sharePrefix(
      getSetting(db, SETTINGS_KEYS.eventSharePrefix),
    ),
    profileSharePrefix: sharePrefix(
      getSetting(db, SETTINGS_KEYS.profileSharePrefix),
    ),
    relayFetchConcurrency: relayFetchConcurrency(
      getSetting(db, SETTINGS_KEYS.relayFetchConcurrency),
    ),
    aiEvaluationConcurrency: aiEvaluationConcurrency(
      getSetting(db, SETTINGS_KEYS.aiEvaluationConcurrency),
    ),
  };
}

type SaveNrSettingsProps = {
  db: Database;
  backend: AgentBackendName | null;
  model: string | null;
  instructions: string | null;
  eventSharePrefix: string;
  profileSharePrefix: string;
  relayFetchConcurrency: number;
  aiEvaluationConcurrency: number;
};

export function saveNrSettings({
  db,
  backend,
  model,
  instructions,
  eventSharePrefix,
  profileSharePrefix,
  relayFetchConcurrency,
  aiEvaluationConcurrency,
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

  if (instructions === null || instructions.trim().length === 0) {
    deleteSetting(db, SETTINGS_KEYS.instructions);
  } else {
    setSetting(db, SETTINGS_KEYS.instructions, instructions.trim());
  }

  setSetting(db, SETTINGS_KEYS.eventSharePrefix, eventSharePrefix.trim());
  setSetting(db, SETTINGS_KEYS.profileSharePrefix, profileSharePrefix.trim());

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

  return getNrSettings(db);
}

export function resetNrSettings(db: Database): NrSettings {
  deleteSetting(db, SETTINGS_KEYS.backend);
  deleteSetting(db, SETTINGS_KEYS.model);
  deleteSetting(db, SETTINGS_KEYS.instructions);
  deleteSetting(db, SETTINGS_KEYS.eventSharePrefix);
  deleteSetting(db, SETTINGS_KEYS.profileSharePrefix);
  deleteSetting(db, SETTINGS_KEYS.relayFetchConcurrency);
  deleteSetting(db, SETTINGS_KEYS.aiEvaluationConcurrency);

  return getNrSettings(db);
}
