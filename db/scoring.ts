import type { Database as DatabaseType, SQLQueryBindings } from 'bun:sqlite';
import type { Event as NostrEvent } from 'nostr-tools';

import { calculateZapScore, parseZapReceipt } from '../zap';

import {
  NR_INTEREST_WEIGHTS,
  normalizeSignalAuthorPubkey,
  scoringTopics,
} from './signals';
import type {
  NrAuthorPreference,
  NrAuthorPreferenceValue,
  NrEvent,
  NrInterestSignal,
  NrInterestSignalType,
  NrSignalAuthorAggregate,
  NrSignalTopicAggregate,
} from './types';
import { safeParseTags } from './types';

export function buildNrTopicAffinities(
  signals: NrInterestSignal[],
): Map<string, number> {
  const affinities = new Map<string, number>();

  for (const signal of signals) {
    const topics = scoringTopics(signal.topics);

    if (topics.length === 0) {
      continue;
    }

    const contribution = signal.weight / topics.length;

    for (const topic of topics) {
      affinities.set(topic, (affinities.get(topic) ?? 0) + contribution);
    }
  }

  return affinities;
}

export const NR_AUTHOR_PREFERENCE_WEIGHTS: Record<
  NrAuthorPreferenceValue,
  number
> = {
  like: 2,
  dislike: -6,
};

export function buildNrLearnedAuthorAffinities(
  signals: NrInterestSignal[],
): Map<string, number> {
  const rawAffinities = new Map<string, number>();

  for (const signal of signals) {
    const normalizedPubkey = normalizeSignalAuthorPubkey(signal.authorPubkey);

    if (normalizedPubkey === null) {
      continue;
    }

    rawAffinities.set(
      normalizedPubkey,
      (rawAffinities.get(normalizedPubkey) ?? 0) + signal.weight,
    );
  }

  return new Map(
    [...rawAffinities].map(([pubkey, raw]) => [
      pubkey,
      1.5 * Math.tanh(raw / 5),
    ]),
  );
}

export function buildNrExplicitAuthorBiases(
  preferences: NrAuthorPreference[],
): Map<string, number> {
  const biases = new Map<string, number>();

  for (const preference of preferences) {
    biases.set(
      preference.pubkey.toLowerCase(),
      NR_AUTHOR_PREFERENCE_WEIGHTS[preference.preference],
    );
  }

  return biases;
}

export const buildNrAuthorAffinities = buildNrExplicitAuthorBiases;

export type CountNrEventsWithTopicProps = {
  db: DatabaseType;
  topic: string;
};

export function countNrEventsWithTopicIncludingRead({
  db,
  topic,
}: CountNrEventsWithTopicProps): number {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT e.id) AS count
       FROM nr_events e
       JOIN nr_event_tags t ON t.event_id = e.id
       WHERE t.type = 'topic' AND t.tag = ? COLLATE NOCASE`,
    )
    .get(topic) as { count: number } | undefined;

  return row?.count ?? 0;
}

export type CountNrEventsWithAuthorProps = {
  db: DatabaseType;
  authorPubkey: string;
};

export function countNrEventsWithAuthorIncludingRead({
  db,
  authorPubkey,
}: CountNrEventsWithAuthorProps): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM nr_events
       WHERE pubkey = ? COLLATE NOCASE`,
    )
    .get(authorPubkey) as { count: number } | undefined;

  return row?.count ?? 0;
}

export type BuildNrSignalAggregatesProps = {
  db: DatabaseType;
  signals: NrInterestSignal[];
  topicAffinities: ReadonlyMap<string, number>;
  learnedAuthorAffinities: ReadonlyMap<string, number>;
};

export type BuildNrSignalAggregatesResult = {
  topicAggregates: NrSignalTopicAggregate[];
  authorAggregates: NrSignalAuthorAggregate[];
};

