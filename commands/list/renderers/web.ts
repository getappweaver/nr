import { nip19 } from 'nostr-tools';

import { TranslationV1 } from '@src/capabilities/translation.v1';
import type { CapabilityResourceRef } from '@src/capabilities/types';
import type { CachedProfile } from '@src/db';
import { parseEventReferences } from '@src/nostr/event-references';
import { nostrShareUrl, type NostrSharePrefixes } from '@src/web/nostr-share';
import type {
  WebNode,
  WebNodeRoot,
  WebNostrPostReference,
  WebTreeTimeRange,
} from '@src/web/ui-schema';

import { parseNostrEventArray } from '../../../nostr-resolution';
import {
  extractAddressReferences,
  extractEventReferences,
  extractProfileReferences,
} from '../../../references';
import { nrSharePrefixes, type NrSignalReviewMode } from '../../../settings';
import { extractNip10References } from '../../../thread-context';

import { NR_FETCH_STATUS_TARGET_ID } from '../../fetch-status';
import {
  NostrEventSchema,
  type NrAuthorPreferenceValue,
  type NrInteraction,
  type NostrEvent,
  type NrEvent,
  type NrListData,
  type NrListMode,
  type NrListTimeRange,
  type NrProfileEvent,
  type NrTagGroup,
} from '../../shared/types';

import {
  NR_FEED_CATEGORIES,
  NR_FEED_CATEGORY_LABELS,
  categoryForNrEvent,
  type NrFeedCategory,
} from '../categories';
import {
  nrListCommandAction,
  nrListCommandOptions,
  nrListTimeRangeKey,
} from '../list-options';

import {
  fetchCoverageBar,
  fetchCoverageStylesheet,
  NR_TIMELINE_TIME_FILTER_GROUP,
} from './fetch-coverage';
import {
  authorPreferenceActions,
  authorPreferenceActionsReadAction,
} from './profile';

const NR_LIST_FILTER_REVEAL_ID = 'nr-list-filter';

const nrListStylesheet = {
  id: 'nr-list-widget',
  cssText: `
.nr-list-tree .web-tree-item-summary {
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.18rem;
}

.nr-list-tree .web-tree-item-summary > .web-node {
  width: 100%;
}

.nr-list-event > .web-tree-item-summary > .web-tree-toggle-spacer {
  display: none;
}

.nr-for-you-event > .web-tree-item-summary > .web-node {
  box-sizing: border-box;
  padding-left: 1.25rem;
}

.nr-list-event > .web-tree-item-summary > .web-node > .web-row {
  position: relative;
}

.nr-list-event .web-overflow-menu:has(.nr-list-event-menu) {
  width: 0;
  overflow: visible;
}

.nr-list-event-menu.web-overflow-trigger {
  position: absolute;
  right: 0;
  margin-right: 0;
}

.nr-list-filter-panel {
  padding: 0.65rem;
  border: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
  background: color-mix(in srgb, var(--color-surface-alt) 94%, var(--color-warning) 6%);
}

.nr-list-filter-options {
  display: grid;
  gap: 0.3rem;
}

.nr-list-filter-panel .web-form__actions .web-button {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-accent);
  box-shadow: none;
  text-decoration: underline;
  transform: none;
}

.nr-tag-read-shortcut.web-button {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  box-shadow: none;
  font-size: 0.72rem;
  line-height: 1;
  opacity: 0.65;
}

.nr-tag-read-shortcut.web-button:hover,
.nr-tag-read-shortcut.web-button:focus-visible {
  color: var(--color-success);
  opacity: 1;
}

.nr-tag-read-shortcut.web-button:active {
  transform: translate(4px, 4px);
}
`,
};

type RenderNrListWebProps = {
  alias: string;
  listData: NrListData;
  schedulerResource: CapabilityResourceRef | null;
  profiles: Map<string, CachedProfile>;
};

type InteractionFlags = {
  liked: boolean;
  replied: boolean;
  reposted: boolean;
  quoted: boolean;
};

export function text(value: string): WebNode {
  return { type: 'text', value };
}

type WebElementTag = Extract<WebNode, { type: 'element' }>['tag'];

export function el(
  tag: WebElementTag,
  props: Record<string, unknown>,
  children: WebNode[],
): WebNode {
  return { type: 'element', tag, props, children } as WebNode;
}

function keyed(renderKey: string, node: WebNode): WebNode {
  return node.type === 'element' ? { ...node, renderKey } : node;
}

function entityKey(eventId: string): string {
  return `nostr-event:${eventId}`;
}

function tagGroupEntityKey(
  type: 'topic' | 'mood' | 'language',
  tag: string,
): string {
  return `nr-${type}:${tag}`;
}

function npubForPubkey(pubkey: string): string | undefined {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return undefined;
  }
}

function neventForEvent(event: NrEvent | NostrEvent): string | undefined {
  try {
    return nip19.neventEncode({
      id: event.id,
      author: event.pubkey,
      kind: event.kind,
      relays: 'relay_hints' in event ? event.relay_hints.slice(0, 1) : [],
    });
  } catch {
    return undefined;
  }
}

function openInNostrUrl(
  event: NrEvent | NostrEvent,
  sharePrefixes: NostrSharePrefixes,
) {
  const nevent = neventForEvent(event);

  if (!nevent) {
    return undefined;
  }

  return nostrShareUrl({
    type: 'nevent',
    identifier: nevent,
    prefixes: sharePrefixes,
  });
}

function copyNeventAction(event: NrEvent | NostrEvent) {
  const nevent = neventForEvent(event);

  if (!nevent) {
    return undefined;
  }

  return {
    type: 'clientAction' as const,
    action: 'web.copyText',
    payload: { text: nevent },
  };
}

function likeEventAction({
  alias,
  event,
  post,
  signalReviewMode,
}: {
  alias: string;
  event: NrEvent;
  post: NostrPostView;
  signalReviewMode: NrSignalReviewMode;
}) {
  if (signalReviewMode === 'ask') {
    return {
      type: 'command' as const,
      command: alias,
      subcommand: 'signal-review',
      arguments: {},
      options: {
        target_event_id: event.id,
        action_category: 'like',
        target_author_label: post.authorName ?? post.authorUsername ?? '',
      },
      surface: 'modal' as const,
      modalTitle: 'Nostr Radar signal review',
      recordInTimeline: false,
    };
  }

  return {
    type: 'clientAction' as const,
    action: 'nostr.likeEvent',
    payload: {
      eventId: event.id,
      eventPubkey: event.pubkey,
      eventKind: event.kind,
      nrAlias: alias,
      relayHints: event.relay_hints,
      signalReview: signalReviewPayload({
        event,
        authorLabel: post.authorName ?? post.authorUsername ?? '',
        actionCategory: 'like',
        mode: signalReviewMode,
      }),
    },
  };
}

function signalReviewTopics(event: NrEvent): string[] {
  return [
    ...new Set(
      event.topics
        .map((topic) => topic.trim().toLowerCase())
        .filter((topic) => topic.length > 0 && topic !== 'general'),
    ),
  ];
}

function signalReviewPayload({
  event,
  authorLabel,
  actionCategory,
  mode,
}: {
  event: NrEvent;
  authorLabel: string;
  actionCategory: 'like' | 'reply' | 'repost_quote';
  mode: NrSignalReviewMode;
}) {
  return {
    actionCategory,
    targetAuthorPubkey: event.pubkey,
    targetAuthorLabel: authorLabel || event.pubkey.slice(0, 12),
    candidateTopics: signalReviewTopics(event),
    allowRemember: true,
    mode,
    targetEventJson: event.raw_json,
  };
}

type RawSignalReviewPayloadProps = {
  event: NostrEvent;
  profile: CachedProfile | undefined;
  actionCategory: 'reply' | 'repost_quote';
  candidateTopics: string[];
  mode: NrSignalReviewMode;
};

function rawSignalReviewPayload({
  event,
  profile,
  actionCategory,
  candidateTopics,
  mode,
}: RawSignalReviewPayloadProps) {
  return {
    actionCategory,
    targetAuthorPubkey: event.pubkey,
    targetAuthorLabel: signalReviewAuthorLabel(profile, event.pubkey),
    candidateTopics,
    allowRemember: true,
    mode,
    targetEventJson: JSON.stringify(event),
  };
}

type LikeNostrEventActionProps = {
  alias: string;
  event: NostrEvent;
  signalReviewMode: NrSignalReviewMode;
  candidateTopics: string[];
  authorLabel: string;
};

function likeNostrEventAction({
  alias,
  event,
  signalReviewMode,
  candidateTopics,
  authorLabel,
}: LikeNostrEventActionProps) {
  const targetEventJson = JSON.stringify(event);

  if (signalReviewMode === 'ask') {
    return {
      type: 'command' as const,
      command: alias,
      subcommand: 'signal-review',
      arguments: {},
      options: {
        target_event_id: event.id,
        action_category: 'like',
        target_author_pubkey: event.pubkey,
        target_author_label: authorLabel,
        target_event_json: targetEventJson,
        candidate_topics: candidateTopics,
      },
      surface: 'modal' as const,
      modalTitle: 'Nostr Radar signal review',
      recordInTimeline: false,
    };
  }

  return {
    type: 'clientAction' as const,
    action: 'nostr.likeEvent',
    payload: {
      eventId: event.id,
      eventPubkey: event.pubkey,
      eventKind: event.kind,
      nrAlias: alias,
      relayHints: [],
      signalReview: {
        actionCategory: 'like',
        targetAuthorPubkey: event.pubkey,
        candidateTopics,
        mode: signalReviewMode,
        targetEventJson,
      },
    },
  };
}

function repostEventAction({
  alias,
  event,
  post,
  signalReviewMode,
}: {
  alias: string;
  event: NrEvent;
  post: NostrPostView;
  signalReviewMode: NrSignalReviewMode;
}) {
  return {
    type: 'clientAction' as const,
    action: 'nostr.openRepostPanel',
    payload: {
      eventId: post.id,
      eventPubkey: post.pubkey,
      eventKind: post.kind,
      nrAlias: alias,
      eventCreatedAt: post.createdAt,
      eventContent: post.content,
      eventAuthorName: post.authorName,
      eventAuthorUsername: post.authorUsername,
      eventAuthorPicture: post.authorPicture,
      eventRawJson: event.raw_json,
      signalReview: signalReviewPayload({
        event,
        authorLabel: post.authorName ?? post.authorUsername ?? '',
        actionCategory: 'repost_quote',
        mode: signalReviewMode,
      }),
      relayHints: post.relayHints,
    },
  };
}

function repostNostrEventAction({
  alias,
  event,
  profile,
  signalReviewMode,
  candidateTopics,
}: {
  alias: string;
  event: NostrEvent;
  profile: CachedProfile | undefined;
  signalReviewMode: NrSignalReviewMode;
  candidateTopics: string[];
}) {
  return {
    type: 'clientAction' as const,
    action: 'nostr.openRepostPanel',
    payload: {
      eventId: event.id,
      eventPubkey: event.pubkey,
      eventKind: event.kind,
      nrAlias: alias,
      eventCreatedAt: event.created_at,
      eventContent: event.content,
      eventAuthorName: profile?.displayName ?? null,
      eventAuthorUsername: profile?.name ?? null,
      eventAuthorPicture: profile?.picture ?? null,
      eventRawJson: JSON.stringify(event),
      signalReview: rawSignalReviewPayload({
        event,
        profile,
        actionCategory: 'repost_quote',
        candidateTopics,
        mode: signalReviewMode,
      }),
      relayHints: [],
    },
  };
}

type NostrPostView = {
  id: string;
  pubkey: string;
  kind: number;
  createdAt: number;
  content: string;
  relayHints: string[];
  authorName: string | null;
  authorUsername: string | null;
  authorPicture: string | null;
  authorAbout: string | null;
};

