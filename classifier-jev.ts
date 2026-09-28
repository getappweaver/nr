import type { Database } from 'bun:sqlite';

import type { EventClassification, NostrEvent } from './commands/shared/types';
import { buildNrPluginContextText } from './context';
import { listActiveNrTaxonomyTerms, listNrInterestSignals } from './db';
import { getNrJevApiKey, getNrSettings } from './settings';

type ChoiceAnswer = {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
type ScoreAnswer = { type: 'score'; score: number; confidence: number };
type JevAnswer = ChoiceAnswer | ScoreAnswer;
type JevResult = { model?: string; answers: Record<string, JevAnswer> };
type JevQuestion =
  | {
      type: 'choice';
      instructions: string;
      criteria: Record<string, string | null>;
    }
  | { type: 'score'; instructions: string; criteria: string[] };

function candidates(raw: string, extra: string[], limit: number): string[] {
  return [
    ...new Set(
      [...extra, ...raw.split(/[,\n]/)]
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0 && value.length <= 80),
    ),
  ].slice(0, limit);
}

function choice(
  answers: Record<string, JevAnswer>,
  id: string,
  options: string[],
): ChoiceAnswer {
  const answer = answers[id];

  if (
    answer?.type !== 'choice' ||
    !options.includes(answer.choice) ||
    !Number.isFinite(answer.confidence)
  ) {
    throw new Error(`Invalid Jev answer: ${id}`);
  }

  return answer;
}

function batches<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}

async function requestJev({
  url,
  apiKey,
  body,
  abortSignal,
}: {
  url: string;
  apiKey: string;
  body: string;
  abortSignal: AbortSignal | null;
}): Promise<JevResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: abortSignal,
    });

    if (response.ok) {
      const result = (await response.json()) as Partial<JevResult>;

      if (!result.answers) {
        throw new Error('Invalid Jev evaluation response.');
      }

      return { model: result.model, answers: result.answers };
    }

    if (attempt === 2 || (response.status !== 429 && response.status !== 529)) {
      throw new Error(`Jev evaluation failed (HTTP ${response.status}).`);
    }

    await Bun.sleep(300 * 2 ** attempt);

    if (abortSignal?.aborted) {
      throw new Error('Jev evaluation cancelled.');
    }
  }

  throw new Error('Jev evaluation failed after retries.');
}

