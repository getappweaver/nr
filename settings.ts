import type { Database } from 'bun:sqlite';

import type { AgentBackendName } from '@src/db';

export type NrSettings = {
  backend: AgentBackendName | null;
  model: string | null;
  instructions: string;
};

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
- Prefer 1-5 topics and 1-3 moods.
- If unsure, use topic "general" and mood "neutral".
- Set "skip": true only when the event is not useful for this user's unread radar, only if the user is defined that below.
- If "skip": true, explain briefly in "skipReason".
- If "skip": false, use "skipReason": null.
- Still fill topics, moods, summary, and confidence even when "skip": true.`;

const SETTINGS_KEYS = {
  backend: 'backend',
  model: 'model',
  instructions: 'instructions',
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

export function getNrSettings(db: Database): NrSettings {
  return {
    backend: parseBackend(getSetting(db, SETTINGS_KEYS.backend)),
    model: getSetting(db, SETTINGS_KEYS.model),
    instructions:
      getSetting(db, SETTINGS_KEYS.instructions) ??
      DEFAULT_NR_CLASSIFICATION_INSTRUCTIONS,
  };
}

type SaveNrSettingsProps = {
  db: Database;
  backend: AgentBackendName | null;
  model: string | null;
  instructions: string | null;
};

export function saveNrSettings({
  db,
  backend,
  model,
  instructions,
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

  return getNrSettings(db);
}

export function resetNrSettings(db: Database): NrSettings {
  deleteSetting(db, SETTINGS_KEYS.backend);
  deleteSetting(db, SETTINGS_KEYS.model);
  deleteSetting(db, SETTINGS_KEYS.instructions);

  return getNrSettings(db);
}
