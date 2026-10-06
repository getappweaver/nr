import type { Database as DatabaseType } from 'bun:sqlite';

import type {
  AuthorPreferenceRow,
  InteractionRow,
  InterestSignalRow,
  NrAudienceReaction,
  NrAuthorPreference,
  NrAuthorPreferenceValue,
  NrInteraction,
  NrInterestSignal,
  NrInterestSignalType,
  RecordNrInteractionProps,
} from './types';
import {
  rowToNrAuthorPreference,
  rowToNrInteraction,
  rowToNrInterestSignal,
  safeParseStringArray,
} from './types';

export const NR_INTEREST_WEIGHTS: Record<NrInterestSignalType, number> = {
  like: 1,
  reply: 2,
  repost: 3,
  quote: 2,
  archive: 5,
  local_like: 5,
  local_dislike: -5,
};

export function normalizeSignalAuthorPubkey(pubkey: unknown): string | null {
  if (typeof pubkey !== 'string') {
    return null;
  }

  const normalized = pubkey.trim().toLowerCase();

  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

export function scoringTopics(topics: string[]): string[] {
  return [
    ...new Set(
      topics
        .map((topic) => topic.trim().toLowerCase())
        .filter((topic) => topic && topic !== 'general'),
    ),
  ];
}

export function recordNrInteraction({
  db,
  interactionEventId,
  targetEventId,
  userPubkey,
  type,
  interactionCreatedAt,
  source,
}: RecordNrInteractionProps): NrInteraction {
  const discoveredAt = Date.now();

  db.run(
    `
    INSERT INTO nr_interactions (
      interaction_event_id,
      target_event_id,
      user_pubkey,
      type,
      interaction_created_at,
      discovered_at,
      source
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(interaction_event_id) DO UPDATE SET
      target_event_id = excluded.target_event_id,
      user_pubkey = excluded.user_pubkey,
      type = excluded.type,
      interaction_created_at = excluded.interaction_created_at,
      discovered_at = excluded.discovered_at,
      source = excluded.source
  `,
    [
      interactionEventId,
      targetEventId,
      userPubkey,
      type,
      interactionCreatedAt,
      discoveredAt,
      source,
    ],
  );

  const row = db
    .prepare('SELECT * FROM nr_interactions WHERE interaction_event_id = ?')
    .get(interactionEventId) as InteractionRow | undefined;

  if (!row) {
    throw new Error(`Failed to record interaction ${interactionEventId}`);
  }

  return rowToNrInteraction(row);
}

export function listNrInteractions(db: DatabaseType): NrInteraction[] {
  const rows = db
    .prepare(
      `
      SELECT *
      FROM nr_interactions
      ORDER BY interaction_created_at DESC
    `,
    )
    .all() as InteractionRow[];

  return rows.map(rowToNrInteraction);
}

export function listNrAudienceReactions(
  db: DatabaseType,
  targetEventId: string,
): NrAudienceReaction[] {
  const rows = db
    .prepare(
      `SELECT event.pubkey, event.content, event.event_created_at
       FROM nr_activity_targets target
       JOIN nr_events event ON event.id = target.activity_event_id
       WHERE target.target_event_id = ? AND event.kind = 7
       ORDER BY event.event_created_at DESC`,
    )
    .all(targetEventId) as Array<{
    pubkey: string;
    content: string;
    event_created_at: number;
  }>;

  const byPubkey = new Map<string, NrAudienceReaction>();

  for (const row of rows) {
    if (!byPubkey.has(row.pubkey)) {
      byPubkey.set(row.pubkey, {
        pubkey: row.pubkey,
        content: row.content,
        createdAt: row.event_created_at,
      });
    }
  }

  return [...byPubkey.values()];
}

function interestTags({
  db,
  targetEventId,
  type,
}: {
  db: DatabaseType;
  targetEventId: string;
  type: 'topic' | 'mood';
}): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT tag
       FROM (
         SELECT tag.tag
         FROM nr_event_tags tag
         WHERE tag.event_id = ? AND tag.type = ?
         UNION
         SELECT tag.tag
         FROM nr_activity_targets activity
         JOIN nr_event_tags tag ON tag.event_id = activity.activity_event_id
         WHERE activity.target_event_id = ? AND tag.type = ?
       )
       ORDER BY tag COLLATE NOCASE ASC`,
    )
    .all(targetEventId, type, targetEventId, type) as Array<{ tag: string }>;

  return rows.map((row) => row.tag);
}

export type RecordReviewedNrInterestSignalProps = {
  db: DatabaseType;
  targetEventId: string;
  type: NrInterestSignalType;
  createdAt: number;
  topics: string[];
  moods?: string[];
  authorPubkey: string | null;
  source: NrInterestSignal['source'];
};

export function recordReviewedNrInterestSignal({
  db,
  targetEventId,
  type,
  createdAt,
  topics,
  moods,
  authorPubkey,
  source,
}: RecordReviewedNrInterestSignalProps): NrInterestSignal {
  const now = Date.now();
  const normalizedAuthorPubkey = normalizeSignalAuthorPubkey(authorPubkey);

  db.run(
    `INSERT INTO nr_interest_signals (
       target_event_id, type, weight, topics_json, moods_json, author_pubkey, source, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(target_event_id, type) DO UPDATE SET
       weight = excluded.weight,
       topics_json = excluded.topics_json,
       moods_json = excluded.moods_json,
       author_pubkey = excluded.author_pubkey,
       source = excluded.source,
       updated_at = excluded.updated_at`,
    [
      targetEventId,
      type,
      NR_INTEREST_WEIGHTS[type],
      JSON.stringify(topics),
      JSON.stringify(
        moods ?? interestTags({ db, targetEventId, type: 'mood' }),
      ),
      normalizedAuthorPubkey,
      source,
      createdAt,
      now,
    ],
  );

  const row = db
    .prepare(
      'SELECT * FROM nr_interest_signals WHERE target_event_id = ? AND type = ?',
    )
    .get(targetEventId, type) as InterestSignalRow | null;

  if (!row) {
    throw new Error(`Failed to record ${type} signal for ${targetEventId}`);
  }

  return rowToNrInterestSignal(row);
}

export function removeNrInterestSignal({
  db,
  targetEventId,
  type,
}: {
  db: DatabaseType;
  targetEventId: string;
  type: NrInterestSignalType;
}): void {
  db.run(
    'DELETE FROM nr_interest_signals WHERE target_event_id = ? AND type = ?',
    [targetEventId, type],
  );
}

export type DeleteNrTopicSignalsProps = {
  db: DatabaseType;
  topic: string;
};

export function deleteNrTopicSignals({
  db,
  topic,
}: DeleteNrTopicSignalsProps): number {
  const normalized = topic.trim().toLowerCase();

  if (!normalized) {
    return 0;
  }

  return db.transaction(() => {
    const targets = listNrInterestSignals(db).filter((signal) =>
      scoringTopics(signal.topics).includes(normalized),
    );

    const remove = db.prepare(
      'DELETE FROM nr_interest_signals WHERE target_event_id = ? AND type = ?',
    );

    for (const signal of targets) {
      remove.run(signal.targetEventId, signal.type);
    }

    return targets.length;
  })();
}

export type DeleteNrAuthorSignalsProps = {
  db: DatabaseType;
  authorPubkey: string;
};

export function deleteNrAuthorSignals({
  db,
  authorPubkey,
}: DeleteNrAuthorSignalsProps): number {
  const normalized = normalizeSignalAuthorPubkey(authorPubkey);

  if (normalized === null) {
    return 0;
  }

  return db.transaction(() => {
    const targets = listNrInterestSignals(db).filter(
      (signal) =>
        normalizeSignalAuthorPubkey(signal.authorPubkey) === normalized,
    );

    const remove = db.prepare(
      'DELETE FROM nr_interest_signals WHERE target_event_id = ? AND type = ?',
    );

    for (const signal of targets) {
      remove.run(signal.targetEventId, signal.type);
    }

    return targets.length;
  })();
}

export function getNrSignalReviewTarget({
  db,
  targetEventId,
}: {
  db: DatabaseType;
  targetEventId: string;
}): {
  id: string;
  pubkey: string;
  kind: number;
  relayHints: string[];
} | null {
  const row = db
    .prepare(
      'SELECT id, pubkey, kind, relay_hints_json FROM nr_events WHERE id = ?',
    )
    .get(targetEventId) as {
    id: string;
    pubkey: string;
    kind: number;
    relay_hints_json: string | null;
  } | null;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    pubkey: row.pubkey,
    kind: row.kind,
    relayHints: safeParseStringArray(row.relay_hints_json),
  };
}

export function getNrSignalReviewTargetAuthor({
  db,
  targetEventId,
}: {
  db: DatabaseType;
  targetEventId: string;
}): string | null {
  return normalizeSignalAuthorPubkey(
    getNrSignalReviewTarget({ db, targetEventId })?.pubkey ?? null,
  );
}

export function listNrDirectSignalReviewTopics({
  db,
  targetEventId,
}: {
  db: DatabaseType;
  targetEventId: string;
}): string[] {
  const rows = db
    .prepare(
      `SELECT tag
       FROM nr_event_tags
       WHERE event_id = ? AND type = 'topic'
       ORDER BY tag COLLATE NOCASE ASC`,
    )
    .all(targetEventId) as Array<{ tag: string }>;

  return scoringTopics(rows.map((row) => row.tag));
}

export function recordNrInterestSignal({
  db,
  targetEventId,
  type,
  createdAt,
  topics: providedTopics,
  moods: providedMoods,
  source,
}: {
  db: DatabaseType;
  targetEventId: string;
  type: NrInterestSignalType;
  createdAt: number;
  topics: string[] | null;
  moods: string[] | null;
  source: NrInterestSignal['source'];
}): NrInterestSignal {
  const topics =
    providedTopics ?? interestTags({ db, targetEventId, type: 'topic' });

  return recordReviewedNrInterestSignal({
    db,
    targetEventId,
    type,
    createdAt,
    topics,
    moods: providedMoods ?? interestTags({ db, targetEventId, type: 'mood' }),
    authorPubkey: null,
    source,
  });
}

export function listNrInterestSignals(db: DatabaseType): NrInterestSignal[] {
  const signals = (
    db
      .prepare(
        'SELECT * FROM nr_interest_signals ORDER BY updated_at DESC, target_event_id ASC',
      )
      .all() as InterestSignalRow[]
  ).map(rowToNrInterestSignal);

  if (!signals.some((signal) => signal.moods.length === 0)) {
    return signals;
  }

  // Older signals recorded [] even when the target event had classified moods.
  const moodRows = db
    .prepare(
      `SELECT DISTINCT signal.target_event_id AS target_event_id, tag.tag AS tag
       FROM nr_interest_signals signal
       JOIN nr_event_tags tag ON tag.event_id = signal.target_event_id AND tag.type = 'mood'
       UNION
       SELECT DISTINCT signal.target_event_id AS target_event_id, tag.tag AS tag
       FROM nr_interest_signals signal
       JOIN nr_activity_targets activity ON activity.target_event_id = signal.target_event_id
       JOIN nr_event_tags tag ON tag.event_id = activity.activity_event_id AND tag.type = 'mood'`,
    )
    .all() as Array<{ target_event_id: string; tag: string }>;

  const moodsByTarget = new Map<string, string[]>();

  for (const row of moodRows) {
    const moods = moodsByTarget.get(row.target_event_id) ?? [];

    moods.push(row.tag);
    moodsByTarget.set(row.target_event_id, moods);
  }

  return signals.map((signal) => ({
    ...signal,
    moods:
      signal.moods.length > 0
        ? signal.moods
        : (moodsByTarget.get(signal.targetEventId) ?? []),
  }));
}

export function clearSeededNrInterestSignals(db: DatabaseType): number {
  const existing = db
    .prepare(
      "SELECT COUNT(*) AS count FROM nr_interest_signals WHERE source = 'seed'",
    )
    .get() as { count: number };

  db.run("DELETE FROM nr_interest_signals WHERE source = 'seed'");

  return existing.count;
}

export function setNrLocalPreference({
  db,
  targetEventId,
  preference,
}: {
  db: DatabaseType;
  targetEventId: string;
  preference: 'like' | 'dislike' | 'none';
}): NrInterestSignal | null {
  return db.transaction(() => {
    db.run(
      `DELETE FROM nr_interest_signals
       WHERE target_event_id = ?
         AND type IN ('local_like', 'local_dislike')`,
      [targetEventId],
    );

    if (preference === 'none') {
      return null;
    }

    return recordNrInterestSignal({
      db,
      targetEventId,
      type: preference === 'like' ? 'local_like' : 'local_dislike',
      createdAt: Date.now(),
      topics: null,
      moods: null,
      source: 'private',
    });
  })();
}

export function setNrAuthorPreference({
  db,
  pubkey,
  preference,
}: {
  db: DatabaseType;
  pubkey: string;
  preference: NrAuthorPreferenceValue | 'none';
}): NrAuthorPreference | null {
  const normalizedPubkey = pubkey.trim().toLowerCase();

  if (!normalizedPubkey) {
    return null;
  }

  return db.transaction(() => {
    const now = Date.now();

    if (preference === 'none') {
      db.run('DELETE FROM nr_author_preferences WHERE pubkey = ?', [
        normalizedPubkey,
      ]);

      return null;
    }

    db.run(
      `INSERT INTO nr_author_preferences (pubkey, preference, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(pubkey) DO UPDATE SET
         preference = excluded.preference,
         updated_at = excluded.updated_at`,
      [normalizedPubkey, preference, now, now],
    );

    const row = db
      .prepare('SELECT * FROM nr_author_preferences WHERE pubkey = ?')
      .get(normalizedPubkey) as AuthorPreferenceRow | null;

    return row ? rowToNrAuthorPreference(row) : null;
  })();
}

export function listNrAuthorPreferences(
  db: DatabaseType,
): NrAuthorPreference[] {
  return (
    db
      .prepare(
        'SELECT * FROM nr_author_preferences ORDER BY updated_at DESC, pubkey ASC',
      )
      .all() as AuthorPreferenceRow[]
  ).map(rowToNrAuthorPreference);
}

export function getNrAuthorPreference({
  db,
  pubkey,
}: {
  db: DatabaseType;
  pubkey: string;
}): NrAuthorPreference | null {
  const normalizedPubkey = pubkey.trim().toLowerCase();

  if (!normalizedPubkey) {
    return null;
  }

  const row = db
    .prepare('SELECT * FROM nr_author_preferences WHERE pubkey = ?')
    .get(normalizedPubkey) as AuthorPreferenceRow | null;

  return row ? rowToNrAuthorPreference(row) : null;
}
