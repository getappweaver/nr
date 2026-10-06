import { nip19 } from 'nostr-tools';

import { TranslationV1 } from '@src/capabilities/translation.v1';
import type { CachedProfile } from '@src/db';
import { parseEventReferences } from '@src/nostr/event-references';
import { nostrShareUrl, type NostrSharePrefixes } from '@src/web/nostr-share';
import type {
  WebNode,
  WebNostrPostExtraAction,
  WebNostrPostReference,
} from '@src/web/ui-schema';

import { extractDirectActivityTargetId } from '../../../activity';
import { parseNostrEventArray } from '../../../nostr-resolution';
import {
  extractAddressReferences,
  extractEventReferences,
  extractProfileReferences,
} from '../../../references';
import { type NrSignalReviewMode } from '../../../settings';
import { extractNip10References } from '../../../thread-context';
import { parseZapReceipt } from '../../../zap';

import {
  NostrEventSchema,
  type NrAuthorPreferenceValue,
  type NrEvent,
  type NrInteraction,
  type NrListMode,
  type NrListTimeRange,
  type NrProfileEvent,
  type NrTagGroup,
  type NostrEvent,
} from '../../shared/types';

import { categoryForNrEvent } from '../categories';
import { nrListCommandOptions } from '../list-options';

import { el, entityKey, keyed, tagGroupEntityKey, text } from './primitives';

export type ListModeNodesProps = {
  alias: string;
  topicGroups: NrTagGroup[];
  moodGroups: NrTagGroup[];
  languageGroups: NrTagGroup[];
  forYouEvents: NrEvent[];
  forYouHasMore: boolean;
  profileEvents: NrProfileEvent[];
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
  resolveReferencesAutomatically: boolean;
  mode: NrListMode;
  selectedTimeRanges: NrListTimeRange[];
  archivedIds: Set<string>;
  evaluatedImageCounts: Record<string, number>;
  followedPubkeys: Set<string>;
  conversationContextEvents: Map<string, NrEvent>;
};

type AuthorPreferenceActionProps = {
  alias: string;
  pubkey: string;
  mode: NrListMode;
  preference: NrAuthorPreferenceValue | null;
};

type AuthorPreferenceCommandActionProps = {
  alias: string;
  pubkey: string;
  mode: NrListMode;
  preference: NrAuthorPreferenceValue | 'none';
};

function authorPreferenceCommandAction({
  alias,
  pubkey,
  mode,
  preference,
}: AuthorPreferenceCommandActionProps) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'author-interest-record',
    arguments: {},
    options: { pubkey, preference },
    recordInTimeline: false,
    pendingUi: { presentation: 'entity' as const, label: 'Updating...' },
    refresh: {
      command: alias,
      subcommand: 'list',
      arguments: {},
      options: { mode },
      recordInTimeline: false,
      target: 'taskbar' as const,
    },
  };
}

export function authorPreferenceActions({
  alias,
  pubkey,
  mode,
  preference,
}: AuthorPreferenceActionProps): WebNostrPostExtraAction[] {
  return [
    {
      optimisticKey: 'author-like',
      label: preference === 'like' ? 'clear 👍' : '👍 author',
      inactiveLabel: '👍 author',
      activeLabel: 'clear 👍',
      ariaLabel:
        preference === 'like'
          ? 'Remove positive author preference'
          : 'Show more posts from this author',
      action: authorPreferenceCommandAction({
        alias,
        pubkey,
        mode,
        preference: preference === 'like' ? 'none' : 'like',
      }),
      disabled: false,
      active: preference === 'like',
    },
    {
      optimisticKey: 'author-dislike',
      label: preference === 'dislike' ? 'clear 👎' : '👎 author',
      inactiveLabel: '👎 author',
      activeLabel: 'clear 👎',
      ariaLabel:
        preference === 'dislike'
          ? 'Remove negative author preference'
          : 'Show fewer posts from this author',
      action: authorPreferenceCommandAction({
        alias,
        pubkey,
        mode,
        preference: preference === 'dislike' ? 'none' : 'dislike',
      }),
      disabled: false,
      active: preference === 'dislike',
    },
  ];
}

export function authorPreferenceActionsReadAction({
  alias,
  pubkey,
  mode,
}: Omit<AuthorPreferenceActionProps, 'preference'>) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'author-interest-actions',
    arguments: {},
    options: { pubkey, mode },
    recordInTimeline: false,
    pendingUi: { presentation: 'none' as const },
  };
}

type InteractionFlags = {
  liked: boolean;
  replied: boolean;
  reposted: boolean;
  quoted: boolean;
};

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
    allowReadPost: actionCategory === 'repost_quote',
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
    allowReadPost: actionCategory === 'repost_quote',
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

type EventSignalMetadataProps = {
  event: NrEvent;
  score: number | null;
  alias: string;
  evaluatedImageCount: number;
};

function eventSignalMetadata({
  event,
  score,
  alias,
  evaluatedImageCount,
}: EventSignalMetadataProps): WebNode {
  const topics = event.topics.length > 0 ? event.topics.join(', ') : '(none)';
  const moods = event.moods.length > 0 ? event.moods.join(', ') : '(none)';
  const scoreText = score === null ? '' : ` . Score: ${score.toFixed(2)}`;
  const value = `Topics: ${topics} . Moods: ${moods}${scoreText}`;

  if (evaluatedImageCount <= 0) {
    return el(
      'text',
      { className: 'nr-for-you-metadata', size: 'sm', tone: 'muted' },
      [text(value)],
    );
  }

  return el('row', { gap: 'xs', itemAlign: 'center' }, [
    el(
      'text',
      { className: 'nr-for-you-metadata', size: 'sm', tone: 'muted' },
      [text(value)],
    ),
    el(
      'button',
      {
        label: `🖼 ${evaluatedImageCount} evaluated`,
        ariaLabel: 'Show evaluated image descriptions',
        title: 'Show evaluated image descriptions',
        action: {
          type: 'command',
          command: alias,
          subcommand: 'images',
          arguments: { event_id: event.id },
          options: {},
          surface: 'modal',
          modalTitle: 'Image evaluations',
          recordInTimeline: false,
        },
      },
      [],
    ),
  ]);
}

