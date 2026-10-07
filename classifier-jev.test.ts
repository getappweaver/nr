import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import type {
  SystemOneEvaluateInputV1,
  SystemOneEvaluateOutputV1,
} from '@src/capabilities/system-one.v1';
import type { CapabilityClient } from '@src/capabilities/types';

import { classifyEventWithJev } from './classifier-jev';
import type { NostrEvent } from './commands/shared/types';
import {
  createNrTable,
  listNrInterestSignals,
  recordNrInterestSignal,
} from './db';
import {
  createNrSettingsTable,
  getNrSettings,
  saveNrSettings,
} from './settings';

const event: NostrEvent = {
  id: 'event',
  pubkey: 'author',
  created_at: 1,
  kind: 1,
  tags: [['t', 'nostr']],
  content: 'A new Nostr relay is live',
  sig: 'sig',
};

function systemOneCapabilities(
  respond: (input: SystemOneEvaluateInputV1) => SystemOneEvaluateOutputV1,
): CapabilityClient {
  return {
    listProviders: () => [],
    invoke: async ({ input }: { input: unknown }) => ({
      status: 'success',
      provider: {} as never,
      output: respond(input as SystemOneEvaluateInputV1),
    }),
  } as unknown as CapabilityClient;
}

const missingCapabilities = {
  listProviders: () => [],
  invoke: async () => ({
    status: 'missing',
    capability: { name: 'system-one', version: 1 },
    operation: 'capability:v1:system-one.evaluate',
    requestedProviderId: null,
  }),
} as unknown as CapabilityClient;

test('Jev classifier sends bounded candidate questions and maps typed judgments', async () => {
  const db = new Database(':memory:');

  createNrTable(db);
  createNrSettingsTable(db);

  saveNrSettings({
    ...getNrSettings(db),
    db,
    mode: 'classifier',
    jevTopics: 'nostr, music',
  });

  const captured = { request: null as SystemOneEvaluateInputV1 | null };

  const capabilities = systemOneCapabilities((input) => {
    captured.request = input;

    return {
      model: 'jev-1.13.0',
      answers: {
        topic_0: {
          type: 'choice',
          choice: 'nostr',
          confidence: 0.9,
          probabilities: { nostr: 0.9, music: 0.1 },
        },
        mood_0: {
          type: 'choice',
          choice: 'neutral',
          confidence: 0.9,
          probabilities: { neutral: 0.9 },
        },
        language: {
          type: 'choice',
          choice: 'en',
          confidence: 0.9,
          probabilities: { en: 0.9 },
        },
        relevance: { type: 'score', score: 2.1, confidence: 0.85 },
      },
    };
  });

  try {
    const result = await classifyEventWithJev({
      db,
      event,
      threadContextEvents: [],
      referencedEvents: [],
      abortSignal: null,
      capabilities,
    });

    expect(result).toMatchObject({
      summary: '',
      evaluationMode: 'classifier',
      topics: ['nostr'],
      moods: ['neutral'],
      language: 'en',
      model: 'jev-1.13.0',
      skip: false,
    });

    expect(captured.request?.model).toBeNull();
    expect(captured.request?.questions.topic_0?.type).toBe('choice');
    expect(captured.request?.questions.mood_0?.type).toBe('choice');
    expect(captured.request?.state.preferences).toContain('Interested topics');
  } finally {
    db.close();
  }
});