function rootReferenceFromNostrEvent(event: NostrEvent): {
  id: string | null;
  pubkey: string | null;
} {
  const rootTag = event.tags.find(
    (tag) => tag[0] === 'e' && tag[3] === 'root' && tag[1],
  );

  if (!rootTag) {
    return { id: null, pubkey: null };
  }

  const rootId = rootTag[1] ?? null;

  const rootPubkey =
    typeof rootTag[4] === 'string' && rootTag[4].trim()
      ? rootTag[4].trim()
      : null;

  return { id: rootId, pubkey: rootPubkey };
}

function rootReference(event: NrEvent): {
  id: string | null;
  pubkey: string | null;
} {
  try {
    return rootReferenceFromNostrEvent(
      JSON.parse(event.raw_json) as NostrEvent,
    );
  } catch {
    return { id: null, pubkey: null };
  }
}

function replyEventAction({
  alias,
  event,
  post,
  signalReviewMode,
}: {
  alias: string;
  event: NrEvent;
  post: NostrPostView;
  signalReviewMode: NrSignalReviewMode;
}) {
  const root = rootReference(event);

  return {
    type: 'clientAction' as const,
    action: 'nostr.openReplyPanel',
    payload: {
      eventId: post.id,
      eventPubkey: post.pubkey,
      eventKind: post.kind,
      nrAlias: alias,
      eventCreatedAt: post.createdAt,
      eventContent: post.content,
      eventAuthorName: post.authorName,
      eventAuthorUsername: post.authorUsername,
      eventAuthorPicture: post.authorPicture,
      eventRawJson: event.raw_json,
      signalReview: signalReviewPayload({
        event,
        authorLabel: post.authorName ?? post.authorUsername ?? '',
        actionCategory: 'reply',
        mode: signalReviewMode,
      }),
      rootEventId: root.id,
      rootPubkey: root.pubkey,
      relayHints: post.relayHints,
    },
  };
}

function replyNostrEventAction({
  alias,
  event,
  profile,
  signalReviewMode,
  candidateTopics,
}: {
  alias: string;
  event: NostrEvent;
  profile: CachedProfile | undefined;
  signalReviewMode: NrSignalReviewMode;
  candidateTopics: string[];
}) {
  const root = rootReferenceFromNostrEvent(event);

  return {
    type: 'clientAction' as const,
    action: 'nostr.openReplyPanel',
    payload: {
      eventId: event.id,
      eventPubkey: event.pubkey,
      eventKind: event.kind,
      nrAlias: alias,
      eventCreatedAt: event.created_at,
      eventContent: event.content,
      eventAuthorName: profile?.displayName ?? null,
      eventAuthorUsername: profile?.name ?? null,
      eventAuthorPicture: profile?.picture ?? null,
      eventRawJson: JSON.stringify(event),
      signalReview: rawSignalReviewPayload({
        event,
        profile,
        actionCategory: 'reply',
        candidateTopics,
        mode: signalReviewMode,
      }),
      rootEventId: root.id,
      rootPubkey: root.pubkey,
      relayHints: [],
    },
  };
}

function eventSignalMetadata(event: NrEvent, score: number | null): WebNode {
  const topics = event.topics.length > 0 ? event.topics.join(', ') : '(none)';
  const moods = event.moods.length > 0 ? event.moods.join(', ') : '(none)';
  const scoreText = score === null ? '' : ` . Score: ${score.toFixed(2)}`;

  return el(
    'text',
    { className: 'nr-for-you-metadata', size: 'sm', tone: 'muted' },
    [text(`Topics: ${topics} . Moods: ${moods}${scoreText}`)],
  );
}

function summaryNodes(summary: string): WebNode[] {
  const value = summary.trim();

  return value
    ? [
        el('text', { className: 'nr-event-summary', size: 'sm' }, [
          text(`Summary: ${value}`),
        ]),
      ]
    : [];
}

function optimisticCommandAction({
  mutations,
  command,
}: {
  mutations: Array<Record<string, unknown>>;
  command: Record<string, unknown>;
}) {
  return {
    type: 'clientAction' as const,
    action: 'web.optimisticCommand',
    payload: {
      mutations,
      command,
      onError: 'log',
    },
  };
}

function interactionFlags(
  interactions: NrInteraction[],
  eventId: string | undefined,
): InteractionFlags {
  const flags = {
    liked: false,
    replied: false,
    reposted: false,
    quoted: false,
  };

  if (!eventId) {
    return flags;
  }

  for (const interaction of interactions) {
    if (interaction.targetEventId !== eventId) {
      continue;
    }

    flags[interaction.type] = true;
  }

  return flags;
}

type MarkActionProps = {
  alias: string;
  eventId: string;
  state: 'read' | 'unread' | 'archived' | 'unarchived';
  mode: NrListMode | null;
};

function markAction({ alias, eventId, state, mode }: MarkActionProps) {
  return optimisticCommandAction({
    mutations:
      state === 'archived'
        ? []
        : [
            {
              type: 'removeEntity',
              entityKey: entityKey(eventId),
              pruneEmptyParents: true,
            },
          ],
    command: {
      command: alias,
      subcommand: 'mark',
      arguments: { event_id: eventId },
      options: { [state]: true },
      ...(state === 'read'
        ? {
            monitoring: {
              name: 'nr.read',
              attributes: { eventId, mode: mode ?? 'unknown' },
            },
          }
        : {}),
    },
  });
}

type ReadActionProps = {
  alias: string;
  eventId: string;
  mode: NrListMode | null;
};

function readAction({ alias, eventId, mode }: ReadActionProps) {
  return markAction({ alias, eventId, state: 'read', mode });
}

function localPreferenceAction({
  alias,
  eventId,
  preference,
  mode,
  targetAuthorPubkey,
  targetAuthorLabel,
  candidateTopics,
}: {
  alias: string;
  eventId: string;
  preference: 'like' | 'dislike' | 'none';
  mode: NrListMode;
  targetAuthorPubkey: string | null;
  targetAuthorLabel: string;
  candidateTopics: string[];
}) {
  if (preference !== 'none') {
    return {
      type: 'command' as const,
      command: alias,
      subcommand: 'signal-review',
      arguments: {},
      options: {
        target_event_id: eventId,
        action_category: preference === 'like' ? 'local_like' : 'local_dislike',
        list_mode: mode,
        target_author_pubkey: targetAuthorPubkey,
        target_author_label: targetAuthorLabel,
        candidate_topics: candidateTopics,
      },
      surface: 'modal' as const,
      modalTitle: 'Nostr Radar signal review',
      recordInTimeline: false,
    };
  }

  return optimisticCommandAction({
    mutations: [
      {
        type: 'patchEntityActions',
        entityKey: entityKey(eventId),
        actions: [
          {
            key: 'nr.localPreference.like',
            label: '👍',
            active: false,
            ariaLabel: 'Show more posts like this locally',
          },
          {
            key: 'nr.localPreference.dislike',
            label: '👎',
            active: false,
            ariaLabel: 'Show fewer posts like this locally',
          },
        ],
      },
    ],
    command: {
      command: alias,
      subcommand: 'interest-record',
      arguments: {},
      options: { target_event_id: eventId, preference },
    },
  });
}

function localPreferenceActions({
  alias,
  eventId,
  mode,
  preference,
  targetAuthorPubkey,
  targetAuthorLabel,
  candidateTopics,
}: {
  alias: string;
  eventId: string;
  mode: NrListMode;
  preference: 'like' | 'dislike' | null;
  targetAuthorPubkey: string | null;
  targetAuthorLabel: string;
  candidateTopics: string[];
}) {
  return [
    {
      optimisticKey: 'nr.localPreference.like',
      label: preference === 'like' ? '(👍)' : '👍',
      ariaLabel:
        preference === 'like'
          ? 'Remove local positive preference'
          : 'Show more posts like this locally',
      action: localPreferenceAction({
        alias,
        eventId,
        preference: preference === 'like' ? 'none' : 'like',
        mode,
        targetAuthorPubkey,
        targetAuthorLabel,
        candidateTopics,
      }),
      disabled: false,
      active: preference === 'like',
    },
    {
      optimisticKey: 'nr.localPreference.dislike',
      label: preference === 'dislike' ? '(👎)' : '👎',
      ariaLabel:
        preference === 'dislike'
          ? 'Remove local negative preference'
          : 'Show fewer posts like this locally',
      action: localPreferenceAction({
        alias,
        eventId,
        preference: preference === 'dislike' ? 'none' : 'dislike',
        mode,
        targetAuthorPubkey,
        targetAuthorLabel,
        candidateTopics,
      }),
      disabled: false,
      active: preference === 'dislike',
    },
  ];
}

function signalRecordCommand({
  alias,
  eventId,
  actionCategory,
  signalType,
  outcome,
  topics,
  authorPubkey,
}: {
  alias: string;
  eventId: string;
  actionCategory: 'archive' | 'like' | 'reply' | 'repost_quote';
  signalType: 'archive' | 'like' | 'reply' | 'repost' | 'quote';
  outcome: 'create' | 'without_signal';
  topics: string[];
  authorPubkey: string | null;
}) {
  return {
    command: alias,
    subcommand: 'signal-record',
    arguments: {},
    options: {
      target_event_id: eventId,
      action_category: actionCategory,
      signal_type: signalType,
      signal_outcome: outcome,
      signal_topics: topics,
      signal_author_pubkey: authorPubkey,
      signal_remember: false,
    },
  };
}

function commandSequenceAction({
  commands,
}: {
  commands: Array<Record<string, unknown>>;
}) {
  return {
    type: 'clientAction' as const,
    action: 'web.commandSequence',
    payload: { commands, mergeFormOptionsIntoCommand: null },
  };
}

function archiveAction({
  alias,
  event,
  mode,
  signalReviewMode,
}: {
  alias: string;
  event: NrEvent;
  mode: NrListMode;
  signalReviewMode: NrSignalReviewMode;
}) {
  const state = event.archived_at ? 'unarchived' : 'archived';

  if (state !== 'archived') {
    return markAction({ alias, eventId: event.id, state, mode });
  }

  if (signalReviewMode === 'ask') {
    return {
      type: 'command' as const,
      command: alias,
      subcommand: 'signal-review',
      arguments: {},
      options: {
        target_event_id: event.id,
        action_category: 'archive',
        list_mode: mode,
      },
      surface: 'modal' as const,
      modalTitle: 'Nostr Radar signal review',
      recordInTimeline: false,
    };
  }

  const markCommand = {
    command: alias,
    subcommand: 'mark',
    arguments: { event_id: event.id },
    options: { archived: true },
  };

  if (signalReviewMode === 'never') {
    return commandSequenceAction({ commands: [markCommand] });
  }

  return commandSequenceAction({
    commands: [
      markCommand,
      signalRecordCommand({
        alias,
        eventId: event.id,
        actionCategory: 'archive',
        signalType: 'archive',
        outcome: 'create',
        topics: signalReviewTopics(event),
        authorPubkey: event.pubkey,
      }),
    ],
  });
}

type MarkRawEventActionProps = {
  alias: string;
  event: NostrEvent;
  state: 'read' | 'archived' | 'unarchived';
  mode: NrListMode;
};

function markRawEventAction({
  alias,
  event,
  state,
  mode,
}: MarkRawEventActionProps) {
  return optimisticCommandAction({
    mutations:
      state === 'archived'
        ? []
        : [
            {
              type: 'removeEntity',
              entityKey: entityKey(event.id),
              pruneEmptyParents: true,
            },
          ],
    command: {
      command: alias,
      subcommand: 'mark',
      arguments: { event_id: event.id },
      options: { [state]: true, event_json: JSON.stringify(event) },
      ...(state === 'read'
        ? {
            monitoring: {
              name: 'nr.read',
              attributes: { eventId: event.id, mode },
            },
          }
        : {}),
    },
  });
}

