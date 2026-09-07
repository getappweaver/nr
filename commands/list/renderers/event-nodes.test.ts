import { expect, test } from 'bun:test';
import {
  finalizeEvent,
  generateSecretKey,
  nip19,
  type Event,
} from 'nostr-tools';

import { WebNostrPostElementPropsSchema } from '@src/web/ui-schema';

import type { NrEvent } from '../../shared/types';

import { groupEventNodes } from './event-nodes';

function storedEvent(event: Event, readAt: number | null = null): NrEvent {
  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    event_created_at: event.created_at,
    content: event.content,
    raw_json: JSON.stringify(event),
    inserted_at: event.created_at * 1000,
    read_at: readAt,
    archived_at: null,
    relay_hints: [],
    thread_context_json: '[]',
    referenced_events_json: '[]',
    summary: `${event.content} summary`,
    model: 'test',
    classified_at: event.created_at * 1000,
    classification_json: '{}',
    topics: ['test'],
    moods: ['neutral'],
    language: 'en',
  };
}

function markReadActions(
  value: unknown,
  actions: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') {
    return actions;
  }

  const record = value as Record<string, unknown>;

  if (
    record.subcommand === 'mark' &&
    record.options &&
    typeof record.options === 'object' &&
    (record.options as Record<string, unknown>).read === true
  ) {
    actions.push(record);
  }

  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        markReadActions(item, actions);
      }
    } else {
      markReadActions(nested, actions);
    }
  }

  return actions;
}

function conversationProps(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (Array.isArray(record.nostrConversationReplies)) {
    return record;
  }

  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = conversationProps(item);

        if (found) {
          return found;
        }
      }
    } else {
      const found = conversationProps(nested);

      if (found) {
        return found;
      }
    }
  }

  return null;
}

function nostrPostProps(
  value: unknown,
  eventId: string,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (record.nostrEventId === eventId) {
    return record;
  }

  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = nostrPostProps(item, eventId);

        if (found) {
          return found;
        }
      }
    } else {
      const found = nostrPostProps(nested, eventId);

      if (found) {
        return found;
      }
    }
  }

  return null;
}

function renderEvents({
  events,
  followedPubkeys,
  conversationEvents,
  mode = 'timeline',
}: {
  events: NrEvent[];
  followedPubkeys: Set<string>;
  conversationEvents: Map<string, NrEvent>;
  mode?: 'timeline' | 'for-you';
}) {
  return groupEventNodes({
    alias: 'nr',
    events,
    profiles: new Map(),
    interactions: [],
    localPreferences: new Map(),
    authorPreferences: new Map(),
    sharePrefixes: { nevent: 'nostr://', nprofile: 'nostr://' },
    translationTargetLanguage: 'en',
    rankingScores: {},
    archiveSignalReviewMode: 'ask',
    likeSignalReviewMode: 'ask',
    replySignalReviewMode: 'ask',
    repostQuoteSignalReviewMode: 'ask',
    resolveReferencesAutomatically: false,
    mode,
    renderScope: 'test',
    archivedIds: new Set(),
    evaluatedImageCounts: {},
    followedPubkeys,
    conversationContextEvents: conversationEvents,
  });
}

test('groups same-slot NIP-10 replies and reads visible members together', () => {
  const parent = finalizeEvent(
    { kind: 1, created_at: 100, content: 'parent', tags: [] },
    generateSecretKey(),
  );

  const reply = finalizeEvent(
    {
      kind: 1,
      created_at: 200,
      content: 'reply',
      tags: [
        ['e', parent.id, '', 'root', parent.pubkey],
        ['e', parent.id, '', 'reply', parent.pubkey],
      ],
    },
    generateSecretKey(),
  );

  const reaction = finalizeEvent(
    {
      kind: 7,
      created_at: 250,
      content: '+',
      tags: [
        ['e', parent.id],
        ['p', parent.pubkey],
      ],
    },
    generateSecretKey(),
  );

  const storedParent = storedEvent(parent);

  const storedReply = {
    ...storedEvent(reply),
    thread_context_json: JSON.stringify([parent]),
  };

  const storedReaction = {
    ...storedEvent(reaction),
    referenced_events_json: JSON.stringify([parent]),
  };

  const nodes = renderEvents({
    events: [storedReply, storedReaction, storedParent],
    followedPubkeys: new Set([parent.pubkey, reply.pubkey, reaction.pubkey]),
    conversationEvents: new Map([
      [parent.id, storedParent],
      [reply.id, storedReply],
      [reaction.id, storedReaction],
    ]),
  });

  expect(nodes).toHaveLength(1);

  expect(nodes[0]).toMatchObject({
    props: { entityKey: `nostr-event:${parent.id}` },
    children: [],
  });

  expect(JSON.stringify(nodes[0])).toContain(`:event:${parent.id}:menu`);

  const post = conversationProps(nodes[0]);

  expect(post?.nostrConversationReplies).toMatchObject([
    { id: reply.id, readAction: null },
  ]);

  expect(WebNostrPostElementPropsSchema.safeParse(post).success).toBe(true);

  const action = markReadActions(nodes[0]).find(
    (candidate) =>
      (candidate.arguments as Record<string, unknown>)?.event_id ===
        parent.id &&
      (candidate.options as Record<string, unknown>)?.event_ids !== undefined,
  );

  expect(action?.arguments).toEqual({ event_id: parent.id });

  expect(action?.options).toMatchObject({
    read: true,
    event_ids: `${parent.id},${reply.id},${reaction.id}`,
  });

  expect(JSON.stringify(nodes[0])).toContain('Reacted +');
});