export async function classifyEventWithJev({
  db,
  event,
  threadContextEvents,
  referencedEvents,
  abortSignal,
}: {
  db: Database;
  event: NostrEvent;
  threadContextEvents: NostrEvent[];
  referencedEvents: NostrEvent[];
  abortSignal: AbortSignal | null;
}): Promise<EventClassification> {
  const settings = getNrSettings(db);
  const apiKey = getNrJevApiKey(db) ?? '';

  if (!apiKey) {
    throw new Error(
      'Jev API key is required in NR settings for classifier mode.',
    );
  }

  const manual = listActiveNrTaxonomyTerms({ db, type: 'topic' });
  const signals = listNrInterestSignals(db);
  const signalWeights = new Map<string, number>();
  const signalMoodWeights = new Map<string, number>();

  for (const signal of signals) {
    for (const topic of signal.topics) {
      signalWeights.set(
        topic,
        (signalWeights.get(topic) ?? 0) + Math.abs(signal.weight),
      );
    }

    for (const mood of signal.moods) {
      signalMoodWeights.set(
        mood,
        (signalMoodWeights.get(mood) ?? 0) + Math.abs(signal.weight),
      );
    }
  }

  const topicOptions = candidates(
    settings.jevTopics,
    [
      ...manual.map((term) => term.tag),
      ...event.tags.filter((tag) => tag[0] === 't').map((tag) => tag[1] ?? ''),
      ...[...signalWeights.keys()].sort(
        (left, right) =>
          (signalWeights.get(right) ?? 0) - (signalWeights.get(left) ?? 0),
      ),
    ],
    200,
  ).filter((topic) => topic !== 'none');

  const moodOptions = candidates(
    settings.jevMoods,
    [
      'neutral',
      ...listActiveNrTaxonomyTerms({ db, type: 'mood' }).map(
        (term) => term.tag,
      ),
      ...[...signalMoodWeights.keys()].sort(
        (left, right) =>
          (signalMoodWeights.get(right) ?? 0) -
          (signalMoodWeights.get(left) ?? 0),
      ),
    ],
    64,
  ).filter((mood) => mood !== 'none');

  const languageOptions = candidates(
    settings.jevLanguages,
    event.tags.filter((tag) => tag[0] === 'l').map((tag) => tag[1] ?? ''),
    40,
  ).filter((language) => /^[a-z]{2}$/.test(language) || language === 'und');

  if (!languageOptions.includes('und')) {
    languageOptions.push('und');
  }

  if (topicOptions.length === 0) {
    throw new Error('Configure at least one Jev topic in NR settings.');
  }

  if (moodOptions.length === 0) {
    throw new Error('Configure at least one Jev mood in NR settings.');
  }

  const topicBatches = batches(topicOptions, settings.jevTopicBatchSize);
  const moodBatches = batches(moodOptions, settings.jevTopicBatchSize);

  const questions: Record<string, JevQuestion> = {
    language: {
      type: 'choice',
      instructions: `${settings.jevStateInstructions}\n${settings.jevLanguageQuestion}`,
      criteria: Object.fromEntries(
        languageOptions.map((language) => [language, null]),
      ),
    },
    relevance: {
      type: 'score',
      instructions: `${settings.jevStateInstructions}\n${settings.jevRelevanceQuestion}`,
      criteria: [
        'Centrally about a manually uninterested topic, with no stronger interested reason to retain it.',
        'No clear interested or uninterested topic is central to the event.',
        'Centrally matches a positive inferred signal or an interested topic.',
        'Strong central match to a manual interested topic.',
      ],
    },
  };

  for (const [index, topics] of topicBatches.entries()) {
    questions[`topic_${index}`] = {
      type: 'choice',
      instructions: `${settings.jevStateInstructions}\n${settings.jevTopicQuestion}`,
      criteria: Object.fromEntries([
        ...topics.map((topic) => [topic, null] as const),
        [
          'none',
          'No candidate topic in this question describes the central subject.',
        ],
      ]),
    };
  }

  for (const [index, moods] of moodBatches.entries()) {
    questions[`mood_${index}`] = {
      type: 'choice',
      instructions: `${settings.jevStateInstructions}\n${settings.jevMoodQuestion} Choose none if no mood in this question fits.`,
      criteria: Object.fromEntries([
        ...moods.map((mood) => [mood, null] as const),
        ['none', 'No mood in this question is clearly expressed.'],
      ]),
    };
  }

  const state = {
    event: { content: event.content, tags: event.tags, kind: event.kind },
    thread: threadContextEvents.map((item) => item.content),
    references: referencedEvents.map((item) => item.content),
    preferences: buildNrPluginContextText(db),
  };

  const base = settings.jevApiBase.replace(/\/+$/, '');

  const result = await requestJev({
    url: `${base}/v1/systemone`,
    apiKey,
    body: JSON.stringify({ model: 'jev-latest', state, questions }),
    abortSignal,
  });

  const answers = result.answers;

  const language = choice(answers, 'language', languageOptions);
  const relevance = answers.relevance;

  if (
    relevance?.type !== 'score' ||
    !Number.isFinite(relevance.score) ||
    relevance.score < 0 ||
    relevance.score > 3 ||
    !Number.isFinite(relevance.confidence)
  ) {
    throw new Error('Invalid Jev relevance answer.');
  }

  const topics: string[] = [];
  const topicConfidences: number[] = [];

  for (const [batchIndex, batchTopics] of topicBatches.entries()) {
    const primary = choice(answers, `topic_${batchIndex}`, [
      ...batchTopics,
      'none',
    ]);

    topicConfidences.push(primary.confidence);

    if (primary.choice !== 'none') {
      topics.push(primary.choice);
    }
  }

  const moods: string[] = [];
  const moodConfidences: number[] = [];

  for (const [index, batchMoods] of moodBatches.entries()) {
    const selected = choice(answers, `mood_${index}`, [...batchMoods, 'none']);

    moodConfidences.push(selected.confidence);

    if (selected.choice !== 'none') {
      moods.push(selected.choice);
    }
  }

  const expressedMoods = moods.filter((mood) => mood !== 'neutral');

  // No explicit negative preference means a neutral post must not be discarded.
  const hasNegativePreferences =
    manual.some((term) => term.preference === 'uninterested') ||
    signals.some((signal) => signal.weight < 0);

  const skip =
    hasNegativePreferences &&
    relevance.score < 0.5 &&
    relevance.confidence >= 0.65;

  return {
    evaluationMode: 'classifier',
    summary: '',
    topics: topics.length ? topics : ['general'],
    moods: expressedMoods.length ? expressedMoods : ['neutral'],
    language: language.choice,
    model: result.model ?? 'jev-latest',
    confidence: Math.min(
      ...topicConfidences,
      ...moodConfidences,
      language.confidence,
      relevance.confidence,
    ),
    relevanceScore: relevance.score,
    skip,
    skipReason: skip ? 'Central match to an uninterested topic.' : null,
  };
}