type ReadTagActionProps = {
  alias: string;
  type: 'topic' | 'mood';
  tag: string;
  mode: NrListMode;
  selectedTimeRanges: NrListTimeRange[];
};

function readTagAction({
  alias,
  type,
  tag,
  mode,
  selectedTimeRanges,
}: ReadTagActionProps) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'mark',
    arguments: {},
    options: { type, tag, read: true },
    recordInTimeline: false,
    pendingUi: { presentation: 'entity' as const, label: 'Marking read...' },
    refresh: {
      command: alias,
      subcommand: 'list',
      arguments: {},
      options: {
        ...nrListCommandOptions({ mode, selectedTimeRanges }),
        local_mutation: true,
      },
      recordInTimeline: false,
    },
  };
}

type AddTaxonomyTagActionProps = {
  alias: string;
  type: 'topic' | 'mood';
  tag: string;
  preference: 'interested' | 'uninterested';
};

function addTaxonomyTagAction({
  alias,
  type,
  tag,
  preference,
}: AddTaxonomyTagActionProps) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'taxonomy',
    arguments: {},
    options: { type, mode: 'add', new_tag: tag, preference },
    recordInTimeline: false,
    pendingUi: { presentation: 'none' as const },
    clientStatus: { background: true },
  };
}

type ReevaluateActionProps = {
  alias: string;
  eventId: string;
  eventJson: string | null;
  mode: NrListMode;
};

function reevaluateAction({
  alias,
  eventId,
  eventJson,
  mode,
}: ReevaluateActionProps) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'reevaluate',
    arguments: { event_id: eventId },
    options: eventJson ? { event_json: eventJson } : {},
    recordInTimeline: true,
    pendingUi: { presentation: 'entity' as const, label: 'Updating...' },
    refresh: {
      command: alias,
      subcommand: 'list',
      arguments: {},
      options: { mode },
      recordInTimeline: false,
    },
  };
}

function eventActionsMenu(
  alias: string,
  event: NrEvent,
  mode: NrListMode,
  sharePrefixes: NostrSharePrefixes,
  archiveSignalReviewMode: NrSignalReviewMode,
): WebNode {
  const openUrl = openInNostrUrl(event, sharePrefixes);
  const copyAction = copyNeventAction(event);

  return {
    type: 'element',
    tag: 'overflowMenu',
    props: {
      label: '⋮',
      buttonVariant: 'icon',
      className: 'nr-list-event-menu',
      stopPropagation: true,
    },
    children: [
      ...(openUrl
        ? [
            {
              type: 'element' as const,
              tag: 'menuItem' as const,
              props: {
                label: 'Open event',
                href: openUrl,
                external: true,
              },
            },
          ]
        : []),
      ...(copyAction
        ? [
            {
              type: 'element' as const,
              tag: 'menuItem' as const,
              props: {
                label: 'Copy nevent',
                action: copyAction,
              },
            },
          ]
        : []),
      {
        type: 'element',
        tag: 'menuItem',
        props: {
          label: 'Read',
          action: readAction({
            alias,
            eventId: event.id,
            mode,
          }),
        },
      },
      {
        type: 'element',
        tag: 'menuItem',
        props: {
          label: event.archived_at ? 'Unarchive' : 'Archive',
          action: archiveAction({
            alias,
            event,
            mode,
            signalReviewMode: archiveSignalReviewMode,
          }),
        },
      },
      {
        type: 'element',
        tag: 'menuItem',
        props: {
          label: 'Reevaluate',
          action: reevaluateAction({
            alias,
            eventId: event.id,
            eventJson: null,
            mode,
          }),
        },
      },
    ],
  };
}

function referencedEventActionsMenu({
  alias,
  event,
  archived,
  mode,
  sharePrefixes,
}: {
  alias: string;
  event: NostrEvent;
  archived: boolean;
  mode: NrListMode;
  sharePrefixes: NostrSharePrefixes;
}): WebNode {
  const openUrl = openInNostrUrl(event, sharePrefixes);
  const copyAction = copyNeventAction(event);
  const eventJson = JSON.stringify(event);

  return {
    type: 'element',
    tag: 'overflowMenu',
    props: {
      label: '⋮',
      buttonVariant: 'icon',
      className: 'nr-list-event-menu',
      stopPropagation: true,
    },
    children: [
      ...(openUrl
        ? [
            {
              type: 'element' as const,
              tag: 'menuItem' as const,
              props: {
                label: 'Open event',
                href: openUrl,
                external: true,
              },
            },
          ]
        : []),
      ...(copyAction
        ? [
            {
              type: 'element' as const,
              tag: 'menuItem' as const,
              props: { label: 'Copy nevent', action: copyAction },
            },
          ]
        : []),
      {
        type: 'element',
        tag: 'menuItem',
        props: {
          label: 'Read',
          action: markRawEventAction({ alias, event, state: 'read', mode }),
        },
      },
      {
        type: 'element',
        tag: 'menuItem',
        props: {
          label: archived ? 'Unarchive' : 'Archive',
          action: markRawEventAction({
            alias,
            event,
            state: archived ? 'unarchived' : 'archived',
            mode,
          }),
        },
      },
      {
        type: 'element',
        tag: 'menuItem',
        props: {
          label: 'Reevaluate',
          action: reevaluateAction({
            alias,
            eventId: event.id,
            eventJson,
            mode,
          }),
        },
      },
    ],
  };
}

function referencedEvents(event: NrEvent): NostrEvent[] {
  return parseNostrEventArray(event.referenced_events_json);
}

function threadContextEvents(event: NrEvent): NostrEvent[] {
  try {
    const parsed = parseNostrEventArray(event.thread_context_json);
    const rawEvent = NostrEventSchema.parse(JSON.parse(event.raw_json));

    const threadIds = new Set(
      extractNip10References(rawEvent).map((reference) => reference.id),
    );

    return parsed.filter((context) => threadIds.has(context.id));
  } catch {
    return [];
  }
}

type ProfileSearchTextProps = {
  profiles: Map<string, CachedProfile>;
  pubkey: string;
};