test('uses a read out-of-slot NIP-22 root as context without re-reading it', () => {
  const parent = finalizeEvent(
    { kind: 1, created_at: 100, content: 'parent', tags: [] },
    generateSecretKey(),
  );

  const comment = finalizeEvent(
    {
      kind: 1111,
      created_at: 3_700,
      content: 'comment',
      tags: [
        ['E', parent.id, '', parent.pubkey],
        ['K', '1'],
        ['P', parent.pubkey],
        ['e', parent.id, '', parent.pubkey],
        ['k', '1'],
        ['p', parent.pubkey],
      ],
    },
    generateSecretKey(),
  );

  const storedParent = storedEvent(parent, 1_000);

  const storedComment = {
    ...storedEvent(comment),
    thread_context_json: JSON.stringify([parent]),
  };

  const nodes = renderEvents({
    events: [storedComment],
    followedPubkeys: new Set([parent.pubkey, comment.pubkey]),
    conversationEvents: new Map([[parent.id, storedParent]]),
  });

  expect(nodes).toHaveLength(1);

  expect(nodes[0]).toMatchObject({
    props: { entityKey: `nostr-event:${parent.id}` },
    children: [],
  });

  const post = conversationProps(nodes[0]);

  expect(post?.nostrConversationReplies).toMatchObject([
    { id: comment.id, readAction: null },
  ]);

  const action = markReadActions(nodes[0]).find(
    (candidate) =>
      (candidate.arguments as Record<string, unknown>)?.event_id === comment.id,
  );

  expect(action?.arguments).toEqual({ event_id: comment.id });
  expect(action?.options).toEqual({ read: true });

  const contextOnlyNodes = renderEvents({
    events: [storedComment],
    followedPubkeys: new Set([parent.pubkey, comment.pubkey]),
    conversationEvents: new Map(),
    mode: 'for-you',
  });

  expect(contextOnlyNodes[0]).toMatchObject({
    props: {
      className: 'nr-list-event nr-conversation nr-for-you-event',
    },
  });

  expect(JSON.stringify(contextOnlyNodes[0])).toContain(
    `:main:${parent.id}:menu`,
  );
});

test('renders a content nevent backed by an e mention tag', () => {
  const target = finalizeEvent(
    { kind: 1, created_at: 100, content: 'mentioned post', tags: [] },
    generateSecretKey(),
  );

  const token = `nostr:${nip19.neventEncode({
    id: target.id,
    author: target.pubkey,
    kind: target.kind,
  })}`;

  const source = finalizeEvent(
    {
      kind: 1,
      created_at: 200,
      content: `A citation: ${token}`,
      tags: [['e', target.id, '', 'mention', target.pubkey]],
    },
    generateSecretKey(),
  );

  const storedSource = {
    ...storedEvent(source),
    referenced_events_json: JSON.stringify([target]),
  };

  const nodes = renderEvents({
    events: [storedSource],
    followedPubkeys: new Set([source.pubkey, target.pubkey]),
    conversationEvents: new Map(),
    mode: 'for-you',
  });

  const post = nostrPostProps(nodes[0], source.id);

  const embeds = post?.nostrEmbeds as
    Record<string, Record<string, unknown>> | undefined;

  expect(embeds?.[token]).toMatchObject({
    id: target.id,
    content: target.content,
  });
});

test('preserves an unfollowed intermediate reply as an on-demand placeholder', () => {
  const root = finalizeEvent(
    { kind: 1, created_at: 100, content: 'root', tags: [] },
    generateSecretKey(),
  );

  const intermediate = finalizeEvent(
    {
      kind: 1,
      created_at: 150,
      content: 'intermediate',
      tags: [
        ['e', root.id, '', 'root', root.pubkey],
        ['e', root.id, '', 'reply', root.pubkey],
      ],
    },
    generateSecretKey(),
  );

  const reply = finalizeEvent(
    {
      kind: 1,
      created_at: 200,
      content: 'followed reply',
      tags: [
        ['e', root.id, '', 'root', root.pubkey],
        ['e', intermediate.id, '', 'reply', intermediate.pubkey],
      ],
    },
    generateSecretKey(),
  );

  const storedRoot = storedEvent(root);

  const storedReply = {
    ...storedEvent(reply),
    thread_context_json: JSON.stringify([root, intermediate]),
  };

  const nodes = renderEvents({
    events: [storedReply],
    followedPubkeys: new Set([root.pubkey, reply.pubkey]),
    conversationEvents: new Map([[root.id, storedRoot]]),
    mode: 'for-you',
  });

  const post = conversationProps(nodes[0]);

  expect(post?.nostrConversationReplies).toMatchObject([
    {
      id: intermediate.id,
      pubkey: intermediate.pubkey,
      resolutionStatus: 'unresolved',
      resolveOnLoad: false,
      showActions: false,
    },
    { id: reply.id, readAction: null },
  ]);
});