test('Jev clones topic and mood Choice questions in one request for large catalogs', async () => {
  const db = new Database(':memory:');

  createNrTable(db);
  createNrSettingsTable(db);

  saveNrSettings({
    ...getNrSettings(db),
    db,
    mode: 'classifier',
    jevTopics: Array.from({ length: 50 }, (_, index) => `topic-${index}`).join(
      ', ',
    ),
    jevMoods: Array.from({ length: 12 }, (_, index) => `mood-${index}`).join(
      ', ',
    ),
    jevTopicBatchSize: 10,
  });

  recordNrInterestSignal({
    db,
    targetEventId: 'other',
    type: 'local_like',
    createdAt: 1,
    topics: ['signal-topic'],
    moods: ['reflective'],
    source: 'private',
  });

  const requests: SystemOneEvaluateInputV1[] = [];

  const capabilities = systemOneCapabilities((request) => {
    requests.push(request);

    const answers: SystemOneEvaluateOutputV1['answers'] = {
      language: { type: 'choice', choice: 'en', confidence: 1 },
      relevance: { type: 'score', score: 1, confidence: 1 },
    };

    for (const [id, question] of Object.entries(request.questions)) {
      if (!id.startsWith('topic_') && !id.startsWith('mood_')) {
        continue;
      }

      const selected =
        'topic-49' in question.criteria
          ? 'topic-49'
          : 'reflective' in question.criteria
            ? 'reflective'
            : 'none';

      answers[id] = {
        type: 'choice',
        choice: selected,
        confidence: 1,
        probabilities: { [selected]: 1 },
      };
    }

    return { model: 'jev-1.13.0', answers };
  });

  try {
    const result = await classifyEventWithJev({
      db,
      event: { ...event, tags: [] },
      threadContextEvents: [],
      referencedEvents: [],
      abortSignal: null,
      capabilities,
    });

    expect(result.topics).toEqual(['topic-49']);
    expect(result.moods).toEqual(['reflective']);
    expect(result.summary).toBe('');
    expect(requests).toHaveLength(1);

    const questions = requests[0]!.questions;

    const choiceQuestions = Object.entries(questions) as Array<
      [string, { criteria: Record<string, unknown> }]
    >;

    const topicQuestions = choiceQuestions.filter(([id]) =>
      id.startsWith('topic_'),
    );

    const moodQuestions = choiceQuestions.filter(([id]) =>
      id.startsWith('mood_'),
    );

    expect(topicQuestions).toHaveLength(6);
    expect(moodQuestions).toHaveLength(2);

    expect(
      [...topicQuestions, ...moodQuestions].every(
        ([, question]) => Object.keys(question.criteria).length <= 11,
      ),
    ).toBe(true);

    expect(
      topicQuestions.flatMap(([, question]) => Object.keys(question.criteria)),
    ).toContain('topic-49');
  } finally {
    db.close();
  }
});

test('classifier mode requires an installed System One provider instead of silently falling back', async () => {
  const db = new Database(':memory:');

  createNrTable(db);
  createNrSettingsTable(db);

  try {
    await expect(
      classifyEventWithJev({
        db,
        event,
        threadContextEvents: [],
        referencedEvents: [],
        abortSignal: null,
        capabilities: missingCapabilities,
      }),
    ).rejects.toThrow('No System One capability provider');
  } finally {
    db.close();
  }
});

test('classifier delegates retries to the System One capability provider', async () => {
  const db = new Database(':memory:');

  createNrTable(db);
  createNrSettingsTable(db);

  saveNrSettings({
    ...getNrSettings(db),
    db,
    mode: 'classifier',
    jevTopics: 'nostr',
  });

  let calls = 0;

  const capabilities = systemOneCapabilities((_input) => {
    calls += 1;

    return {
      model: 'jev-1.13.0',
      answers: {
        topic_0: {
          type: 'choice',
          choice: 'none',
          confidence: 1,
          probabilities: { none: 1 },
        },
        mood_0: {
          type: 'choice',
          choice: 'neutral',
          confidence: 1,
          probabilities: { neutral: 1 },
        },
        language: { type: 'choice', choice: 'en', confidence: 1 },
        relevance: { type: 'score', score: 1, confidence: 1 },
      },
    };
  });

  try {
    await classifyEventWithJev({
      db,
      event: { ...event, tags: [] },
      threadContextEvents: [],
      referencedEvents: [],
      abortSignal: null,
      capabilities,
    });

    expect(calls).toBe(1);
  } finally {
    db.close();
  }
});

test('previously recorded signals recover moods from classified target tags', () => {
  const db = new Database(':memory:');

  createNrTable(db);

  db.run(
    "INSERT INTO nr_events (id, pubkey, kind, event_created_at, content, raw_json, inserted_at) VALUES ('target', 'author', 1, 1, 'text', '{}', 1)",
  );

  db.run(
    "INSERT INTO nr_event_tags (event_id, type, tag) VALUES ('target', 'mood', 'curious')",
  );

  db.run(
    "INSERT INTO nr_interest_signals (target_event_id, type, weight, topics_json, moods_json, source, created_at, updated_at) VALUES ('target', 'like', 1, '[]', '[]', 'private', 1, 1)",
  );

  expect(listNrInterestSignals(db)[0]?.moods).toEqual(['curious']);
  db.close();
});