function profileSearchText({
  profiles,
  pubkey,
}: ProfileSearchTextProps): string[] {
  const profile = profileForPubkey({ profiles, pubkey });

  return [pubkey, profile?.displayName, profile?.name, profile?.about].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

type InlineProfileSearchTextProps = {
  content: string;
  profiles: Map<string, CachedProfile>;
};

function inlineProfileSearchText({
  content,
  profiles,
}: InlineProfileSearchTextProps): string[] {
  return extractProfileReferences(content).flatMap((reference) =>
    profileSearchText({ profiles, pubkey: reference.pubkey }),
  );
}

type NostrEventSearchTextProps = {
  event: NostrEvent;
  profiles: Map<string, CachedProfile>;
};

function nostrEventSearchText({
  event,
  profiles,
}: NostrEventSearchTextProps): string[] {
  return [
    event.id,
    event.pubkey,
    event.content,
    ...profileSearchText({ profiles, pubkey: event.pubkey }),
    ...inlineProfileSearchText({ content: event.content, profiles }),
  ];
}

type EventFilterTextProps = {
  event: NrEvent;
  profiles: Map<string, CachedProfile>;
};

function eventFilterText({ event, profiles }: EventFilterTextProps): string {
  return [
    event.id,
    event.pubkey,
    event.content,
    event.summary,
    ...event.topics,
    ...event.moods,
    ...profileSearchText({ profiles, pubkey: event.pubkey }),
    ...inlineProfileSearchText({ content: event.content, profiles }),
    ...threadContextEvents(event).flatMap((contextEvent) =>
      nostrEventSearchText({ event: contextEvent, profiles }),
    ),
    ...referencedEvents(event).flatMap((referencedEvent) =>
      nostrEventSearchText({ event: referencedEvent, profiles }),
    ),
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
}

function inlineProfiles({
  alias,
  content,
  profiles,
  sharePrefixes,
  mode,
}: {
  alias: string;
  content: string;
  profiles: Map<string, CachedProfile>;
  sharePrefixes: NostrSharePrefixes;
  mode: NrListMode;
}): NonNullable<WebNostrPostReference['inlineProfiles']> {
  const inline: NonNullable<WebNostrPostReference['inlineProfiles']> = {};

  for (const reference of extractProfileReferences(content)) {
    const profile = profiles.get(reference.pubkey.toLowerCase());

    inline[reference.token] = {
      pubkey: reference.pubkey,
      npub: npubForPubkey(reference.pubkey),
      authorName: profile?.displayName ?? undefined,
      authorUsername: profile?.name ?? undefined,
      authorPicture: profile?.picture ?? undefined,
      authorAbout: profile?.about ?? undefined,
      relayHints: [],
      sharePrefixes,
      profileActions: authorPreferenceActions({
        alias,
        pubkey: reference.pubkey,
        mode,
        preference: null,
      }),
      profileActionsReadAction: authorPreferenceActionsReadAction({
        alias,
        pubkey: reference.pubkey,
        mode,
      }),
    };
  }

  return inline;
}

function addressReferences({
  alias,
  content,
  profiles,
  sharePrefixes,
  mode,
}: {
  alias: string;
  content: string;
  profiles: Map<string, CachedProfile>;
  sharePrefixes: NostrSharePrefixes;
  mode: NrListMode;
}) {
  return extractAddressReferences(content).map((reference) => {
    const profile = profiles.get(reference.pubkey.toLowerCase());

    return {
      token: reference.token,
      type: 'address' as const,
      id: `${reference.kind}:${reference.pubkey}:${reference.identifier}`,
      pubkey: reference.pubkey,
      kind: reference.kind,
      npub: npubForPubkey(reference.pubkey),
      relayHints: reference.relays,
      sharePrefixes,
      authorName: profile?.displayName ?? undefined,
      authorUsername: profile?.name ?? undefined,
      authorPicture: profile?.picture ?? undefined,
      authorAbout: profile?.about ?? undefined,
      href: `https://jumble.social/notes/${reference.naddr}`,
      label:
        reference.kind === 30023
          ? 'Read long-form post on Jumble'
          : 'Open addressable event on Jumble',
      showActions: false,
      profileActions: authorPreferenceActions({
        alias,
        pubkey: reference.pubkey,
        mode,
        preference: null,
      }),
      profileActionsReadAction: authorPreferenceActionsReadAction({
        alias,
        pubkey: reference.pubkey,
        mode,
      }),
    };
  });
}

function nostrEmbeds({
  alias,
  event,
  profiles,
  interactions,
  translationTargetLanguage,
  sharePrefixes,
  mode,
}: {
  alias: string;
  event: NrEvent;
  profiles: Map<string, CachedProfile>;
  interactions: NrInteraction[];
  translationTargetLanguage: string;
  sharePrefixes: NostrSharePrefixes;
  mode: NrListMode;
}) {
  const eventsById = new Map(
    referencedEvents(event).map((referencedEvent) => [
      referencedEvent.id,
      referencedEvent,
    ]),
  );

  const embeds: Record<string, unknown> = {};

  for (const reference of extractEventReferences(event.content)) {
    const referencedEvent = eventsById.get(reference.id);

    const profile = referencedEvent
      ? profiles.get(referencedEvent.pubkey.toLowerCase())
      : undefined;

    const flags = interactionFlags(interactions, referencedEvent?.id);

    const embeddedReferences = referencedEvent
      ? [
          ...extractEventReferences(referencedEvent.content).flatMap(
            (nestedReference) => {
              const nestedEvent = eventsById.get(nestedReference.id);

              return nestedEvent
                ? [
                    {
                      ...profileReference({
                        alias,
                        event: nestedEvent,
                        profiles,
                        translationTargetLanguage,
                        sharePrefixes,
                        mode,
                      }),
                      token: nestedReference.token,
                    },
                  ]
                : [];
            },
          ),
          ...addressReferences({
            alias,
            content: referencedEvent.content,
            profiles,
            sharePrefixes,
            mode,
          }),
        ]
      : [];

    embeds[reference.token] = {
      entityKey: entityKey(referencedEvent?.id ?? reference.id),
      type: 'event',
      id: referencedEvent?.id ?? reference.id,
      pubkey: referencedEvent?.pubkey,
      kind: referencedEvent?.kind,
      npub: referencedEvent ? npubForPubkey(referencedEvent.pubkey) : undefined,
      authorName: profile?.displayName ?? undefined,
      authorUsername: profile?.name ?? undefined,
      authorPicture: profile?.picture ?? undefined,
      authorAbout: profile?.about ?? undefined,
      relayHints: [],
      createdAt: referencedEvent?.created_at,
      content: referencedEvent?.content,
      trailingActions: referencedEvent
        ? [
            translationPostAction({
              alias,
              content: referencedEvent.content,
              targetLanguage: translationTargetLanguage,
            }),
          ]
        : undefined,
      embeddedReferences,
      readAction: referencedEvent
        ? markRawEventAction({
            alias,
            event: referencedEvent,
            state: 'read',
            mode,
          })
        : undefined,
      likeAction: referencedEvent
        ? likeNostrEventAction({
            alias,
            event: referencedEvent,
            signalReviewMode: 'ask',
            candidateTopics: [],
            authorLabel: signalReviewAuthorLabel(
              profile,
              referencedEvent.pubkey,
            ),
          })
        : undefined,
      archiveAction: referencedEvent
        ? markRawEventAction({
            alias,
            event: referencedEvent,
            state: 'archived',
            mode,
          })
        : undefined,
      archived: false,
      replyAction: referencedEvent
        ? replyNostrEventAction({
            alias,
            event: referencedEvent,
            profile,
            signalReviewMode: 'ask',
            candidateTopics: [],
          })
        : undefined,
      repostAction: referencedEvent
        ? repostNostrEventAction({
            alias,
            event: referencedEvent,
            profile,
            signalReviewMode: 'ask',
            candidateTopics: [],
          })
        : undefined,
      liked: flags.liked,
      replied: flags.replied,
      reposted: flags.reposted,
      quoted: flags.quoted,
      showActions: referencedEvent ? true : false,
      profileActions: referencedEvent
        ? authorPreferenceActions({
            alias,
            pubkey: referencedEvent.pubkey,
            mode,
            preference: null,
          })
        : undefined,
      profileActionsReadAction: referencedEvent
        ? authorPreferenceActionsReadAction({
            alias,
            pubkey: referencedEvent.pubkey,
            mode,
          })
        : undefined,
      sharePrefixes,
      inlineProfiles: referencedEvent
        ? inlineProfiles({
            alias,
            content: referencedEvent.content,
            profiles,
            sharePrefixes,
            mode,
          })
        : undefined,
      label: referencedEvent ? 'Quoted note' : 'Referenced note',
    };
  }

  for (const reference of addressReferences({
    alias,
    content: event.content,
    profiles,
    sharePrefixes,
    mode,
  })) {
    embeds[reference.token] = reference;
  }

  return embeds;
}

type ThreadContextReferencesProps = {
  alias: string;
  event: NrEvent;
  profiles: Map<string, CachedProfile>;
  interactions: NrInteraction[];
  localPreferences: Map<string, 'like' | 'dislike'>;
  translationTargetLanguage: string;
  sharePrefixes: NostrSharePrefixes;
  mode: NrListMode;
};

type UnresolvedReplyReferenceProps = {
  alias: string;
  id: string;
  relay: string | null;
  mode: NrListMode;
};

function unresolvedReplyReference({
  alias,
  id,
  relay,
  mode,
}: UnresolvedReplyReferenceProps): WebNostrPostReference {
  return {
    entityKey: entityKey(id),
    type: 'event',
    id,
    relayHints: relay ? [relay] : [],
    resolutionStatus: 'unresolved',
    readAction: markAction({ alias, eventId: id, state: 'read', mode }),
    archiveAction: markAction({ alias, eventId: id, state: 'archived', mode }),
    showActions: false,
  };
}

function threadEventReferences(event: NostrEvent): Array<{
  id: string;
  relay: string | null;
}> {
  const references = parseEventReferences(event).filter(
    (edge) =>
      (edge.role === 'thread-root' || edge.role === 'thread-parent') &&
      edge.target.type === 'event',
  );

  return [
    ...new Map(
      references.map((edge) => [
        edge.target.type === 'event' ? edge.target.eventId : '',
        edge,
      ]),
    ).values(),
  ]
    .slice(0, 8)
    .map((edge) => ({
      id: edge.target.type === 'event' ? edge.target.eventId : '',
      relay: edge.relayHints[0] ?? null,
    }));
}

function threadContextReferences({
  alias,
  event,
  profiles,
  interactions,
  localPreferences,
  translationTargetLanguage,
  sharePrefixes,
  mode,
}: ThreadContextReferencesProps) {
  const context = threadContextEvents(event);

  const relatedEvents = new Map(
    [...context, ...referencedEvents(event)].map((relatedEvent) => [
      relatedEvent.id,
      relatedEvent,
    ]),
  );

  let references: ReturnType<typeof threadEventReferences>;

  try {
    references = threadEventReferences(
      NostrEventSchema.parse(JSON.parse(event.raw_json)),
    );
  } catch {
    references = [];
  }

  return references.map((reference): WebNostrPostReference => {
    const contextEvent = relatedEvents.get(reference.id);

    if (!contextEvent) {
      return unresolvedReplyReference({
        alias,
        id: reference.id,
        relay: reference.relay,
        mode,
      });
    }

    const profile = profileForPubkey({
      profiles,
      pubkey: contextEvent.pubkey,
    });

    const flags = interactionFlags(interactions, contextEvent.id);

    return {
      entityKey: entityKey(contextEvent.id),
      type: 'event' as const,
      resolutionStatus: 'resolved' as const,
      id: contextEvent.id,
      pubkey: contextEvent.pubkey,
      kind: contextEvent.kind,
      npub: npubForPubkey(contextEvent.pubkey),
      authorName: profile?.displayName ?? undefined,
      authorUsername: profile?.name ?? undefined,
      authorPicture: profile?.picture ?? undefined,
      authorAbout: profile?.about ?? undefined,
      relayHints: [],
      sharePrefixes,
      createdAt: contextEvent.created_at,
      content: contextEvent.content,
      readAction: markRawEventAction({
        alias,
        event: contextEvent,
        state: 'read',
        mode,
      }),
      likeAction: likeNostrEventAction({
        alias,
        event: contextEvent,
        signalReviewMode: 'ask',
        candidateTopics: [],
        authorLabel: signalReviewAuthorLabel(profile, contextEvent.pubkey),
      }),
      archiveAction: markRawEventAction({
        alias,
        event: contextEvent,
        state: 'archived',
        mode,
      }),
      archived: false,
      replyAction: replyNostrEventAction({
        alias,
        event: contextEvent,
        profile,
        signalReviewMode: 'ask',
        candidateTopics: [],
      }),
      repostAction: repostNostrEventAction({
        alias,
        event: contextEvent,
        profile,
        signalReviewMode: 'ask',
        candidateTopics: [],
      }),
      liked: flags.liked,
      replied: flags.replied,
      reposted: flags.reposted,
      quoted: flags.quoted,
      showActions: true,
      profileActions: authorPreferenceActions({
        alias,
        pubkey: contextEvent.pubkey,
        mode,
        preference: null,
      }),
      profileActionsReadAction: authorPreferenceActionsReadAction({
        alias,
        pubkey: contextEvent.pubkey,
        mode,
      }),
      trailingActions: [
        translationPostAction({
          alias,
          content: contextEvent.content,
          targetLanguage: translationTargetLanguage,
        }),
        ...localPreferenceActions({
          alias,
          eventId: contextEvent.id,
          mode,
          preference: localPreferences.get(contextEvent.id) ?? null,
          targetAuthorPubkey: contextEvent.pubkey,
          targetAuthorLabel: signalReviewAuthorLabel(
            profile,
            contextEvent.pubkey,
          ),
          candidateTopics: [],
        }),
      ],
      inlineProfiles: inlineProfiles({
        alias,
        content: contextEvent.content,
        profiles,
        sharePrefixes,
        mode,
      }),
      embeddedReferences: [
        ...extractEventReferences(contextEvent.content).flatMap((reference) => {
          const embeddedEvent = relatedEvents.get(reference.id);

          return embeddedEvent
            ? [
                {
                  ...profileReference({
                    alias,
                    event: embeddedEvent,
                    profiles,
                    translationTargetLanguage,
                    sharePrefixes,
                    mode,
                  }),
                  token: reference.token,
                },
              ]
            : [];
        }),
        ...addressReferences({
          alias,
          content: contextEvent.content,
          profiles,
          sharePrefixes,
          mode,
        }),
      ],
    };
  });
}

function profileForPubkey({
  profiles,
  pubkey,
}: {
  profiles: Map<string, CachedProfile>;
  pubkey: string;
}): CachedProfile | undefined {
  return profiles.get(pubkey.toLowerCase());
}

function signalReviewAuthorLabel(
  profile: CachedProfile | undefined,
  pubkey: string,
): string {
  return (
    profile?.displayName?.trim() || profile?.name?.trim() || pubkey.slice(0, 12)
  );
}

function postViewFromNrEvent({
  event,
  profiles,
}: {
  event: NrEvent;
  profiles: Map<string, CachedProfile>;
}): NostrPostView {
  const profile = profileForPubkey({ profiles, pubkey: event.pubkey });

  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    createdAt: event.event_created_at,
    content: event.content,
    relayHints: event.relay_hints,
    authorName: profile?.displayName ?? null,
    authorUsername: profile?.name ?? null,
    authorPicture: profile?.picture ?? null,
    authorAbout: profile?.about ?? null,
  };
}

type EventNodeProps = {
  alias: string;
  event: NrEvent;
  profiles: Map<string, CachedProfile>;
  showReplyContext: boolean;
  interactions: NrInteraction[] | null;
  localPreferences: Map<string, 'like' | 'dislike'>;
  authorPreferences: Map<string, NrAuthorPreferenceValue>;
  sharePrefixes: NostrSharePrefixes;
  translationTargetLanguage: string;
  rankingScore: number | null;
  archiveSignalReviewMode?: NrSignalReviewMode;
  likeSignalReviewMode?: NrSignalReviewMode;
  replySignalReviewMode?: NrSignalReviewMode;
  repostQuoteSignalReviewMode?: NrSignalReviewMode;
  mode: NrListMode;
  renderScope: string;
};

export function eventNode({
  alias,
  event,
  profiles,
  showReplyContext,
  interactions,
  localPreferences,
  authorPreferences,
  sharePrefixes,
  translationTargetLanguage,
  rankingScore,
  archiveSignalReviewMode = 'ask',
  likeSignalReviewMode = 'ask',
  replySignalReviewMode = 'ask',
  repostQuoteSignalReviewMode = 'ask',
  mode,
  renderScope,
}: EventNodeProps): WebNode {
  if (event.kind !== 1 && event.kind !== 30023) {
    return activityEventNode({
      alias,
      event,
      profiles,
      authorPreferences,
      sharePrefixes,
      translationTargetLanguage,
      mode,
      renderScope,
    });
  }

  const eventInteractions = interactions ?? [];
  const nevent = neventForEvent(event);
  const post = postViewFromNrEvent({ event, profiles });
  const flags = interactionFlags(eventInteractions, event.id);

  const filterText = eventFilterText({ event, profiles });

  return {
    type: 'element',
    tag: 'treeItem',
    renderKey: `nr:${renderScope}:event:${event.id}`,
    props: {
      id: `nr-event-${event.id}`,
      entityKey: entityKey(event.id),
      className: `nr-list-event${mode === 'for-you' ? ' nr-for-you-event' : ''}`,
      defaultExpanded: false,
      filterText,
      filterName: event.summary || event.id,
      filterPath: `event/${event.id}`,
      filterTimestamps: [event.event_created_at],
    },
    summary: el('row', { gap: 'xs', align: 'between', itemAlign: 'start' }, [
      keyed(
        `nr:${renderScope}:event:${event.id}:menu`,
        eventActionsMenu(
          alias,
          event,
          mode,
          sharePrefixes,
          archiveSignalReviewMode,
        ),
      ),
      el('stack', { gap: 'xs', fill: true }, [
        eventSignalMetadata(event, rankingScore),
        ...summaryNodes(event.summary),
        keyed(
          `nr:${renderScope}:event:${event.id}:post`,
          el(
            'nostrPost',
            {
              size: 'sm',
              entityKey: entityKey(event.id),
              nostrEventId: post.id,
              nostrPubkey: post.pubkey,
              nostrNpub: npubForPubkey(post.pubkey),
              nostrRelayHints: post.relayHints,
              nostrSharePrefixes: sharePrefixes,
              nostrAuthorName: post.authorName ?? undefined,
              nostrAuthorUsername: post.authorUsername ?? undefined,
              nostrAuthorPicture: post.authorPicture ?? undefined,
              nostrAuthorAbout: post.authorAbout ?? undefined,
              nostrCreatedAt: post.createdAt,
              nostrContent: post.content,
              nostrInlineProfiles: inlineProfiles({
                alias,
                content: event.content,
                profiles,
                sharePrefixes,
                mode,
              }),
              nostrPermalink: nevent ? `nostr:${nevent}` : undefined,
              nostrEmbeds: nostrEmbeds({
                alias,
                event,
                profiles,
                interactions: eventInteractions,
                translationTargetLanguage,
                sharePrefixes,
                mode,
              }),
              nostrReplyContext: threadContextReferences({
                alias,
                event,
                profiles,
                interactions: eventInteractions,
                localPreferences,
                translationTargetLanguage,
                sharePrefixes,
                mode,
              }),
              nostrShowReplyContext: showReplyContext,
              nostrReadAction: readAction({
                alias,
                eventId: event.id,
                mode,
              }),
              nostrExtraActions: [
                translationPostAction({
                  alias,
                  content: post.content,
                  targetLanguage: translationTargetLanguage,
                }),
              ],
              nostrTrailingActions: localPreferenceActions({
                alias,
                eventId: event.id,
                mode,
                preference: localPreferences.get(event.id) ?? null,
                targetAuthorPubkey: event.pubkey,
                targetAuthorLabel: signalReviewAuthorLabel(
                  profileForPubkey({ profiles, pubkey: event.pubkey }),
                  event.pubkey,
                ),
                candidateTopics: signalReviewTopics(event),
              }),
              nostrProfileActions: authorPreferenceActions({
                alias,
                pubkey: event.pubkey,
                mode,
                preference:
                  authorPreferences.get(event.pubkey.toLowerCase()) ?? null,
              }),
              nostrProfileActionsReadAction: authorPreferenceActionsReadAction({
                alias,
                pubkey: event.pubkey,
                mode,
              }),
              nostrArchiveAction: archiveAction({
                alias,
                event,
                mode,
                signalReviewMode: archiveSignalReviewMode,
              }),
              nostrArchived: event.archived_at !== null,
              nostrLikeAction: likeEventAction({
                alias,
                event,
                post,
                signalReviewMode: likeSignalReviewMode,
              }),
              nostrReplyAction: replyEventAction({
                alias,
                event,
                post,
                signalReviewMode: replySignalReviewMode,
              }),
              nostrRepostAction: repostEventAction({
                alias,
                event,
                post,
                signalReviewMode: repostQuoteSignalReviewMode,
              }),
              nostrLiked: flags.liked,
              nostrReplied: flags.replied,
              nostrReposted: flags.reposted,
              nostrQuoted: flags.quoted,
            },
            [],
          ),
        ),
      ]),
    ]),
    children: [],
  };
}

type GroupNodeProps = {
  alias: string;
  group: NrTagGroup;
  profiles: Map<string, CachedProfile>;
  interactions: NrInteraction[];
  localPreferences: Map<string, 'like' | 'dislike'>;
  authorPreferences: Map<string, NrAuthorPreferenceValue>;
  sharePrefixes: NostrSharePrefixes;
  translationTargetLanguage: string;
  rankingScores: Record<string, number>;
  archiveSignalReviewMode: NrSignalReviewMode;
  likeSignalReviewMode: NrSignalReviewMode;
  replySignalReviewMode: NrSignalReviewMode;
  repostQuoteSignalReviewMode: NrSignalReviewMode;
  mode: NrListMode;
  selectedTimeRanges: NrListTimeRange[];
};

function activityTarget(event: NrEvent): NostrEvent | null {
  const context = [...threadContextEvents(event), ...referencedEvents(event)];

  if (context[0]) {
    return context[0];
  }

  if (event.kind === 6) {
    try {
      const parsed = NostrEventSchema.safeParse(JSON.parse(event.content));

      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  return null;
}

function mergedActivityNode({
  alias,
  target,
  targetEvent,
  activities,
  profiles,
  localPreference,
  authorPreference,
  sharePrefixes,
  translationTargetLanguage,
  rankingEvent,
  rankingScore,
  mode,
  renderScope,
}: {
  alias: string;
  target: NostrEvent;
  targetEvent: NrEvent | null;
  activities: NrEvent[];
  profiles: Map<string, CachedProfile>;
  localPreference: 'like' | 'dislike' | null;
  authorPreference: NrAuthorPreferenceValue | null;
  sharePrefixes: NostrSharePrefixes;
  translationTargetLanguage: string;
  rankingEvent: NrEvent | null;
  rankingScore: number | null;
  mode: NrListMode;
  renderScope: string;
}): WebNode {
  const archived = activities.some((activity) => activity.archived_at !== null);
  const summary = rankingEvent?.summary ?? activities[0]?.summary ?? '';

  const relatedEvents = new Map(
    [...(targetEvent ? [targetEvent] : []), ...activities]
      .flatMap((activity) => [
        ...threadContextEvents(activity),
        ...referencedEvents(activity),
      ])
      .filter((event) => event.id !== target.id)
      .map((event) => [event.id, event]),
  );

  const embeds = Object.fromEntries([
    ...extractEventReferences(target.content).flatMap(
      (
        reference,
      ): Array<[string, ReturnType<typeof profileReferenceWithEmbeds>]> => {
        const event = relatedEvents.get(reference.id);

        return event
          ? [
              [
                reference.token,
                profileReferenceWithEmbeds({
                  alias,
                  event,
                  profiles,
                  relatedEvents,
                  translationTargetLanguage,
                  sharePrefixes,
                  mode,
                }),
              ],
            ]
          : [];
      },
    ),
    ...addressReferences({
      alias,
      content: target.content,
      profiles,
      sharePrefixes,
      mode,
    }).map((reference) => [reference.token, reference] as const),
  ]);

  const replyContext = threadEventReferences(target).map((reference) => {
    const event = relatedEvents.get(reference.id);

    return event
      ? {
          ...profileReference({
            alias,
            event,
            profiles,
            translationTargetLanguage,
            sharePrefixes,
            mode,
          }),
          resolutionStatus: 'resolved' as const,
        }
      : unresolvedReplyReference({
          alias,
          id: reference.id,
          relay: reference.relay,
          mode,
        });
  });

  const headers = activities.flatMap((activity) => {
    try {
      const event = JSON.parse(activity.raw_json) as NostrEvent;

      const label =
        event.kind === 6
          ? 'Reposted'
          : event.kind === 7
            ? `Reacted ${event.content || '+'}`
            : null;

      return label
        ? [activityHeaderFor({ alias, label, event, profiles, mode })]
        : [];
    } catch {
      return [];
    }
  });

  return {
    type: 'element',
    tag: 'treeItem',
    renderKey: `nr:${renderScope}:activity:${target.id}`,
    props: {
      id: `nr-activity-${target.id}`,
      entityKey: entityKey(target.id),
      className: `nr-list-event${mode === 'for-you' ? ' nr-for-you-event' : ''}`,
      defaultExpanded: false,
      filterTimestamps:
        rankingEvent !== null
          ? [rankingEvent.event_created_at]
          : activities.map((activity) => activity.event_created_at),
    },
    summary: el('row', { gap: 'xs', align: 'between', itemAlign: 'start' }, [
      keyed(
        `nr:${renderScope}:activity:${target.id}:menu`,
        referencedEventActionsMenu({
          alias,
          event: target,
          archived,
          mode,
          sharePrefixes,
        }),
      ),
      el('stack', { fill: true }, [
        ...(rankingEvent
          ? [eventSignalMetadata(rankingEvent, rankingScore)]
          : []),
        ...summaryNodes(summary),
        profilePostNode({
          alias,
          event: target,
          profiles,
          replyContext,
          embeds,
          activityHeaders: headers,
          archived,
          localPreference,
          authorPreference,
          sharePrefixes,
          translationTargetLanguage,
          mode,
          renderScope: `${renderScope}:activity:${target.id}`,
          signalCandidateTopics: rankingEvent
            ? signalReviewTopics(rankingEvent)
            : [],
        }),
      ]),
    ]),
    children: [],
  } as WebNode;
}

function groupEventNodes({
  alias,
  events,
  profiles,
  interactions,
  localPreferences,
  authorPreferences,
  sharePrefixes,
  translationTargetLanguage,
  rankingScores,
  archiveSignalReviewMode,
  likeSignalReviewMode,
  replySignalReviewMode,
  repostQuoteSignalReviewMode,
  mode,
  renderScope,
}: {
  alias: string;
  events: NrEvent[];
  profiles: Map<string, CachedProfile>;
  interactions: NrInteraction[];
  localPreferences: Map<string, 'like' | 'dislike'>;
  authorPreferences: Map<string, NrAuthorPreferenceValue>;
  sharePrefixes: NostrSharePrefixes;
  translationTargetLanguage: string;
  rankingScores: Record<string, number>;
  archiveSignalReviewMode: NrSignalReviewMode;
  likeSignalReviewMode: NrSignalReviewMode;
  replySignalReviewMode: NrSignalReviewMode;
  repostQuoteSignalReviewMode: NrSignalReviewMode;
  mode: NrListMode;
  renderScope: string;
}): WebNode[] {
  const eventsById = new Map(events.map((event) => [event.id, event]));

  const activitiesByTarget = new Map<
    string,
    { target: NostrEvent; activities: NrEvent[] }
  >();

  for (const event of events) {
    if (event.kind === 1 || event.kind === 30023) {
      continue;
    }

    const target = activityTarget(event);

    if (!target) {
      continue;
    }

    const existing = activitiesByTarget.get(target.id);

    if (existing) {
      existing.activities.push(event);
    } else {
      activitiesByTarget.set(target.id, { target, activities: [event] });
    }
  }

  const renderedTargets = new Set<string>();
  const nodes: WebNode[] = [];

  for (const event of events) {
    if (event.kind !== 1 && event.kind !== 30023) {
      const target = activityTarget(event);

      if (!target || renderedTargets.has(target.id)) {
        continue;
      }

      const aggregate = activitiesByTarget.get(target.id);

      if (!aggregate) {
        continue;
      }

      renderedTargets.add(target.id);
      const targetEvent = eventsById.get(target.id) ?? null;

      nodes.push(
        mergedActivityNode({
          alias,
          target: aggregate.target,
          targetEvent,
          activities: aggregate.activities,
          profiles,
          localPreference: localPreferences.get(target.id) ?? null,
          authorPreference:
            authorPreferences.get(target.pubkey.toLowerCase()) ?? null,
          sharePrefixes,
          translationTargetLanguage,
          rankingEvent: targetEvent ?? event,
          rankingScore: rankingScores[targetEvent?.id ?? event.id] ?? null,
          mode,
          renderScope,
        }),
      );

      continue;
    }

    if (renderedTargets.has(event.id)) {
      continue;
    }

    const aggregate = activitiesByTarget.get(event.id);

    if (aggregate) {
      renderedTargets.add(event.id);

      nodes.push(
        mergedActivityNode({
          alias,
          target: JSON.parse(event.raw_json) as NostrEvent,
          targetEvent: event,
          activities: aggregate.activities,
          profiles,
          localPreference: localPreferences.get(event.id) ?? null,
          authorPreference:
            authorPreferences.get(event.pubkey.toLowerCase()) ?? null,
          sharePrefixes,
          translationTargetLanguage,
          rankingEvent: event,
          rankingScore: rankingScores?.[event.id] ?? null,
          mode,
          renderScope,
        }),
      );
    } else {
      nodes.push(
        eventNode({
          alias,
          event,
          profiles,
          showReplyContext: mode === 'timeline' || mode === 'for-you',
          interactions,
          localPreferences,
          authorPreferences,
          sharePrefixes,
          translationTargetLanguage,
          rankingScore: rankingScores?.[event.id] ?? null,
          archiveSignalReviewMode,
          likeSignalReviewMode,
          replySignalReviewMode,
          repostQuoteSignalReviewMode,
          mode,
          renderScope,
        }),
      );
    }
  }

  return nodes;
}

function groupNode({
  alias,
  group,
  profiles,
  interactions,
  localPreferences,
  authorPreferences,
  sharePrefixes,
  translationTargetLanguage,
  rankingScores,
  archiveSignalReviewMode,
  likeSignalReviewMode,
  replySignalReviewMode,
  repostQuoteSignalReviewMode,
  mode,
  selectedTimeRanges,
}: GroupNodeProps): WebNode {
  return {
    type: 'element',
    tag: 'treeItem',
    renderKey: `nr:${mode}:group:${group.type}:${encodeURIComponent(group.tag)}`,
    props: {
      id: `nr-${group.type}-${group.tag}`,
      entityKey: tagGroupEntityKey(group.type, group.tag),
      defaultExpanded: false,
      filterText: group.tag,
      filterName: group.tag,
      filterPath: `${group.type}/${group.tag}`,
      pruneWhenNoTreeItems: true,
    },
    summary: el(
      'row',
      { gap: 'xs', itemAlign: 'center', align: 'between', fill: true },
      [
        el('row', { gap: 'xs', itemAlign: 'center' }, [
          ...(group.type === 'language'
            ? []
            : [
                keyed(
                  `nr:${mode}:group:${group.type}:${encodeURIComponent(group.tag)}:read-shortcut`,
                  el(
                    'button',
                    {
                      label: '✓',
                      ariaLabel: `Mark all ${group.tag} ${group.type} posts read`,
                      title: 'Read all',
                      buttonVariant: 'icon',
                      className: 'nr-tag-read-shortcut',
                      stopPropagation: true,
                      action: readTagAction({
                        alias,
                        type: group.type,
                        tag: group.tag,
                        mode,
                        selectedTimeRanges,
                      }),
                    },
                    [],
                  ),
                ),
              ]),
          el('countLabel', { label: group.tag, weight: 'semibold' }, []),
        ]),
        ...(group.type === 'language'
          ? []
          : [
              keyed(
                `nr:${mode}:group:${group.type}:${encodeURIComponent(group.tag)}:menu`,
                el(
                  'overflowMenu',
                  {
                    label: '⋮',
                    buttonVariant: 'icon',
                    stopPropagation: true,
                  },
                  [
                    {
                      type: 'element',
                      tag: 'menuItem',
                      props: {
                        label: 'Read all',
                        action: readTagAction({
                          alias,
                          type: group.type,
                          tag: group.tag,
                          mode,
                          selectedTimeRanges,
                        }),
                      },
                    },
                    {
                      type: 'element',
                      tag: 'menuItem',
                      props: {
                        label:
                          group.type === 'topic'
                            ? 'Add to preferred topics'
                            : 'Add to preferred moods',
                        action: addTaxonomyTagAction({
                          alias,
                          type: group.type,
                          tag: group.tag,
                          preference: 'interested',
                        }),
                      },
                    },
                    ...(group.type === 'topic'
                      ? [
                          {
                            type: 'element' as const,
                            tag: 'menuItem' as const,
                            props: {
                              label: 'Add to unpreferred topics',
                              action: addTaxonomyTagAction({
                                alias,
                                type: group.type,
                                tag: group.tag,
                                preference: 'uninterested',
                              }),
                            },
                          },
                        ]
                      : []),
                  ],
                ),
              ),
            ]),
      ],
    ),
    children: groupEventNodes({
      alias,
      events: group.events,
      profiles,
      interactions,
      localPreferences,
      authorPreferences,
      sharePrefixes,
      translationTargetLanguage,
      rankingScores,
      archiveSignalReviewMode,
      likeSignalReviewMode,
      replySignalReviewMode,
      repostQuoteSignalReviewMode,
      mode,
      renderScope: `${group.type}:${encodeURIComponent(group.tag)}`,
    }),
  };
}

type SectionNodeProps = {
  alias: string;
  title: string;
  type: 'topic' | 'mood' | 'language';
  groups: NrTagGroup[];
  profiles: Map<string, CachedProfile>;
  interactions: NrInteraction[];
  localPreferences: Map<string, 'like' | 'dislike'>;
  authorPreferences: Map<string, NrAuthorPreferenceValue>;
  sharePrefixes: NostrSharePrefixes;
  translationTargetLanguage: string;
  rankingScores: Record<string, number>;
  archiveSignalReviewMode: NrSignalReviewMode;
  likeSignalReviewMode: NrSignalReviewMode;
  replySignalReviewMode: NrSignalReviewMode;
  repostQuoteSignalReviewMode: NrSignalReviewMode;
  mode: NrListMode;
  selectedTimeRanges: NrListTimeRange[];
};

function sectionNode({
  alias,
  title,
  type,
  groups,
  profiles,
  interactions,
  localPreferences,
  authorPreferences,
  sharePrefixes,
  translationTargetLanguage,
  rankingScores,
  archiveSignalReviewMode,
  likeSignalReviewMode,
  replySignalReviewMode,
  repostQuoteSignalReviewMode,
  mode,
  selectedTimeRanges,
}: SectionNodeProps): WebNode {
  return {
    type: 'element',
    tag: 'treeItem',
    renderKey: `nr:${mode}:section:${type}`,
    props: {
      id: `nr-section-${title.toLowerCase()}`,
      defaultExpanded: false,
      filterName: title,
      filterText: title,
    },
    summary: el(
      'row',
      { gap: 'xs', itemAlign: 'center', align: 'between', fill: true },
      [
        el('row', { gap: 'xs', itemAlign: 'center' }, [
          el('countLabel', { label: title, weight: 'bold' }, []),
        ]),
        ...(type === 'language'
          ? []
          : [
              keyed(
                `nr:${mode}:section:${type}:menu`,
                el(
                  'overflowMenu',
                  {
                    label: '⋮',
                    buttonVariant: 'icon',
                    stopPropagation: true,
                  },
                  [
                    {
                      type: 'element',
                      tag: 'menuItem',
                      props: {
                        label:
                          type === 'topic'
                            ? 'Edit topic preferences'
                            : 'Add a mood',
                        action: taxonomyEditorAction(alias, type),
                      },
                    },
                  ],
                ),
              ),
            ]),
      ],
    ),
    children:
      groups.length === 0
        ? [el('text', { tone: 'muted', size: 'sm' }, [text('(none)')])]
        : groups.map((group) =>
            groupNode({
              alias,
              group,
              profiles,
              interactions,
              localPreferences,
              authorPreferences,
              sharePrefixes,
              translationTargetLanguage,
              rankingScores,
              archiveSignalReviewMode,
              likeSignalReviewMode,
              replySignalReviewMode,
              repostQuoteSignalReviewMode,
              mode,
              selectedTimeRanges,
            }),
          ),
  };
}

function taxonomyEditorAction(alias: string, type: 'topic' | 'mood') {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'taxonomy',
    arguments: {},
    options: { type, mode: 'edit' },
    surface: 'modal' as const,
    modalTitle: type === 'topic' ? 'Topic preferences' : 'Add a mood',
    recordInTimeline: false,
  };
}

function settingsAction(alias: string) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'settings',
    arguments: {},
    options: {},
    surface: 'modal' as const,
    modalTitle: 'Nostr radar settings',
    recordInTimeline: false,
  };
}

