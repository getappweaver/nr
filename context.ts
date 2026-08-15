import type { Database } from 'bun:sqlite';

import { listActiveNrTaxonomyTerms, listNrInterestSignals } from './db';

type ScoredTopic = {
  tag: string;
  score: number;
};

const CONTEXT_TOPIC_LIMIT = 40;

function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase();
}

function formatTopics(topics: string[]): string {
  return topics.length > 0 ? topics.join(', ') : '(none yet)';
}

function signalTopics({
  db,
  polarity,
  excludedTopics,
}: {
  db: Database;
  polarity: 'positive' | 'negative';
  excludedTopics: Set<string>;
}): string[] {
  const scores = new Map<string, number>();

  for (const signal of listNrInterestSignals(db)) {
    if (
      (polarity === 'positive' && signal.weight <= 0) ||
      (polarity === 'negative' && signal.weight >= 0)
    ) {
      continue;
    }

    const topics = [
      ...new Set(
        signal.topics
          .map(normalizeTopic)
          .filter(
            (topic) =>
              topic.length > 0 &&
              topic !== 'general' &&
              !excludedTopics.has(topic),
          ),
      ),
    ];

    if (topics.length === 0) {
      continue;
    }

    const contribution = Math.abs(signal.weight) / topics.length;

    for (const topic of topics) {
      scores.set(topic, (scores.get(topic) ?? 0) + contribution);
    }
  }

  return [...scores.entries()]
    .map(([tag, score]): ScoredTopic => ({ tag, score }))
    .sort(
      (left, right) =>
        right.score - left.score || left.tag.localeCompare(right.tag),
    )
    .slice(0, CONTEXT_TOPIC_LIMIT)
    .map((topic) => topic.tag);
}

export function buildNrPluginContextText(db: Database): string {
  const manualTerms = listActiveNrTaxonomyTerms({ db, type: 'topic' });

  const interestedTopics = manualTerms
    .filter((term) => term.preference === 'interested')
    .map((term) => term.tag);

  const uninterestedTopics = manualTerms
    .filter((term) => term.preference === 'uninterested')
    .map((term) => term.tag);

  const manualTopics = new Set([...interestedTopics, ...uninterestedTopics]);

  const positiveSignalTopics = signalTopics({
    db,
    polarity: 'positive',
    excludedTopics: manualTopics,
  });

  const negativeSignalTopics = signalTopics({
    db,
    polarity: 'negative',
    excludedTopics: manualTopics,
  });

  return [
    'Use these preferences to judge radar relevance. Manual preferences override inferred signals. A topic match must be central to the event, not an incidental mention.',
    `Interested topics (manual): ${formatTopics(interestedTopics)}`,
    `Uninterested topics (manual): ${formatTopics(uninterestedTopics)}`,
    `Topics inferred from positive signals: ${formatTopics(positiveSignalTopics)}`,
    `Topics inferred from negative signals: ${formatTopics(negativeSignalTopics)}`,
  ].join('\n');
}
