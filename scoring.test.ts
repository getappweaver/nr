import { expect, test } from 'bun:test';

import type { NrEvent } from './commands/shared/types';
import { scoreNrEventForYou } from './db';

function eventWithTopics(topics: string[]): NrEvent {
  return {
    id: 'event',
    pubkey: 'author',
    kind: 1,
    event_created_at: 1,
    content: '',
    raw_json: '{}',
    inserted_at: 1,
    read_at: null,
    archived_at: null,
    relay_hints: [],
    thread_context_json: '[]',
    referenced_events_json: '[]',
    summary: '',
    model: 'test',
    classified_at: 1,
    classification_json: '{}',
    topics,
    moods: [],
    language: 'en',
  };
}

function score(topics: string[], affinities: Record<string, number>): number {
  return scoreNrEventForYou({
    event: eventWithTopics(topics),
    topicAffinities: new Map(Object.entries(affinities)),
    learnedAuthorAffinities: new Map(),
    explicitAuthorBiases: new Map(),
  });
}

test('uses exact topic affinity at full weight', () => {
  expect(score(['concord-protocol'], { 'concord-protocol': 5 })).toBe(5);
});

test('uses hierarchical topic affinity at reduced weight', () => {
  expect(score(['concord'], { 'concord-protocol': 5 })).toBe(2.5);
  expect(score(['concord-protocol'], { concord: 5 })).toBe(2.5);
});

test('does not partially match unrelated or suffix-only topics', () => {
  expect(score(['discord'], { concord: 5 })).toBe(0);
  expect(score(['protocol'], { 'concord-protocol': 5 })).toBe(0);
});

test('combines stored Jev relevance with topic and author affinities', () => {
  const event = eventWithTopics(['nostr']);

  event.classification_json = JSON.stringify({ relevanceScore: 2.5 });

  expect(
    scoreNrEventForYou({
      event,
      topicAffinities: new Map([['nostr', 5]]),
      learnedAuthorAffinities: new Map(),
      explicitAuthorBiases: new Map(),
    }),
  ).toBe(8);
});