function schedulerAction(alias: string) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'schedule',
    arguments: {},
    options: {},
    surface: 'modal' as const,
    modalTitle: 'Nostr radar schedule',
    recordInTimeline: false,
  };
}

type TranslationPostActionProps = {
  alias: string;
  content: string;
  targetLanguage: string;
};

function translationPostAction({
  alias,
  content,
  targetLanguage,
}: TranslationPostActionProps) {
  return {
    label: 'Translate',
    ariaLabel: `Translate to ${targetLanguage}`,
    icon: 'translate' as const,
    action: {
      type: 'capability' as const,
      operation: TranslationV1.operations.translate.id,
      input: {
        content,
        format: 'plain-text',
        sourceLanguage: null,
        targetLanguage,
        context: null,
      },
      consumerAlias: alias,
      selection: 'auto' as const,
      surface: 'modal' as const,
      modalTitle: 'Translation',
    },
  };
}

function fetchProgressStatus(): WebNode {
  return keyed(
    'nr:timeline:fetch-progress',
    el('treeItem', { id: 'nr-fetch-progress', defaultExpanded: false }, [
      el('text', { tone: 'muted', size: 'sm' }, [
        text('Background fetch progress'),
      ]),
      el(
        'commandStatus',
        {
          id: NR_FETCH_STATUS_TARGET_ID,
          className: 'nr-fetch-progress-status',
        },
        [],
      ),
    ]),
  );
}