function summaryNodes(summary: string | null | undefined): WebNode[] {
  const value = summary?.trim() ?? '';

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
  eventIds?: string[];
  entityEventId?: string;
  entityEventIds?: string[];
  state: 'read' | 'unread' | 'archived' | 'unarchived';
  mode: NrListMode | null;
};

function markAction({
  alias,
  eventId,
  eventIds = [eventId],
  entityEventId = eventId,
  entityEventIds,
  state,
  mode,
}: MarkActionProps) {
  if (state === 'archived' || state === 'unarchived') {
    return commandSequenceAction({
      commands: [
        {
          command: alias,
          subcommand: 'mark',
          arguments: { event_id: eventId },
          options: { [state]: true },
        },
      ],
      refreshCommand: archiveListRefresh({ alias, mode }),
      successMutations: archivedFlip({
        eventId,
        archived: state === 'archived',
      }),
    });
  }

  const allEntityIds = [
    ...new Set([entityEventId, ...(entityEventIds ?? []), ...eventIds]),
  ];

  return optimisticCommandAction({
    mutations: allEntityIds.map((id) => ({
      type: 'removeEntity' as const,
      entityKey: entityKey(id),
      pruneEmptyParents: true,
    })),
    command: {
      command: alias,
      subcommand: 'mark',
      arguments: { event_id: eventId },
      options: {
        [state]: true,
        ...(eventIds.length > 1 ? { event_ids: eventIds.join(',') } : {}),
      },
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
  eventIds?: string[];
  entityEventId?: string;
  entityEventIds?: string[];
  mode: NrListMode | null;
};

function readAction({
  alias,
  eventId,
  eventIds,
  entityEventId,
  entityEventIds,
  mode,
}: ReadActionProps) {
  return markAction({
    alias,
    eventId,
    eventIds,
    entityEventId,
    entityEventIds,
    state: 'read',
    mode,
  });
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

type CommandSequenceActionProps = {
  commands: Array<Record<string, unknown>>;
  refreshCommand: Record<string, unknown> | null;
  successMutations: Array<Record<string, unknown>>;
};

function commandSequenceAction({
  commands,
  refreshCommand,
  successMutations,
}: CommandSequenceActionProps) {
  return {
    type: 'clientAction' as const,
    action: 'web.commandSequence',
    payload: {
      commands,
      mergeFormOptionsIntoCommand: null,
      refreshCommand,
      successMutations,
    },
  };
}

type ArchiveListRefreshProps = {
  alias: string;
  mode: NrListMode | null;
};

function archiveListRefresh({ alias, mode }: ArchiveListRefreshProps) {
  return {
    command: alias,
    subcommand: 'list',
    arguments: {},
    options: { mode: mode ?? 'timeline' },
    recordInTimeline: false,
  };
}

type ArchivedFlipProps = {
  eventId: string;
  archived: boolean;
};

function archivedFlip({ eventId, archived }: ArchivedFlipProps) {
  return [
    {
      type: 'patchEntityProps',
      entityKey: entityKey(eventId),
      props: { nostrArchived: archived },
    },
  ];
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
    return commandSequenceAction({
      commands: [markCommand],
      refreshCommand: archiveListRefresh({ alias, mode }),
      successMutations: archivedFlip({ eventId: event.id, archived: true }),
    });
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
    refreshCommand: archiveListRefresh({ alias, mode }),
    successMutations: archivedFlip({ eventId: event.id, archived: true }),
  });
}

type MarkRawEventActionProps = {
  alias: string;
  event: NostrEvent;
  state: 'read' | 'archived' | 'unarchived';
  mode: NrListMode;
  additionalEventIds?: string[];
};

function markRawEventAction({
  alias,
  event,
  state,
  mode,
  additionalEventIds,
}: MarkRawEventActionProps) {
  if (state === 'archived' || state === 'unarchived') {
    return commandSequenceAction({
      commands: [
        {
          command: alias,
          subcommand: 'mark',
          arguments: { event_id: event.id },
          options: { [state]: true, event_json: JSON.stringify(event) },
        },
      ],
      refreshCommand: archiveListRefresh({ alias, mode }),
      successMutations: archivedFlip({
        eventId: event.id,
        archived: state === 'archived',
      }),
    });
  }

  const allEntityIds = [...new Set([event.id, ...(additionalEventIds ?? [])])];

  return optimisticCommandAction({
    mutations: allEntityIds.map((id) => ({
      type: 'removeEntity' as const,
      entityKey: entityKey(id),
      pruneEmptyParents: true,
    })),
    command: {
      command: alias,
      subcommand: 'mark',
      arguments: { event_id: event.id },
      options: {
        [state]: true,
        event_json: JSON.stringify(event),
        ...(additionalEventIds && additionalEventIds.length > 0
          ? { event_ids: [event.id, ...additionalEventIds].join(',') }
          : {}),
      },
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
    ...optimisticCommandAction({
      mutations: [
        {
          type: 'removeEntity',
          entityKey: tagGroupEntityKey(type, tag),
          pruneEmptyParents: true,
        },
      ],
      command: {
        command: alias,
        subcommand: 'mark',
        arguments: {},
        options: { type, tag, read: true },
      },
    }),
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
  readActionOverride?: ReturnType<typeof readAction>,
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
          action:
            readActionOverride ??
            readAction({
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
  readActionOverride,
}: {
  alias: string;
  event: NostrEvent;
  archived: boolean;
  mode: NrListMode;
  sharePrefixes: NostrSharePrefixes;
  readActionOverride?: ReturnType<typeof readAction>;
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
          action:
            readActionOverride ??
            markRawEventAction({ alias, event, state: 'read', mode }),
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
      href:
        reference.kind === 30023
          ? undefined
          : `https://jumble.social/notes/${reference.naddr}`,
      label:
        reference.kind === 30023
          ? undefined
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
  relatedEvents,
  profiles,
  interactions,
  translationTargetLanguage,
  sharePrefixes,
  mode,
}: {
  alias: string;
  event: NrEvent | NostrEvent;
  relatedEvents?: NostrEvent[];
  profiles: Map<string, CachedProfile>;
  interactions: NrInteraction[];
  translationTargetLanguage: string;
  sharePrefixes: NostrSharePrefixes;
  mode: NrListMode;
}) {
  const eventsById = new Map(
    ('raw_json' in event
      ? [...threadContextEvents(event), ...referencedEvents(event)]
      : (relatedEvents ?? [])
    ).map((referencedEvent) => [referencedEvent.id, referencedEvent]),
  );

  const embeds: Record<string, WebNostrPostReference> = {};

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
  sharePrefixes: NostrSharePrefixes;
};

function unresolvedReplyReference({
  alias,
  id,
  relay,
  mode,
  sharePrefixes,
}: UnresolvedReplyReferenceProps): WebNostrPostReference {
  return {
    entityKey: entityKey(id),
    type: 'event',
    id,
    relayHints: relay ? [relay] : [],
    sharePrefixes,
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
        sharePrefixes,
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
      source: eventSource(contextEvent),
      readAction:
        'read_at' in contextEvent &&
        (contextEvent as { read_at?: unknown }).read_at !== null
          ? undefined
          : markRawEventAction({
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

function eventSource(event: NostrEvent): string | undefined {
  const source = event.tags.find((tag) => tag[0] === 'r')?.[1]?.trim();

  if (source) {
    return source;
  }

  const address = event.tags.find((tag) => tag[0] === 'a');
  const [kindText, pubkey, identifier] = address?.[1]?.split(':') ?? [];
  const kind = Number.parseInt(kindText ?? '', 10);

  if (Number.isSafeInteger(kind) && pubkey && identifier !== undefined) {
    try {
      return `nostr:${nip19.naddrEncode({
        kind,
        pubkey,
        identifier,
        relays: address?.[2] ? [address[2]] : [],
      })}`;
    } catch {
      // Fall through to an exact event source.
    }
  }

  const eventTag = event.tags.find((tag) => tag[0] === 'e');

  if (!eventTag?.[1]) {
    return undefined;
  }

  try {
    return `nostr:${nip19.neventEncode({
      id: eventTag[1],
      relays: eventTag[2] ? [eventTag[2]] : [],
      author: event.tags.find((tag) => tag[0] === 'p')?.[1],
    })}`;
  } catch {
    return undefined;
  }
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
  resolveReferencesAutomatically: boolean;
  mode: NrListMode;
  renderScope: string;
  archivedIds: Set<string>;
  evaluatedImageCounts: Record<string, number>;
  readEventIds?: string[];
  readActionEventId?: string;
  conversationActivities?: NrEvent[];
  conversationReplies?: WebNostrPostReference[];
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
  resolveReferencesAutomatically,
  mode,
  renderScope,
  archivedIds,
  evaluatedImageCounts,
  readEventIds,
  readActionEventId,
  conversationActivities = [],
  conversationReplies = [],
}: EventNodeProps): WebNode {
  if (isActivityEvent(event)) {
    return activityEventNode({
      alias,
      event,
      profiles,
      authorPreferences,
      sharePrefixes,
      translationTargetLanguage,
      mode,
      renderScope,
      archivedIds,
    });
  }

  const eventInteractions = interactions ?? [];
  const nevent = neventForEvent(event);
  const post = postViewFromNrEvent({ event, profiles });
  const flags = interactionFlags(eventInteractions, event.id);

  const conversationActivityHeaders = activityHeadersFor({
    alias,
    activities: conversationActivities,
    profiles,
    mode,
  });

  const filterText = eventFilterText({ event, profiles });

  const allEventIds = [
    ...new Set([
      ...(readEventIds ?? [readActionEventId ?? event.id]),
      ...conversationActivities.map((activity) => activity.id),
    ]),
  ];

  const postReadAction = readAction({
    alias,
    eventId: readActionEventId ?? event.id,
    eventIds: allEventIds,
    entityEventId: event.id,
    entityEventIds: conversationActivities.map((activity) => activity.id),
    mode,
  });

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
          postReadAction,
        ),
      ),
      el('stack', { gap: 'xs', fill: true }, [
        eventSignalMetadata({
          event,
          score: rankingScore,
          alias,
          evaluatedImageCount: evaluatedImageCounts[event.id] ?? 0,
        }),
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
              nostrKind: event.kind,
              nostrContent: post.content,
              nostrSource: eventSource(
                JSON.parse(event.raw_json) as NostrEvent,
              ),
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
              ...(conversationActivityHeaders.length > 0
                ? { nostrActivityHeaders: conversationActivityHeaders }
                : {}),
              ...(conversationReplies.length > 0
                ? {
                    nostrConversationReplies: conversationReplies,
                  }
                : {}),
              nostrReadAction: postReadAction,
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
              nostrProfileResolveReferencesAutomatically:
                resolveReferencesAutomatically,
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
  resolveReferencesAutomatically: boolean;
  mode: NrListMode;
  selectedTimeRanges: NrListTimeRange[];
  archivedIds: Set<string>;
  evaluatedImageCounts: Record<string, number>;
  followedPubkeys: Set<string>;
  conversationContextEvents: Map<string, NrEvent>;
};

function activityTarget(event: NrEvent): NostrEvent | null {
  let directTargetId: string | null = null;
  try {
    const raw = JSON.parse(event.raw_json) as NostrEvent;
    directTargetId = extractDirectActivityTargetId(raw);
  } catch {
    // ignore
  }

  const context = [...threadContextEvents(event), ...referencedEvents(event)];

  if (directTargetId) {
    const matched = context.find((item) => item.id === directTargetId);

    if (matched) {
      return matched;
    }
  }

  if (event.kind === 6) {
    try {
      const parsed = NostrEventSchema.safeParse(JSON.parse(event.content));

      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  return context[0] ?? null;
}

function isActivityEvent(event: Pick<NostrEvent, 'kind'>): boolean {
  return (
    event.kind === 6 ||
    event.kind === 7 ||
    event.kind === 16 ||
    event.kind === 9735
  );
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
  archivedIds,
  evaluatedImageCounts,
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
  archivedIds: Set<string>;
  evaluatedImageCounts: Record<string, number>;
}): WebNode {
  const archived =
    archivedIds.has(target.id) ||
    (targetEvent?.archived_at ?? null) !== null ||
    activities.some((activity) => activity.archived_at !== null);

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
          sharePrefixes,
        });
  });

  const headers = activities.flatMap((activity) => {
    try {
      const event = JSON.parse(activity.raw_json) as NostrEvent;

      if (event.kind === 6 || event.kind === 16) {
        return [
          activityHeaderFor({
            alias,
            label: 'Reposted',
            event,
            profiles,
            mode,
          }),
        ];
      }

      if (event.kind === 7) {
        return [
          activityHeaderFor({
            alias,
            label: `Reacted ${event.content || '+'}`,
            event,
            profiles,
            mode,
          }),
        ];
      }

      if (event.kind === 9735) {
        const zap = parseZapReceipt(event);

        const label =
          zap.amountSats > 0
            ? `Zapped ⚡ ${zap.amountSats.toLocaleString()} sats`
            : 'Zapped ⚡';

        return [
          activityHeaderFor({
            alias,
            label,
            event,
            profiles,
            mode,
            actorPubkeyOverride: zap.zapperPubkey,
            comment: zap.comment ?? undefined,
          }),
        ];
      }

      return [];
    } catch {
      return [];
    }
  });

  const activityReadAction = readAction({
    alias,
    eventId: target.id,
    eventIds: [target.id, ...activities.map((activity) => activity.id)],
    entityEventId: target.id,
    entityEventIds: activities.map((activity) => activity.id),
    mode,
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
          readActionOverride: activityReadAction,
        }),
      ),
      el('stack', { fill: true }, [
        ...(rankingEvent
          ? [
              eventSignalMetadata({
                event: rankingEvent,
                score: rankingScore,
                alias,
                evaluatedImageCount: evaluatedImageCounts[rankingEvent.id] ?? 0,
              }),
            ]
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
          readActionOverride: activityReadAction,
        }),
      ]),
    ]),
    children: [],
  } as WebNode;
}

const CONVERSATION_SLOT_SECONDS = 60 * 60;

type ConversationGroup = {
  key: string;
  slot: number;
  main: NostrEvent;
  mainStored: NrEvent | null;
  replies: NrEvent[];
  activities: NrEvent[];
};

function activityHeadersFor({
  alias,
  activities,
  profiles,
  mode,
}: {
  alias: string;
  activities: NrEvent[];
  profiles: Map<string, CachedProfile>;
  mode: NrListMode;
}) {
  return activities.flatMap((activity) => {
    const event = rawNrEvent(activity);

    if (!event) {
      return [];
    }

    if (event.kind === 6 || event.kind === 16) {
      return [
        activityHeaderFor({ alias, label: 'Reposted', event, profiles, mode }),
      ];
    }

    if (event.kind === 7) {
      return [
        activityHeaderFor({
          alias,
          label: `Reacted ${event.content || '+'}`,
          event,
          profiles,
          mode,
        }),
      ];
    }

    if (event.kind === 9735) {
      const zap = parseZapReceipt(event);

      const label =
        zap.amountSats > 0
          ? `Zapped ⚡ ${zap.amountSats.toLocaleString()} sats`
          : 'Zapped ⚡';

      return [
        activityHeaderFor({
          alias,
          label,
          event,
          profiles,
          mode,
          actorPubkeyOverride: zap.zapperPubkey,
          comment: zap.comment ?? undefined,
        }),
      ];
    }

    return [];
  });
}

function rawNrEvent(event: NrEvent): NostrEvent | null {
  try {
    const parsed = NostrEventSchema.safeParse(JSON.parse(event.raw_json));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function nostrAddressKey(event: NostrEvent): string | null {
  if (
    event.kind !== 0 &&
    event.kind !== 3 &&
    !(event.kind >= 10_000 && event.kind < 20_000) &&
    !(event.kind >= 30_000 && event.kind < 40_000)
  ) {
    return null;
  }

  const identifier =
    event.kind >= 30_000 && event.kind < 40_000
      ? (event.tags.find((tag) => tag[0] === 'd')?.[1] ?? '')
      : '';

  return `${event.kind}:${event.pubkey}:${identifier}`;
}

function conversationMainEvent({
  event,
  eventsById,
  conversationEvents,
}: {
  event: NrEvent;
  eventsById: Map<string, NrEvent>;
  conversationEvents: Map<string, NrEvent>;
}): NostrEvent | null {
  const rawEvent = rawNrEvent(event);

  if (!rawEvent) {
    return null;
  }

  const category = categoryForNrEvent(rawEvent);

  if (category !== 'replies' && category !== 'comments') {
    return null;
  }

  const related = new Map<string, NostrEvent>();

  for (const stored of [
    ...eventsById.values(),
    ...conversationEvents.values(),
  ]) {
    const raw = rawNrEvent(stored);

    if (raw) {
      related.set(raw.id, raw);
    }
  }

  for (const raw of [
    ...threadContextEvents(event),
    ...referencedEvents(event),
  ]) {
    related.set(raw.id, raw);
  }

  const edges = parseEventReferences(rawEvent).filter(
    (edge) => edge.role === 'thread-root' || edge.role === 'thread-parent',
  );

  edges.sort((left, right) =>
    left.role === right.role ? 0 : left.role === 'thread-root' ? -1 : 1,
  );

  for (const edge of edges) {
    if (edge.target.type === 'event') {
      const target = related.get(edge.target.eventId);

      if (target) {
        return target;
      }

      continue;
    }

    const targetKey = `${edge.target.kind}:${edge.target.pubkey}:${edge.target.identifier}`;

    const target = [...related.values()].find(
      (candidate) => nostrAddressKey(candidate) === targetKey,
    );

    if (target) {
      return target;
    }
  }

  return null;
}

function conversationReplyReference({
  alias,
  reply,
  profiles,
  interactions,
  localPreferences,
  authorPreferences,
  sharePrefixes,
  translationTargetLanguage,
  mode,
  archivedIds,
}: {
  alias: string;
  reply: NrEvent;
  profiles: Map<string, CachedProfile>;
  interactions: NrInteraction[];
  localPreferences: Map<string, 'like' | 'dislike'>;
  authorPreferences: Map<string, NrAuthorPreferenceValue>;
  sharePrefixes: NostrSharePrefixes;
  translationTargetLanguage: string;
  mode: NrListMode;
  archivedIds: Set<string>;
}): WebNostrPostReference | null {
  const event = rawNrEvent(reply);

  if (!event) {
    return null;
  }

  const profile = profileForPubkey({ profiles, pubkey: event.pubkey });
  const archived = archivedIds.has(reply.id);
  const flags = interactionFlags(interactions, reply.id);

  const reference = profileReferenceWithEmbeds({
    alias,
    event,
    profiles,
    relatedEvents: new Map(
      [...threadContextEvents(reply), ...referencedEvents(reply)].map(
        (related) => [related.id, related],
      ),
    ),
    translationTargetLanguage,
    sharePrefixes,
    mode,
  });

  return {
    ...reference,
    readAction: null,
    archiveAction: markRawEventAction({
      alias,
      event,
      state: archived ? 'unarchived' : 'archived',
      mode,
    }),
    archived,
    liked: flags.liked,
    replied: flags.replied,
    reposted: flags.reposted,
    quoted: flags.quoted,
    trailingActions: [
      ...(reference.trailingActions ?? []),
      ...localPreferenceActions({
        alias,
        eventId: reply.id,
        mode,
        preference: localPreferences.get(reply.id) ?? null,
        targetAuthorPubkey: reply.pubkey,
        targetAuthorLabel: signalReviewAuthorLabel(profile, reply.pubkey),
        candidateTopics: signalReviewTopics(reply),
      }),
    ],
    profileActions: authorPreferenceActions({
      alias,
      pubkey: reply.pubkey,
      mode,
      preference: authorPreferences.get(reply.pubkey.toLowerCase()) ?? null,
    }),
    profileActionsReadAction: authorPreferenceActionsReadAction({
      alias,
      pubkey: reply.pubkey,
      mode,
    }),
  };
}

function conversationParentPlaceholder({
  reply,
  mainEventId,
  visibleReplyIds,
  sharePrefixes,
}: {
  reply: NrEvent;
  mainEventId: string;
  visibleReplyIds: Set<string>;
  sharePrefixes: NostrSharePrefixes;
}): WebNostrPostReference | null {
  const event = rawNrEvent(reply);

  if (!event) {
    return null;
  }

  const parentEdge = parseEventReferences(event).find(
    (edge) => edge.role === 'thread-parent',
  );

  if (!parentEdge) {
    return null;
  }

  if (parentEdge.target.type === 'address') {
    const address = `${parentEdge.target.kind}:${parentEdge.target.pubkey}:${parentEdge.target.identifier}`;

    if (address === mainEventId || visibleReplyIds.has(address)) {
      return null;
    }

    return {
      entityKey: entityKey(address),
      type: 'address',
      id: address,
      pubkey: parentEdge.target.pubkey,
      relayHints: parentEdge.relayHints,
      sharePrefixes,
      resolutionStatus: 'unresolved',
      resolveOnLoad: false,
      showActions: false,
    };
  }

  const parentId = parentEdge.target.eventId;

  if (parentId === mainEventId || visibleReplyIds.has(parentId)) {
    return null;
  }

  const relatedParent = [
    ...threadContextEvents(reply),
    ...referencedEvents(reply),
  ].find((candidate) => candidate.id === parentId);

  let token: string | undefined;

  try {
    token = `nostr:${nip19.neventEncode({
      id: parentId,
      relays: parentEdge.relayHints,
      author:
        relatedParent?.pubkey ?? parentEdge.target.authorPubkey ?? undefined,
      kind: relatedParent?.kind,
    })}`;
  } catch {
    token = undefined;
  }

  return {
    entityKey: entityKey(parentId),
    token,
    type: 'event',
    id: parentId,
    pubkey:
      relatedParent?.pubkey ?? parentEdge.target.authorPubkey ?? undefined,
    kind: relatedParent?.kind,
    relayHints: parentEdge.relayHints,
    sharePrefixes,
    resolutionStatus: 'unresolved',
    resolveOnLoad: false,
    showActions: false,
  };
}

function conversationGroupNode({
  conversation,
  alias,
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
  resolveReferencesAutomatically,
  mode,
  renderScope,
  archivedIds,
  evaluatedImageCounts,
}: {
  conversation: ConversationGroup;
  alias: string;
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
  resolveReferencesAutomatically: boolean;
  mode: NrListMode;
  renderScope: string;
  archivedIds: Set<string>;
  evaluatedImageCounts: Record<string, number>;
}): WebNode {
  const replies = [...conversation.replies].sort(
    (left, right) => left.event_created_at - right.event_created_at,
  );

  const mainIsInSlot =
    conversation.mainStored !== null &&
    conversation.mainStored.read_at === null &&
    Math.floor(
      conversation.mainStored.event_created_at / CONVERSATION_SLOT_SECONDS,
    ) === conversation.slot;

  const readEventIds = [
    ...(mainIsInSlot && conversation.mainStored
      ? [conversation.mainStored.id]
      : []),
    ...replies.map((reply) => reply.id),
    ...conversation.activities.map((activity) => activity.id),
  ];

  const readActionEventId = readEventIds[0]!;
  const childScope = `${renderScope}:conversation:${conversation.key}`;

  const visibleReplyIds = new Set(replies.map((reply) => reply.id));
  const renderedParentIds = new Set<string>();

  const conversationReplies = replies.flatMap((reply) => {
    const parent = conversationParentPlaceholder({
      reply,
      mainEventId: conversation.main.id,
      visibleReplyIds,
      sharePrefixes,
    });

    const reference = conversationReplyReference({
      alias,
      reply,
      profiles,
      interactions,
      localPreferences,
      authorPreferences,
      sharePrefixes,
      translationTargetLanguage,
      mode,
      archivedIds,
    });

    const parentReferences =
      parent?.id && !renderedParentIds.has(parent.id) ? [parent] : [];

    if (parent?.id) {
      renderedParentIds.add(parent.id);
    }

    return [...parentReferences, ...(reference ? [reference] : [])];
  });

  const mainRelatedEvents = [
    ...new Map(
      replies
        .flatMap((reply) => [
          ...threadContextEvents(reply),
          ...referencedEvents(reply),
        ])
        .map((event) => [event.id, event]),
    ).values(),
  ];

  if (conversation.mainStored) {
    const node = eventNode({
      alias,
      event: conversation.mainStored,
      profiles,
      showReplyContext: false,
      interactions,
      localPreferences,
      authorPreferences,
      sharePrefixes,
      translationTargetLanguage,
      rankingScore: rankingScores[conversation.mainStored.id] ?? null,
      archiveSignalReviewMode,
      likeSignalReviewMode,
      replySignalReviewMode,
      repostQuoteSignalReviewMode,
      resolveReferencesAutomatically,
      mode,
      renderScope: childScope,
      archivedIds,
      evaluatedImageCounts,
      readEventIds,
      readActionEventId,
      conversationActivities: conversation.activities,
      conversationReplies,
    });

    if (node.type === 'element' && node.tag === 'treeItem') {
      return {
        ...node,
        renderKey: `nr:${childScope}:main:${conversation.main.id}`,
        props: {
          ...node.props,
          filterTimestamps: replies.map((reply) => reply.event_created_at),
        },
        children: [],
      };
    }
  }

  const conversationReadAction = readAction({
    alias,
    eventId: readActionEventId,
    eventIds: readEventIds,
    entityEventId: conversation.main.id,
    mode,
  });

  return {
    type: 'element',
    tag: 'treeItem',
    renderKey: `nr:${childScope}:main:${conversation.main.id}`,
    props: {
      id: `nr-conversation-${conversation.main.id}-${conversation.slot}`,
      entityKey: entityKey(conversation.main.id),
      className: `nr-list-event nr-conversation${mode === 'for-you' ? ' nr-for-you-event' : ''}`,
      defaultExpanded: false,
      filterTimestamps: replies.map((reply) => reply.event_created_at),
    },
    summary: el('row', { gap: 'xs', align: 'between', itemAlign: 'start' }, [
      keyed(
        `nr:${childScope}:main:${conversation.main.id}:menu`,
        referencedEventActionsMenu({
          alias,
          event: conversation.main,
          archived: archivedIds.has(conversation.main.id),
          mode,
          sharePrefixes,
          readActionOverride: conversationReadAction,
        }),
      ),
      el('stack', { fill: true }, [
        profilePostNode({
          alias,
          event: conversation.main,
          profiles,
          replyContext: [],
          embeds: nostrEmbeds({
            alias,
            event: conversation.main,
            relatedEvents: mainRelatedEvents,
            profiles,
            interactions,
            translationTargetLanguage,
            sharePrefixes,
            mode,
          }),
          activityHeaders: activityHeadersFor({
            alias,
            activities: conversation.activities,
            profiles,
            mode,
          }),
          archived: archivedIds.has(conversation.main.id),
          localPreference: undefined,
          authorPreference:
            authorPreferences.get(conversation.main.pubkey.toLowerCase()) ??
            null,
          sharePrefixes,
          translationTargetLanguage,
          mode,
          renderScope: `${childScope}:main`,
          signalCandidateTopics: [],
          readActionOverride: conversationReadAction,
          conversationReplies,
        }),
      ]),
    ]),
    children: [],
  } as WebNode;
}

export function groupEventNodes({
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
  resolveReferencesAutomatically,
  mode,
  renderScope,
  archivedIds,
  evaluatedImageCounts,
  followedPubkeys,
  conversationContextEvents,
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
  resolveReferencesAutomatically: boolean;
  mode: NrListMode;
  renderScope: string;
  archivedIds: Set<string>;
  evaluatedImageCounts: Record<string, number>;
  followedPubkeys: Set<string>;
  conversationContextEvents: Map<string, NrEvent>;
}): WebNode[] {
  const eventsById = new Map(events.map((event) => [event.id, event]));

  const normalizedFollowedPubkeys = new Set(
    [...followedPubkeys].map((pubkey) => pubkey.toLowerCase()),
  );

  const conversations = new Map<string, ConversationGroup>();
  const conversationKeyByMember = new Map<string, string>();

  if (mode !== 'archive') {
    for (const event of events) {
      const main = conversationMainEvent({
        event,
        eventsById,
        conversationEvents: conversationContextEvents,
      });

      if (
        !main ||
        !normalizedFollowedPubkeys.has(event.pubkey.toLowerCase()) ||
        !normalizedFollowedPubkeys.has(main.pubkey.toLowerCase())
      ) {
        continue;
      }

      const slot =
        Math.floor(event.event_created_at / CONVERSATION_SLOT_SECONDS) *
        CONVERSATION_SLOT_SECONDS;

      const key = `${main.id}:${slot}`;
      const existing = conversations.get(key);

      if (existing) {
        existing.replies.push(event);
      } else {
        conversations.set(key, {
          key,
          slot,
          main,
          mainStored:
            eventsById.get(main.id) ??
            conversationContextEvents.get(main.id) ??
            null,
          replies: [event],
          activities: [],
        });
      }

      conversationKeyByMember.set(event.id, key);

      const mainEvent = eventsById.get(main.id);

      if (
        mainEvent &&
        Math.floor(mainEvent.event_created_at / CONVERSATION_SLOT_SECONDS) *
          CONVERSATION_SLOT_SECONDS ===
          slot
      ) {
        conversationKeyByMember.set(main.id, key);
      }
    }
  }

  const activitiesByTarget = new Map<
    string,
    { target: NostrEvent; activities: NrEvent[] }
  >();

  for (const event of events) {
    if (!isActivityEvent(event)) {
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

    const slot =
      Math.floor(event.event_created_at / CONVERSATION_SLOT_SECONDS) *
      CONVERSATION_SLOT_SECONDS;

    const conversationKey = `${target.id}:${slot}`;
    const conversation = conversations.get(conversationKey);

    if (
      conversation &&
      normalizedFollowedPubkeys.has(event.pubkey.toLowerCase())
    ) {
      conversation.activities.push(event);
      conversationKeyByMember.set(event.id, conversationKey);
    }
  }

  const renderedTargets = new Set<string>();
  const renderedConversations = new Set<string>();

  const conversationMainIds = new Set(
    [...conversations.values()].map((conversation) => conversation.main.id),
  );

  const nodes: WebNode[] = [];

  for (const event of events) {
    const conversationKey = conversationKeyByMember.get(event.id);

    const conversation = conversationKey
      ? conversations.get(conversationKey)
      : null;

    if (conversation) {
      if (!renderedConversations.has(conversation.key)) {
        renderedConversations.add(conversation.key);
        renderedTargets.add(conversation.main.id);

        for (const reply of conversation.replies) {
          renderedTargets.add(reply.id);
        }

        nodes.push(
          conversationGroupNode({
            conversation,
            alias,
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
            resolveReferencesAutomatically,
            mode,
            renderScope,
            archivedIds,
            evaluatedImageCounts,
          }),
        );
      }

      continue;
    }

    if (isActivityEvent(event)) {
      const target = activityTarget(event);

      if (target && conversationMainIds.has(target.id)) {
        continue;
      }

      if (target && !renderedTargets.has(target.id)) {
        const aggregate = activitiesByTarget.get(target.id);

        if (aggregate) {
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
              archivedIds,
              evaluatedImageCounts,
            }),
          );

          continue;
        }
      }

      if (target) {
        continue;
      }

      // Orphan activity (target unresolvable, e.g. id-only stubs): render
      // standalone below instead of silently dropping the cached event.
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
          archivedIds,
          evaluatedImageCounts,
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
          resolveReferencesAutomatically,
          mode,
          renderScope,
          archivedIds,
          evaluatedImageCounts,
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
  resolveReferencesAutomatically,
  mode,
  selectedTimeRanges,
  archivedIds,
  evaluatedImageCounts,
  followedPubkeys,
  conversationContextEvents,
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
      resolveReferencesAutomatically,
      mode,
      renderScope: `${group.type}:${encodeURIComponent(group.tag)}`,
      archivedIds,
      evaluatedImageCounts,
      followedPubkeys,
      conversationContextEvents,
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
  resolveReferencesAutomatically: boolean;
  mode: NrListMode;
  selectedTimeRanges: NrListTimeRange[];
  archivedIds: Set<string>;
  evaluatedImageCounts: Record<string, number>;
  followedPubkeys: Set<string>;
  conversationContextEvents: Map<string, NrEvent>;
};

export function sectionNode({
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
  resolveReferencesAutomatically,
  mode,
  selectedTimeRanges,
  archivedIds,
  evaluatedImageCounts,
  followedPubkeys,
  conversationContextEvents,
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
              resolveReferencesAutomatically,
              mode,
              selectedTimeRanges,
              archivedIds,
              evaluatedImageCounts,
              followedPubkeys,
              conversationContextEvents,
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
  readActionOverride,
  conversationReplies = [],
}: {
  alias: string;
  event: NostrEvent;
  profiles: Map<string, CachedProfile>;
  replyContext: WebNostrPostReference[];
  embeds: Record<string, WebNostrPostReference>;
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
  readActionOverride?: ReturnType<typeof readAction>;
  conversationReplies?: WebNostrPostReference[];
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
        nostrKind: event.kind,
        nostrContent: event.content,
        nostrSource: eventSource(event),
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
        ...(conversationReplies.length > 0
          ? {
              nostrConversationReplies: conversationReplies,
            }
          : {}),
        ...(readActionOverride
          ? { nostrReadAction: readActionOverride }
          : activityHeaders.length > 0
            ? {
                nostrReadAction: markRawEventAction({
                  alias,
                  event,
                  state: 'read',
                  mode,
                }),
              }
            : {}),
        ...(activityHeaders.length > 0
          ? {
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
  actorPubkeyOverride,
  comment,
}: {
  alias: string;
  label: string;
  event: NostrEvent;
  profiles: Map<string, CachedProfile>;
  mode: NrListMode;
  actorPubkeyOverride?: string;
  comment?: string;
}) {
  const actorPubkey = actorPubkeyOverride ?? event.pubkey;
  const profile = profileForPubkey({ profiles, pubkey: actorPubkey });

  return {
    label,
    actorPubkey,
    actorNpub: npubForPubkey(actorPubkey),
    actorName: profile?.displayName ?? undefined,
    actorUsername: profile?.name ?? undefined,
    actorPicture: profile?.picture ?? undefined,
    actorAbout: profile?.about ?? undefined,
    createdAt: event.created_at,
    comment: comment || undefined,
    profileActions: authorPreferenceActions({
      alias,
      pubkey: actorPubkey,
      mode,
      preference: null,
    }),
    profileActionsReadAction: authorPreferenceActionsReadAction({
      alias,
      pubkey: actorPubkey,
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
    source: eventSource(event),
    readAction: markRawEventAction({
      alias,
      event,
      state: 'read',
      mode,
    }),
    archiveAction: markRawEventAction({
      alias,
      event,
      state: 'archived',
      mode,
    }),
    archived: false,
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

export function profileEventNode({
  alias,
  profileEvent,
  profiles,
  authorPreferences,
  sharePrefixes,
  translationTargetLanguage,
  mode,
  renderScope,
  archivedIds,
  entityKeyOverride,
  readActionOverride,
}: {
  alias: string;
  profileEvent: NrProfileEvent;
  profiles: Map<string, CachedProfile>;
  authorPreferences: Map<string, NrAuthorPreferenceValue>;
  sharePrefixes: NostrSharePrefixes;
  translationTargetLanguage: string;
  mode: NrListMode;
  renderScope: string;
  archivedIds: Set<string>;
  entityKeyOverride?: string;
  readActionOverride?: ReturnType<typeof readAction>;
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
        : event.kind === 9735
          ? (() => {
              const zap = parseZapReceipt(event);

              const label =
                zap.amountSats > 0
                  ? `Zapped ⚡ ${zap.amountSats.toLocaleString()} sats`
                  : 'Zapped ⚡';

              return activityHeaderFor({
                alias,
                label,
                event,
                profiles,
                mode,
                actorPubkeyOverride: zap.zapperPubkey,
                comment: zap.comment ?? undefined,
              });
            })()
          : null;

  const replyContext =
    category === 'replies' || category === 'comments' || reposted !== null
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
                sharePrefixes,
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
    props: {
      id: `nr-profile-${event.id}`,
      entityKey: entityKeyOverride ?? entityKey(event.id),
      defaultExpanded: false,
    },
    summary: el('stack', { gap: 'xs', fill: true }, [
      ...(event.kind === 7 || event.kind === 9735
        ? referencedEvents.map((reference) =>
            profilePostNode({
              alias,
              event: reference,
              profiles,
              replyContext: [],
              embeds: {},
              activityHeaders: activityHeader ? [activityHeader] : [],
              archived: archivedIds.has(reference.id),
              localPreference: undefined,
              authorPreference:
                authorPreferences.get(reference.pubkey.toLowerCase()) ?? null,
              sharePrefixes,
              translationTargetLanguage,
              mode,
              renderScope: `${renderScope}:source:${event.id}:reference:${reference.id}`,
              signalCandidateTopics: [],
              readActionOverride,
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
              archived: archivedIds.has(displayEvent.id),
              localPreference: undefined,
              authorPreference:
                authorPreferences.get(displayEvent.pubkey.toLowerCase()) ??
                null,
              sharePrefixes,
              translationTargetLanguage,
              mode,
              renderScope: `${renderScope}:source:${event.id}`,
              signalCandidateTopics: [],
              readActionOverride,
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
  archivedIds,
}: {
  alias: string;
  event: NrEvent;
  profiles: Map<string, CachedProfile>;
  authorPreferences: Map<string, NrAuthorPreferenceValue>;
  sharePrefixes: NostrSharePrefixes;
  translationTargetLanguage: string;
  mode: NrListMode;
  renderScope: string;
  archivedIds: Set<string>;
}): WebNode {
  let rawEvent: NostrEvent;

  try {
    rawEvent = JSON.parse(event.raw_json) as NostrEvent;
  } catch {
    return el('text', { tone: 'muted' }, [text(`Invalid event ${event.id}`)]);
  }

  const directTargetId = extractDirectActivityTargetId(rawEvent);

  const eventIds = [event.id, ...(directTargetId ? [directTargetId] : [])];

  const nodeReadAction = readAction({
    alias,
    eventId: directTargetId ?? event.id,
    eventIds,
    entityEventId: event.id,
    entityEventIds: directTargetId ? [directTargetId] : [],
    mode,
  });

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
    archivedIds,
    entityKeyOverride: entityKey(event.id),
    readActionOverride: nodeReadAction,
  });
}