export function buildNrSignalAggregates({
  db,
  signals,
  topicAffinities,
  learnedAuthorAffinities,
}: BuildNrSignalAggregatesProps): BuildNrSignalAggregatesResult {
  const byTopic = new Map<string, NrInterestSignal[]>();
  const byAuthor = new Map<string, NrInterestSignal[]>();

  for (const signal of signals) {
    for (const topic of scoringTopics(signal.topics)) {
      const list = byTopic.get(topic) ?? [];

      list.push(signal);
      byTopic.set(topic, list);
    }

    const normalizedAuthor = normalizeSignalAuthorPubkey(signal.authorPubkey);

    if (normalizedAuthor !== null) {
      const list = byAuthor.get(normalizedAuthor) ?? [];

      list.push(signal);
      byAuthor.set(normalizedAuthor, list);
    }
  }

  const topicAggregates: NrSignalTopicAggregate[] = [...byTopic.entries()].map(
    ([topic, topicSignals]) => {
      const byTypeMap = new Map<NrInterestSignalType, NrInterestSignal[]>();

      for (const signal of topicSignals) {
        const list = byTypeMap.get(signal.type) ?? [];

        list.push(signal);
        byTypeMap.set(signal.type, list);
      }

      const byType = [...byTypeMap.entries()]
        .map(([type, typeSignals]) => ({
          type,
          count: typeSignals.length,
          weight: NR_INTEREST_WEIGHTS[type] ?? 0,
        }))
        .sort((left, right) => right.count - left.count);

      const sortedSignals = [...topicSignals].sort(
        (left, right) => right.updatedAt - left.updatedAt,
      );

      return {
        topic,
        signalCount: topicSignals.length,
        totalWeight: topicSignals.reduce(
          (total, signal) => total + signal.weight,
          0,
        ),
        affinity: topicAffinities.get(topic) ?? 0,
        matchedEventCount: countNrEventsWithTopicIncludingRead({ db, topic }),
        byType,
        signals: sortedSignals,
      };
    },
  );

  topicAggregates.sort(
    (left, right) =>
      right.totalWeight - left.totalWeight ||
      right.matchedEventCount - left.matchedEventCount ||
      left.topic.localeCompare(right.topic),
  );

  const authorAggregates: NrSignalAuthorAggregate[] = [
    ...byAuthor.entries(),
  ].map(([authorPubkey, authorSignals]) => {
    const byTypeMap = new Map<NrInterestSignalType, NrInterestSignal[]>();

    for (const signal of authorSignals) {
      const list = byTypeMap.get(signal.type) ?? [];

      list.push(signal);
      byTypeMap.set(signal.type, list);
    }

    const byType = [...byTypeMap.entries()]
      .map(([type, typeSignals]) => ({
        type,
        count: typeSignals.length,
        weight: NR_INTEREST_WEIGHTS[type] ?? 0,
      }))
      .sort((left, right) => right.count - left.count);

    const sortedSignals = [...authorSignals].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );

    return {
      authorPubkey,
      signalCount: sortedSignals.length,
      totalWeight: sortedSignals.reduce(
        (total, signal) => total + signal.weight,
        0,
      ),
      learnedAffinity: learnedAuthorAffinities.get(authorPubkey) ?? 0,
      matchedEventCount: countNrEventsWithAuthorIncludingRead({
        db,
        authorPubkey,
      }),
      byType,
      signals: sortedSignals,
    };
  });

  authorAggregates.sort(
    (left, right) =>
      right.totalWeight - left.totalWeight ||
      right.matchedEventCount - left.matchedEventCount ||
      left.authorPubkey.localeCompare(right.authorPubkey),
  );

  return { topicAggregates, authorAggregates };
}

export function getZappedSatsByTarget(
  db: DatabaseType,
  targetEventIds?: string[],
): Map<string, number> {
  let sql = `
    SELECT activity.target_event_id, e.raw_json
    FROM nr_activity_targets activity
    JOIN nr_events e ON e.id = activity.activity_event_id
    WHERE e.kind = 9735
  `;
  const params: SQLQueryBindings[] = [];

  if (targetEventIds && targetEventIds.length > 0) {
    const placeholders = targetEventIds.map(() => '?').join(',');
    sql += ` AND activity.target_event_id IN (${placeholders})`;
    params.push(...targetEventIds);
  }

  const rows = db.prepare(sql).all(...params) as Array<{
    target_event_id: string;
    raw_json: string;
  }>;

  const result = new Map<string, number>();

  for (const row of rows) {
    try {
      const zapReceipt = JSON.parse(row.raw_json) as NostrEvent;
      const parsed = parseZapReceipt(zapReceipt);

      if (parsed.amountSats > 0) {
        result.set(
          row.target_event_id,
          (result.get(row.target_event_id) ?? 0) + parsed.amountSats,
        );
      }
    } catch {
      // ignore
    }
  }

  return result;
}

export type ScoreNrEventForYouProps = {
  event: NrEvent;
  topicAffinities: ReadonlyMap<string, number>;
  learnedAuthorAffinities: ReadonlyMap<string, number>;
  explicitAuthorBiases: ReadonlyMap<string, number>;
  zapSats?: number;
};

export function scoreNrEventForYou({
  event,
  topicAffinities,
  learnedAuthorAffinities,
  explicitAuthorBiases,
  zapSats = 0,
}: ScoreNrEventForYouProps): number {
  const topics = scoringTopics(event.topics);
  const normalizedPubkey = event.pubkey.toLowerCase();

  const authorScore =
    (learnedAuthorAffinities.get(normalizedPubkey) ?? 0) +
    (explicitAuthorBiases.get(normalizedPubkey) ?? 0);

  const savedClassification = safeParseTags(event.classification_json);

  const relevanceBias =
    savedClassification.relevanceScore === undefined
      ? 0
      : (savedClassification.relevanceScore - 1) * 2;

  const zapScore = calculateZapScore(zapSats);

  if (topics.length === 0) {
    return authorScore + relevanceBias + zapScore;
  }

  const total = topics.reduce(
    (score, topic) => score + topicAffinityScore(topic, topicAffinities),
    0,
  );

  return total / topics.length + authorScore + relevanceBias + zapScore;
}

export function topicAffinityScore(
  topic: string,
  affinities: ReadonlyMap<string, number>,
): number {
  const exact = affinities.get(topic);

  if (exact !== undefined) {
    return exact;
  }

  let strongest = 0;

  for (const [candidate, affinity] of affinities) {
    const shorter = topic.length <= candidate.length ? topic : candidate;
    const longer = shorter === topic ? candidate : topic;

    if (shorter.length < 3 || !longer.startsWith(`${shorter}-`)) {
      continue;
    }

    const similarity =
      shorter.split('-').length /
      Math.max(topic.split('-').length, candidate.split('-').length);

    const weighted = affinity * similarity;

    if (Math.abs(weighted) > Math.abs(strongest)) {
      strongest = weighted;
    }
  }

  return strongest;
}