type ListFilterPanelProps = {
  alias: string;
  mode: 'timeline' | 'for-you' | 'profile';
  selected: NrFeedCategory[];
  selectedTimeRanges: NrListTimeRange[];
};

function listFilterPanel({
  alias,
  mode,
  selected,
  selectedTimeRanges,
}: ListFilterPanelProps): WebNode {
  return keyed(
    `nr:${mode}:filter-form`,
    el(
      'form',
      {
        className: 'web-form web-form--stacked nr-list-filter-panel',
        revealId: NR_LIST_FILTER_REVEAL_ID,
        hiddenUntilRevealed: true,
        formOptionFieldNames: ['kinds'],
        action: nrListCommandAction({ alias, mode, selectedTimeRanges }),
      },
      [
        el('text', { weight: 'bold' }, [text('KINDS')]),
        el(
          'stack',
          { className: 'nr-list-filter-options', gap: 'xs' },
          NR_FEED_CATEGORIES.map((category) =>
            el('row', { gap: 'xs', itemAlign: 'center' }, [
              el(
                'checkbox',
                {
                  formFieldName: 'kinds',
                  value: category,
                  checked: selected.includes(category),
                  className: 'web-checkbox--retro',
                },
                [],
              ),
              text(NR_FEED_CATEGORY_LABELS[category]),
            ]),
          ),
        ),
        el('row', { className: 'web-form__actions', gap: 'sm' }, [
          el('button', { label: 'Apply', htmlType: 'submit' }, []),
          el(
            'button',
            {
              label: 'Close',
              action: {
                type: 'hideReveal',
                targetId: NR_LIST_FILTER_REVEAL_ID,
              },
            },
            [],
          ),
        ]),
      ],
    ),
  );
}

type ListModeSwitchProps = {
  alias: string;
  mode: NrListMode;
  selectedTimeRanges: NrListTimeRange[];
};

function listModeSwitch({
  alias,
  mode,
  selectedTimeRanges,
}: ListModeSwitchProps): WebNode {
  return el(
    'row',
    { className: 'widget-tabs', gap: 'xs', itemAlign: 'center' },
    [
      el(
        'button',
        {
          label: 'Timeline',
          className: `web-button widget-tab${mode === 'timeline' ? ' active' : ''}`,
          action: nrListCommandAction({
            alias,
            mode: 'timeline',
            selectedTimeRanges,
          }),
        },
        [],
      ),
      el(
        'button',
        {
          label: 'For You',
          className: `web-button widget-tab${mode === 'for-you' ? ' active' : ''}`,
          action: nrListCommandAction({
            alias,
            mode: 'for-you',
            selectedTimeRanges,
          }),
        },
        [],
      ),
      el(
        'button',
        {
          label: 'Profile',
          className: `web-button widget-tab${mode === 'profile' ? ' active' : ''}`,
          action: nrListCommandAction({
            alias,
            mode: 'profile',
            selectedTimeRanges,
          }),
        },
        [],
      ),
      el(
        'button',
        {
          label: 'Archive',
          className: `web-button widget-tab${mode === 'archive' ? ' active' : ''}`,
          action: nrListCommandAction({
            alias,
            mode: 'archive',
            selectedTimeRanges,
          }),
        },
        [],
      ),
    ],
  );
}

function profilePostNode({
  alias,
  event,
  profiles,
  replyContext,
  embeds,
  activityHeaders,
  archived,
  localPreference,
  authorPreference,
  sharePrefixes,
  translationTargetLanguage,
  mode,
  renderScope,
  signalCandidateTopics,
}: {
  alias: string;
  event: NostrEvent;
  profiles: Map<string, CachedProfile>;
  replyContext: WebNostrPostReference[];
  embeds: Record<string, ReturnType<typeof profileReference>>;
  activityHeaders: Array<{
    label: string;
    actorPubkey: string;
    actorNpub: string | undefined;
    actorName: string | undefined;
    actorUsername: string | undefined;
    actorPicture: string | undefined;
    actorAbout: string | undefined;
    createdAt: number;
  }>;
  archived: boolean;
  localPreference: 'like' | 'dislike' | null | undefined;
  authorPreference: NrAuthorPreferenceValue | null;
  sharePrefixes: NostrSharePrefixes | null;
  translationTargetLanguage: string;
  mode: NrListMode;
  renderScope: string;
  signalCandidateTopics: string[];
}): WebNode {
  const profile = profileForPubkey({ profiles, pubkey: event.pubkey });

  return keyed(
    `nr:${renderScope}:post:${event.id}`,
    el(
      'nostrPost',
      {
        size: 'sm',
        entityKey: entityKey(event.id),
        nostrEventId: event.id,
        nostrPubkey: event.pubkey,
        nostrNpub: npubForPubkey(event.pubkey),
        nostrAuthorName: profile?.displayName,
        nostrAuthorUsername: profile?.name,
        nostrAuthorPicture: profile?.picture,
        nostrAuthorAbout: profile?.about,
        ...(sharePrefixes ? { nostrSharePrefixes: sharePrefixes } : {}),
        nostrCreatedAt: event.created_at,
        nostrContent: event.content,
        nostrExtraActions: [
          translationPostAction({
            alias,
            content: event.content,
            targetLanguage: translationTargetLanguage,
          }),
        ],
        nostrInlineProfiles: inlineProfiles({
          alias,
          content: event.content,
          profiles,
          sharePrefixes: sharePrefixes ?? {
            nevent: 'nostr://',
            nprofile: 'nostr://',
          },
          mode,
        }),
        nostrReplyContext: replyContext,
        nostrShowReplyContext: replyContext.length > 0,
        nostrEmbeds: embeds,
        nostrReplyAction: replyNostrEventAction({
          alias,
          event,
          profile,
          signalReviewMode: 'ask',
          candidateTopics: signalCandidateTopics,
        }),
        nostrLikeAction: likeNostrEventAction({
          alias,
          event,
          signalReviewMode: 'ask',
          candidateTopics: signalCandidateTopics,
          authorLabel: signalReviewAuthorLabel(profile, event.pubkey),
        }),
        nostrRepostAction: repostNostrEventAction({
          alias,
          event,
          profile,
          signalReviewMode: 'ask',
          candidateTopics: signalCandidateTopics,
        }),
        ...(localPreference === undefined
          ? {}
          : {
              nostrTrailingActions: localPreferenceActions({
                alias,
                eventId: event.id,
                mode,
                preference: localPreference,
                targetAuthorPubkey: event.pubkey,
                targetAuthorLabel: signalReviewAuthorLabel(
                  profile,
                  event.pubkey,
                ),
                candidateTopics: signalCandidateTopics,
              }),
            }),
        nostrProfileActions: authorPreferenceActions({
          alias,
          pubkey: event.pubkey,
          mode,
          preference: authorPreference,
        }),
        nostrProfileActionsReadAction: authorPreferenceActionsReadAction({
          alias,
          pubkey: event.pubkey,
          mode,
        }),
        ...(activityHeaders.length > 0
          ? { nostrActivityHeaders: activityHeaders }
          : {}),
        ...(activityHeaders.length > 0
          ? {
              nostrReadAction: markRawEventAction({
                alias,
                event,
                state: 'read',
                mode,
              }),
              nostrArchiveAction: markRawEventAction({
                alias,
                event,
                state: archived ? 'unarchived' : 'archived',
                mode,
              }),
              nostrArchived: archived,
            }
          : {}),
      },
      [],
    ),
  );
}

function activityHeaderFor({
  alias,
  label,
  event,
  profiles,
  mode,
}: {
  alias: string;
  label: string;
  event: NostrEvent;
  profiles: Map<string, CachedProfile>;
  mode: NrListMode;
}) {
  const profile = profileForPubkey({ profiles, pubkey: event.pubkey });

  return {
    label,
    actorPubkey: event.pubkey,
    actorNpub: npubForPubkey(event.pubkey),
    actorName: profile?.displayName ?? undefined,
    actorUsername: profile?.name ?? undefined,
    actorPicture: profile?.picture ?? undefined,
    actorAbout: profile?.about ?? undefined,
    createdAt: event.created_at,
    profileActions: authorPreferenceActions({
      alias,
      pubkey: event.pubkey,
      mode,
      preference: null,
    }),
    profileActionsReadAction: authorPreferenceActionsReadAction({
      alias,
      pubkey: event.pubkey,
      mode,
    }),
  };
}

function profileReference({
  alias,
  event,
  profiles,
  translationTargetLanguage,
  sharePrefixes,
  mode,
}: {
  alias: string;
  event: NostrEvent;
  profiles: Map<string, CachedProfile>;
  translationTargetLanguage: string;
  sharePrefixes: NostrSharePrefixes;
  mode: NrListMode;
}) {
  const profile = profileForPubkey({ profiles, pubkey: event.pubkey });

  return {
    entityKey: entityKey(event.id),
    type: 'event' as const,
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    npub: npubForPubkey(event.pubkey),
    authorName: profile?.displayName ?? undefined,
    authorUsername: profile?.name ?? undefined,
    authorPicture: profile?.picture ?? undefined,
    authorAbout: profile?.about ?? undefined,
    relayHints: [],
    sharePrefixes,
    createdAt: event.created_at,
    content: event.content,
    likeAction: likeNostrEventAction({
      alias,
      event,
      signalReviewMode: 'ask',
      candidateTopics: [],
      authorLabel: signalReviewAuthorLabel(profile, event.pubkey),
    }),
    replyAction: replyNostrEventAction({
      alias,
      event,
      profile,
      signalReviewMode: 'ask',
      candidateTopics: [],
    }),
    repostAction: repostNostrEventAction({
      alias,
      event,
      profile,
      signalReviewMode: 'ask',
      candidateTopics: [],
    }),
    showActions: true,
    profileActions: authorPreferenceActions({
      alias,
      pubkey: event.pubkey,
      mode,
      preference: null,
    }),
    profileActionsReadAction: authorPreferenceActionsReadAction({
      alias,
      pubkey: event.pubkey,
      mode,
    }),
    trailingActions: [
      translationPostAction({
        alias,
        content: event.content,
        targetLanguage: translationTargetLanguage,
      }),
    ],
    inlineProfiles: inlineProfiles({
      alias,
      content: event.content,
      profiles,
      sharePrefixes,
      mode,
    }),
  };
}

type ProfileReferenceWithEmbedsProps = {
  alias: string;
  event: NostrEvent;
  profiles: Map<string, CachedProfile>;
  relatedEvents: Map<string, NostrEvent>;
  translationTargetLanguage: string;
  sharePrefixes: NostrSharePrefixes;
  mode: NrListMode;
};

function profileReferenceWithEmbeds({
  alias,
  event,
  profiles,
  relatedEvents,
  translationTargetLanguage,
  sharePrefixes,
  mode,
}: ProfileReferenceWithEmbedsProps) {
  return {
    ...profileReference({
      alias,
      event,
      profiles,
      translationTargetLanguage,
      sharePrefixes,
      mode,
    }),
    embeddedReferences: [
      ...extractEventReferences(event.content).flatMap((reference) => {
        const embeddedEvent = relatedEvents.get(reference.id);

        return embeddedEvent
          ? [
              {
                ...profileReference({
                  alias,
                  event: embeddedEvent,
                  profiles,
                  translationTargetLanguage,
                  sharePrefixes,
                  mode,
                }),
                token: reference.token,
              },
            ]
          : [];
      }),
      ...addressReferences({
        alias,
        content: event.content,
        profiles,
        sharePrefixes,
        mode,
      }),
    ],
  };
}

function profileEventNode({
  alias,
  profileEvent,
  profiles,
  authorPreferences,
  sharePrefixes,
  translationTargetLanguage,
  mode,
  renderScope,
}: {
  alias: string;
  profileEvent: NrProfileEvent;
  profiles: Map<string, CachedProfile>;
  authorPreferences: Map<string, NrAuthorPreferenceValue>;
  sharePrefixes: NostrSharePrefixes;
  translationTargetLanguage: string;
  mode: NrListMode;
  renderScope: string;
}): WebNode {
  const { event, referencedEvents } = profileEvent;

  const referencedEventsById = new Map(
    referencedEvents.map((reference) => [reference.id, reference]),
  );

  let reposted: NostrEvent | null = null;

  if (event.kind === 6) {
    try {
      const parsed = NostrEventSchema.safeParse(JSON.parse(event.content));
      reposted = parsed.success ? parsed.data : null;
    } catch {
      reposted = null;
    }
  }

  if (reposted === null && (event.kind === 6 || event.kind === 16)) {
    const targetEdge = parseEventReferences(event).find(
      (edge) => edge.role === 'repost-target' && edge.target.type === 'event',
    );

    reposted =
      targetEdge?.target.type === 'event'
        ? (referencedEventsById.get(targetEdge.target.eventId) ?? null)
        : null;
  }

  const displayEvent = reposted ?? event;
  const category = categoryForNrEvent(event);

  const activityHeader =
    event.kind === 6 || event.kind === 16
      ? activityHeaderFor({ alias, label: 'Reposted', event, profiles, mode })
      : event.kind === 7
        ? activityHeaderFor({
            alias,
            label: `Reacted ${event.content || '+'}`,
            event,
            profiles,
            mode,
          })
        : null;

  const replyContext =
    category === 'replies' || reposted !== null
      ? threadEventReferences(displayEvent).map((reference) => {
          const contextEvent = referencedEventsById.get(reference.id);

          return contextEvent
            ? {
                ...profileReferenceWithEmbeds({
                  alias,
                  event: contextEvent,
                  profiles,
                  relatedEvents: referencedEventsById,
                  translationTargetLanguage,
                  sharePrefixes,
                  mode,
                }),
                resolutionStatus: 'resolved' as const,
              }
            : unresolvedReplyReference({
                alias,
                id: reference.id,
                relay: reference.relay,
                mode,
              });
        })
      : [];

  const embeds = Object.fromEntries([
    ...extractEventReferences(displayEvent.content).flatMap(
      (
        reference,
      ): Array<[string, ReturnType<typeof profileReferenceWithEmbeds>]> => {
        const event = referencedEventsById.get(reference.id);

        return event
          ? [
              [
                reference.token,
                profileReferenceWithEmbeds({
                  alias,
                  event,
                  profiles,
                  relatedEvents: referencedEventsById,
                  translationTargetLanguage,
                  sharePrefixes,
                  mode,
                }),
              ],
            ]
          : [];
      },
    ),
    ...addressReferences({
      alias,
      content: displayEvent.content,
      profiles,
      sharePrefixes,
      mode,
    }).map((reference) => [reference.token, reference] as const),
  ]);

  return {
    type: 'element',
    tag: 'treeItem',
    renderKey: `nr:${renderScope}:source:${event.id}`,
    props: { id: `nr-profile-${event.id}`, defaultExpanded: false },
    summary: el('stack', { gap: 'xs', fill: true }, [
      ...(event.kind === 7
        ? referencedEvents.map((reference) =>
            profilePostNode({
              alias,
              event: reference,
              profiles,
              replyContext: [],
              embeds: {},
              activityHeaders: activityHeader ? [activityHeader] : [],
              archived: false,
              localPreference: undefined,
              authorPreference:
                authorPreferences.get(reference.pubkey.toLowerCase()) ?? null,
              sharePrefixes: null,
              translationTargetLanguage,
              mode,
              renderScope: `${renderScope}:source:${event.id}:reference:${reference.id}`,
              signalCandidateTopics: [],
            }),
          )
        : [
            profilePostNode({
              alias,
              event: displayEvent,
              profiles,
              replyContext,
              embeds,
              activityHeaders: activityHeader ? [activityHeader] : [],
              archived: false,
              localPreference: undefined,
              authorPreference:
                authorPreferences.get(displayEvent.pubkey.toLowerCase()) ??
                null,
              sharePrefixes,
              translationTargetLanguage,
              mode,
              renderScope: `${renderScope}:source:${event.id}`,
              signalCandidateTopics: [],
            }),
          ]),
    ]),
    children: [],
  } as WebNode;
}

function activityEventNode({
  alias,
  event,
  profiles,
  authorPreferences,
  sharePrefixes,
  translationTargetLanguage,
  mode,
  renderScope,
}: {
  alias: string;
  event: NrEvent;
  profiles: Map<string, CachedProfile>;
  authorPreferences: Map<string, NrAuthorPreferenceValue>;
  sharePrefixes: NostrSharePrefixes;
  translationTargetLanguage: string;
  mode: NrListMode;
  renderScope: string;
}): WebNode {
  let rawEvent: NostrEvent;

  try {
    rawEvent = JSON.parse(event.raw_json) as NostrEvent;
  } catch {
    return el('text', { tone: 'muted' }, [text(`Invalid event ${event.id}`)]);
  }

  return profileEventNode({
    alias,
    profileEvent: {
      event: rawEvent,
      referencedEvents: [
        ...threadContextEvents(event),
        ...referencedEvents(event),
      ],
    },
    profiles,
    authorPreferences,
    sharePrefixes,
    translationTargetLanguage,
    mode,
    renderScope,
  });
}

export function renderNrListWeb({
  alias,
  listData,
  schedulerResource,
  profiles,
}: RenderNrListWebProps): WebNodeRoot {
  const localPreferences = new Map<string, 'like' | 'dislike'>();
  const sharePrefixes = nrSharePrefixes(listData.settings);

  const translationTargetLanguage =
    listData.settings.translationTargetLanguage ?? 'en';

  const fetchCoverage =
    listData.mode === 'timeline' ? fetchCoverageBar(alias, listData) : null;

  const listOptions = nrListCommandOptions({
    mode: listData.mode,
    selectedTimeRanges: listData.selectedTimeRanges,
  });

  const selectedTreeTimeRanges: WebTreeTimeRange[] =
    listData.selectedTimeRanges.map((range) => ({
      ...range,
      key: nrListTimeRangeKey(range),
      removeAction: nrListCommandAction({
        alias,
        mode: listData.mode,
        selectedTimeRanges: listData.selectedTimeRanges.filter(
          (selected) =>
            selected.since !== range.since || selected.until !== range.until,
        ),
      }),
    }));

  const authorPreferences = new Map<string, NrAuthorPreferenceValue>(
    listData.authorPreferences.map((preference) => [
      preference.pubkey.toLowerCase(),
      preference.preference,
    ]),
  );

  for (const signal of listData.interestSignals) {
    if (signal.source !== 'private') {
      continue;
    }

    if (signal.type === 'local_like') {
      localPreferences.set(signal.targetEventId, 'like');
    } else if (signal.type === 'local_dislike') {
      localPreferences.set(signal.targetEventId, 'dislike');
    }
  }

  return {
    kind: 'ui',
    version: 1,
    meta: {
      command: alias,
      subcommand: 'list',
      options: listOptions,
    },
    stylesheets: [fetchCoverageStylesheet, nrListStylesheet],
    selectedTreeTimeRanges: {
      [NR_TIMELINE_TIME_FILTER_GROUP]: selectedTreeTimeRanges,
    },
    tree: keyed(
      `nr:${listData.mode}:root`,
      el('stack', { gap: 'sm' }, [
        listModeSwitch({
          alias,
          mode: listData.mode,
          selectedTimeRanges: listData.selectedTimeRanges,
        }),
        ...(listData.mode !== 'archive'
          ? [
              listFilterPanel({
                alias,
                mode: listData.mode,
                selected: listData.selectedCategories,
                selectedTimeRanges: listData.selectedTimeRanges,
              }),
            ]
          : []),
        {
          type: 'element',
          tag: 'tree',
          renderKey: `nr:${listData.mode}:tree`,
          props: {
            className: 'nr-list-tree',
            gap: 'xs',
            filterable: true,
            filterPlaceholder: 'Filter tags, moods, posts',
            toolbarActions: [
              ...(listData.mode !== 'archive'
                ? [
                    {
                      label: 'Filter kinds',
                      icon: 'checklist' as const,
                      action: {
                        type: 'toggleReveal' as const,
                        targetId: NR_LIST_FILTER_REVEAL_ID,
                      },
                    },
                  ]
                : []),
              {
                label: schedulerResource
                  ? 'Show scheduled job'
                  : 'Schedule fetch',
                icon: 'log',
                action: schedulerAction(alias),
                visibleOnSurfaces: ['timeline', 'modal', 'dock'],
              },
              {
                label: 'Settings',
                icon: 'settings',
                action: settingsAction(alias),
                visibleOnSurfaces: ['timeline', 'modal', 'dock'],
              },
            ],
          },
          children: [
            ...(fetchCoverage
              ? [
                  fetchCoverage.node,
                  fetchProgressStatus(),
                  el('spacer', { size: 'md' }, []),
                ]
              : []),
            ...(listData.mode === 'profile'
              ? listData.profileEvents.length > 0
                ? listData.profileEvents.map((profileEvent) =>
                    profileEventNode({
                      alias,
                      profileEvent,
                      profiles,
                      authorPreferences,
                      sharePrefixes,
                      translationTargetLanguage,
                      mode: 'profile',
                      renderScope: 'profile',
                    }),
                  )
                : [
                    el('text', { tone: 'muted' }, [
                      text('No matching profile events found.'),
                    ]),
                  ]
              : []),
            ...(listData.mode === 'for-you'
              ? [
                  ...groupEventNodes({
                    alias,
                    events: listData.forYouEvents,
                    profiles,
                    interactions: listData.interactions,
                    localPreferences,
                    authorPreferences,
                    sharePrefixes,
                    translationTargetLanguage,
                    rankingScores: listData.forYouScores,
                    archiveSignalReviewMode:
                      listData.settings.archiveSignalReviewMode,
                    likeSignalReviewMode:
                      listData.settings.likeSignalReviewMode,
                    replySignalReviewMode:
                      listData.settings.replySignalReviewMode,
                    repostQuoteSignalReviewMode:
                      listData.settings.repostQuoteSignalReviewMode,
                    mode: 'for-you',
                    renderScope: 'for-you',
                  }),
                  el(
                    'treeEmpty',
                    { className: 'nr-for-you-empty' },
                    listData.forYouHasMore
                      ? [
                          el(
                            'button',
                            {
                              label: 'Load next 25',
                              action: nrListCommandAction({
                                alias,
                                mode: 'for-you',
                                selectedTimeRanges: listData.selectedTimeRanges,
                              }),
                            },
                            [],
                          ),
                        ]
                      : [
                          el('text', { tone: 'muted' }, [
                            text('No unread For You posts found.'),
                          ]),
                        ],
                  ),
                ]
              : []),
            ...(listData.mode === 'profile' || listData.mode === 'for-you'
              ? []
              : [
                  sectionNode({
                    alias,
                    title: 'Topics',
                    type: 'topic',
                    groups: listData.topicGroups,
                    profiles,
                    interactions: listData.interactions,
                    localPreferences,
                    authorPreferences,
                    sharePrefixes,
                    translationTargetLanguage,
                    rankingScores: listData.forYouScores,
                    archiveSignalReviewMode:
                      listData.settings.archiveSignalReviewMode,
                    likeSignalReviewMode:
                      listData.settings.likeSignalReviewMode,
                    replySignalReviewMode:
                      listData.settings.replySignalReviewMode,
                    repostQuoteSignalReviewMode:
                      listData.settings.repostQuoteSignalReviewMode,
                    mode: listData.mode,
                    selectedTimeRanges: listData.selectedTimeRanges,
                  }),
                  sectionNode({
                    alias,
                    title: 'Moods',
                    type: 'mood',
                    groups: listData.moodGroups,
                    profiles,
                    interactions: listData.interactions,
                    localPreferences,
                    authorPreferences,
                    sharePrefixes,
                    translationTargetLanguage,
                    rankingScores: listData.forYouScores,
                    archiveSignalReviewMode:
                      listData.settings.archiveSignalReviewMode,
                    likeSignalReviewMode:
                      listData.settings.likeSignalReviewMode,
                    replySignalReviewMode:
                      listData.settings.replySignalReviewMode,
                    repostQuoteSignalReviewMode:
                      listData.settings.repostQuoteSignalReviewMode,
                    mode: listData.mode,
                    selectedTimeRanges: listData.selectedTimeRanges,
                  }),
                  sectionNode({
                    alias,
                    title: 'Languages',
                    type: 'language',
                    groups: listData.languageGroups,
                    profiles,
                    interactions: listData.interactions,
                    localPreferences,
                    authorPreferences,
                    sharePrefixes,
                    translationTargetLanguage,
                    rankingScores: listData.forYouScores,
                    archiveSignalReviewMode:
                      listData.settings.archiveSignalReviewMode,
                    likeSignalReviewMode:
                      listData.settings.likeSignalReviewMode,
                    replySignalReviewMode:
                      listData.settings.replySignalReviewMode,
                    repostQuoteSignalReviewMode:
                      listData.settings.repostQuoteSignalReviewMode,
                    mode: listData.mode,
                    selectedTimeRanges: listData.selectedTimeRanges,
                  }),
                ]),
          ],
        },
      ]),
    ),
  };
}
