import { nip19 } from 'nostr-tools';

import type { CachedProfile } from '@src/db';
import type { WebNode, WebNodeRoot } from '@src/web/ui-schema';

import {
  extractAddressReferences,
  extractEventReferences,
  extractProfileReferences,
} from '../../../references';
import { extractNip10References } from '../../../thread-context';

import { NR_FETCH_STATUS_TARGET_ID } from '../../fetch-status';
import {
  NostrEventSchema,
  type NrInteraction,
  type NostrEvent,
  type NrEvent,
  type NrListData,
  type NrListMode,
  type NrProfileEvent,
  type NrTagGroup,
} from '../../shared/types';

import {
  NR_FEED_CATEGORIES,
  NR_FEED_CATEGORY_LABELS,
  categoryForNrEvent,
  type NrFeedCategory,
} from '../categories';

import { fetchCoverageBar, fetchCoverageStylesheet } from './fetch-coverage';

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
`,
};

type RenderNrListWebProps = {
  alias: string;
  listData: NrListData;
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

function openInNostrAction(event: NrEvent | NostrEvent) {
  const nevent = neventForEvent(event);

  if (!nevent) {
    return undefined;
  }

  return {
    type: 'clientAction' as const,
    action: 'web.openUrl',
    payload: { url: `nostr://${nevent}` },
  };
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

function likeEventAction(alias: string, event: NrEvent) {
  return {
    type: 'clientAction' as const,
    action: 'nostr.likeEvent',
    payload: {
      eventId: event.id,
      eventPubkey: event.pubkey,
      eventKind: event.kind,
      nrAlias: alias,
      relayHints: event.relay_hints,
    },
  };
}

function likeNostrEventAction(alias: string, event: NostrEvent) {
  return {
    type: 'clientAction' as const,
    action: 'nostr.likeEvent',
    payload: {
      eventId: event.id,
      eventPubkey: event.pubkey,
      eventKind: event.kind,
      nrAlias: alias,
      relayHints: [],
    },
  };
}

function repostEventAction({
  alias,
  event,
  post,
}: {
  alias: string;
  event: NrEvent;
  post: NostrPostView;
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
      relayHints: post.relayHints,
    },
  };
}

function repostNostrEventAction({
  alias,
  event,
  profile,
}: {
  alias: string;
  event: NostrEvent;
  profile: CachedProfile | undefined;
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
}: {
  alias: string;
  event: NrEvent;
  post: NostrPostView;
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
}: {
  alias: string;
  event: NostrEvent;
  profile: CachedProfile | undefined;
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
      rootEventId: root.id,
      rootPubkey: root.pubkey,
      relayHints: [],
    },
  };
}

function badge(value: string): WebNode {
  return el('badge', { size: 'sm', tone: 'muted' }, [text(value)]);
}

function forYouMetadata(event: NrEvent, score: number): WebNode {
  const topics = event.topics.length > 0 ? event.topics.join(', ') : '(none)';
  const moods = event.moods.length > 0 ? event.moods.join(', ') : '(none)';

  return el(
    'text',
    { className: 'nr-for-you-metadata', size: 'sm', tone: 'muted' },
    [text(`Topics: ${topics} . Moods: ${moods} . Score: ${score.toFixed(2)}`)],
  );
}

function countLabel(label: string, count: number): string {
  return `${label} (${count})`;
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
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'mark',
    arguments: { event_id: eventId },
    options: { [state]: true },
    recordInTimeline: false,
    refresh: {
      command: alias,
      subcommand: 'list',
      arguments: {},
      options: mode ? { mode } : {},
      recordInTimeline: false,
    },
  };
}

function readAction(alias: string, eventId: string, mode: NrListMode | null) {
  return markAction({ alias, eventId, state: 'read', mode });
}

function localPreferenceAction({
  alias,
  eventId,
  mode,
  preference,
}: {
  alias: string;
  eventId: string;
  mode: NrListMode;
  preference: 'like' | 'dislike' | 'none';
}) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'interest-record',
    arguments: {},
    options: { target_event_id: eventId, preference },
    recordInTimeline: false,
    refresh: {
      command: alias,
      subcommand: 'list',
      arguments: {},
      options: { mode },
      recordInTimeline: false,
    },
  };
}

function localPreferenceActions({
  alias,
  eventId,
  mode,
  preference,
}: {
  alias: string;
  eventId: string;
  mode: NrListMode;
  preference: 'like' | 'dislike' | null;
}) {
  return [
    {
      label: preference === 'like' ? '(👍)' : '👍',
      ariaLabel:
        preference === 'like'
          ? 'Remove local positive preference'
          : 'Show more posts like this locally',
      action: localPreferenceAction({
        alias,
        eventId,
        mode,
        preference: preference === 'like' ? 'none' : 'like',
      }),
      disabled: false,
      active: preference === 'like',
    },
    {
      label: preference === 'dislike' ? '(👎)' : '👎',
      ariaLabel:
        preference === 'dislike'
          ? 'Remove local negative preference'
          : 'Show fewer posts like this locally',
      action: localPreferenceAction({
        alias,
        eventId,
        mode,
        preference: preference === 'dislike' ? 'none' : 'dislike',
      }),
      disabled: false,
      active: preference === 'dislike',
    },
  ];
}

function archiveAction(alias: string, event: NrEvent, mode: NrListMode) {
  return markAction({
    alias,
    eventId: event.id,
    state: event.archived_at ? 'unarchived' : 'archived',
    mode,
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
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'mark',
    arguments: { event_id: event.id },
    options: { [state]: true, event_json: JSON.stringify(event) },
    recordInTimeline: false,
    refresh: {
      command: alias,
      subcommand: 'list',
      arguments: {},
      options: { mode },
      recordInTimeline: false,
    },
  };
}

function readTagAction(
  alias: string,
  type: 'topic' | 'mood',
  tag: string,
  mode: NrListMode,
) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'mark',
    arguments: {},
    options: { type, tag, read: true },
    recordInTimeline: false,
    refresh: {
      command: alias,
      subcommand: 'list',
      arguments: {},
      options: { mode },
      recordInTimeline: false,
    },
  };
}

type ReevaluateActionProps = {
  alias: string;
  eventId: string;
  eventJson: string | null;
};

function reevaluateAction({
  alias,
  eventId,
  eventJson,
}: ReevaluateActionProps) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'reevaluate',
    arguments: { event_id: eventId },
    options: eventJson ? { event_json: eventJson } : {},
    recordInTimeline: true,
    refresh: {
      command: alias,
      subcommand: 'list',
      arguments: {},
      options: {},
      recordInTimeline: false,
    },
  };
}

function eventActionsMenu(
  alias: string,
  event: NrEvent,
  mode: NrListMode,
): WebNode {
  const openAction = openInNostrAction(event);
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
      ...(openAction
        ? [
            {
              type: 'element' as const,
              tag: 'menuItem' as const,
              props: {
                label: 'Open in nostr',
                action: openAction,
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
          action: readAction(alias, event.id, mode),
        },
      },
      {
        type: 'element',
        tag: 'menuItem',
        props: {
          label: event.archived_at ? 'Unarchive' : 'Archive',
          action: archiveAction(alias, event, mode),
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
}: {
  alias: string;
  event: NostrEvent;
  archived: boolean;
  mode: NrListMode;
}): WebNode {
  const openAction = openInNostrAction(event);
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
      ...(openAction
        ? [
            {
              type: 'element' as const,
              tag: 'menuItem' as const,
              props: { label: 'Open in nostr', action: openAction },
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
          action: reevaluateAction({ alias, eventId: event.id, eventJson }),
        },
      },
    ],
  };
}

function referencedEvents(event: NrEvent): NostrEvent[] {
  try {
    const parsed = JSON.parse(event.referenced_events_json) as unknown;

    return Array.isArray(parsed) ? (parsed as NostrEvent[]) : [];
  } catch {
    return [];
  }
}

function threadContextEvents(event: NrEvent): NostrEvent[] {
  try {
    const parsed = JSON.parse(event.thread_context_json) as unknown;
    const rawEvent = NostrEventSchema.parse(JSON.parse(event.raw_json));

    const threadIds = new Set(
      extractNip10References(rawEvent).map((reference) => reference.id),
    );

    return Array.isArray(parsed)
      ? (parsed as NostrEvent[]).filter((context) => threadIds.has(context.id))
      : [];
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

function inlineProfiles(content: string, profiles: Map<string, CachedProfile>) {
  const inline: Record<string, unknown> = {};

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
    };
  }

  return inline;
}

function addressReferences({
  content,
  profiles,
}: {
  content: string;
  profiles: Map<string, CachedProfile>;
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
    };
  });
}

function nostrEmbeds({
  alias,
  event,
  profiles,
  interactions,
  mode,
}: {
  alias: string;
  event: NrEvent;
  profiles: Map<string, CachedProfile>;
  interactions: NrInteraction[];
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
                      }),
                      token: nestedReference.token,
                    },
                  ]
                : [];
            },
          ),
          ...addressReferences({ content: referencedEvent.content, profiles }),
        ]
      : [];

    embeds[reference.token] = {
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
        ? likeNostrEventAction(alias, referencedEvent)
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
        ? replyNostrEventAction({ alias, event: referencedEvent, profile })
        : undefined,
      repostAction: referencedEvent
        ? repostNostrEventAction({ alias, event: referencedEvent, profile })
        : undefined,
      liked: flags.liked,
      replied: flags.replied,
      reposted: flags.reposted,
      quoted: flags.quoted,
      showActions: referencedEvent ? true : false,
      inlineProfiles: referencedEvent
        ? inlineProfiles(referencedEvent.content, profiles)
        : undefined,
      label: referencedEvent ? 'Quoted note' : 'Referenced note',
    };
  }

  for (const reference of addressReferences({
    content: event.content,
    profiles,
  })) {
    embeds[reference.token] = reference;
  }

  return embeds;
}

function threadContextReferences(
  alias: string,
  event: NrEvent,
  profiles: Map<string, CachedProfile>,
  interactions: NrInteraction[],
  mode: NrListMode,
) {
  const context = threadContextEvents(event);

  const relatedEvents = new Map(
    [...context, ...referencedEvents(event)].map((relatedEvent) => [
      relatedEvent.id,
      relatedEvent,
    ]),
  );

  return context.map((contextEvent) => {
    const profile = profileForPubkey({
      profiles,
      pubkey: contextEvent.pubkey,
    });

    const flags = interactionFlags(interactions, contextEvent.id);

    return {
      type: 'event' as const,
      id: contextEvent.id,
      pubkey: contextEvent.pubkey,
      kind: contextEvent.kind,
      npub: npubForPubkey(contextEvent.pubkey),
      authorName: profile?.displayName ?? undefined,
      authorUsername: profile?.name ?? undefined,
      authorPicture: profile?.picture ?? undefined,
      authorAbout: profile?.about ?? undefined,
      relayHints: [],
      createdAt: contextEvent.created_at,
      content: contextEvent.content,
      readAction: markRawEventAction({
        alias,
        event: contextEvent,
        state: 'read',
        mode,
      }),
      likeAction: likeNostrEventAction(alias, contextEvent),
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
      }),
      repostAction: repostNostrEventAction({
        alias,
        event: contextEvent,
        profile,
      }),
      liked: flags.liked,
      replied: flags.replied,
      reposted: flags.reposted,
      quoted: flags.quoted,
      showActions: true,
      inlineProfiles: inlineProfiles(contextEvent.content, profiles),
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
                  }),
                  token: reference.token,
                },
              ]
            : [];
        }),
        ...addressReferences({ content: contextEvent.content, profiles }),
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
  localPreference: 'like' | 'dislike' | null;
  rankingScore: number | null;
  mode: NrListMode;
};

export function eventNode({
  alias,
  event,
  profiles,
  showReplyContext,
  interactions,
  localPreference,
  rankingScore,
  mode,
}: EventNodeProps): WebNode {
  if (event.kind !== 1) {
    return activityEventNode({ alias, event, profiles, mode });
  }

  const eventInteractions = interactions ?? [];
  const nevent = neventForEvent(event);
  const post = postViewFromNrEvent({ event, profiles });
  const flags = interactionFlags(eventInteractions, event.id);

  const filterText = eventFilterText({ event, profiles });

  return {
    type: 'element',
    tag: 'treeItem',
    props: {
      id: `nr-event-${event.id}`,
      className: `nr-list-event${rankingScore === null ? '' : ' nr-for-you-event'}`,
      defaultExpanded: true,
      filterText,
      filterName: event.summary || event.id,
      filterPath: `event/${event.id}`,
    },
    summary: el('row', { gap: 'xs', align: 'between', itemAlign: 'start' }, [
      eventActionsMenu(alias, event, mode),
      el('stack', { gap: 'xs', fill: true }, [
        ...(rankingScore === null ? [] : [forYouMetadata(event, rankingScore)]),
        el(
          'nostrPost',
          {
            size: 'sm',
            nostrEventId: post.id,
            nostrPubkey: post.pubkey,
            nostrNpub: npubForPubkey(post.pubkey),
            nostrRelayHints: post.relayHints,
            nostrAuthorName: post.authorName ?? undefined,
            nostrAuthorUsername: post.authorUsername ?? undefined,
            nostrAuthorPicture: post.authorPicture ?? undefined,
            nostrAuthorAbout: post.authorAbout ?? undefined,
            nostrCreatedAt: post.createdAt,
            nostrContent: post.content,
            nostrInlineProfiles: inlineProfiles(event.content, profiles),
            nostrPermalink: nevent ? `nostr:${nevent}` : undefined,
            nostrEmbeds: nostrEmbeds({
              alias,
              event,
              profiles,
              interactions: eventInteractions,
              mode,
            }),
            nostrReplyContext: threadContextReferences(
              alias,
              event,
              profiles,
              eventInteractions,
              mode,
            ),
            nostrShowReplyContext: showReplyContext,
            nostrReadAction: readAction(alias, event.id, mode),
            nostrTrailingActions: localPreferenceActions({
              alias,
              eventId: event.id,
              mode,
              preference: localPreference,
            }),
            nostrArchiveAction: archiveAction(alias, event, mode),
            nostrArchived: event.archived_at !== null,
            nostrLikeAction: likeEventAction(alias, event),
            nostrReplyAction: replyEventAction({ alias, event, post }),
            nostrRepostAction: repostEventAction({ alias, event, post }),
            nostrLiked: flags.liked,
            nostrReplied: flags.replied,
            nostrReposted: flags.reposted,
            nostrQuoted: flags.quoted,
          },
          [],
        ),
        ...(rankingScore === null
          ? [
              el('row', { gap: 'xs' }, [
                ...event.topics.map((tag) => badge(`#${tag}`)),
                ...event.moods.map((tag) => badge(tag)),
              ]),
            ]
          : []),
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
  mode: NrListMode;
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
  activities,
  profiles,
  localPreference,
  rankingEvent,
  rankingScore,
  mode,
}: {
  alias: string;
  target: NostrEvent;
  activities: NrEvent[];
  profiles: Map<string, CachedProfile>;
  localPreference: 'like' | 'dislike' | null;
  rankingEvent: NrEvent | null;
  rankingScore: number | null;
  mode: NrListMode;
}): WebNode {
  const archived = activities.some((activity) => activity.archived_at !== null);

  const relatedEvents = new Map(
    activities
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
                }),
              ],
            ]
          : [];
      },
    ),
    ...addressReferences({ content: target.content, profiles }).map(
      (reference) => [reference.token, reference] as const,
    ),
  ]);

  const replyContext = extractNip10References(target)
    .map((reference) => relatedEvents.get(reference.id))
    .filter((event): event is NostrEvent => event !== undefined)
    .map((event) => profileReference({ alias, event, profiles }));

  const headers = activities.flatMap((activity) => {
    try {
      const event = JSON.parse(activity.raw_json) as NostrEvent;

      const label =
        event.kind === 6
          ? 'Reposted'
          : event.kind === 7
            ? `Reacted ${event.content || '+'}`
            : null;

      return label ? [activityHeaderFor({ label, event, profiles })] : [];
    } catch {
      return [];
    }
  });

  return {
    type: 'element',
    tag: 'treeItem',
    props: {
      id: `nr-activity-${target.id}`,
      className: `nr-list-event${rankingScore === null ? '' : ' nr-for-you-event'}`,
      defaultExpanded: true,
    },
    summary: el('row', { gap: 'xs', align: 'between', itemAlign: 'start' }, [
      referencedEventActionsMenu({
        alias,
        event: target,
        archived,
        mode,
      }),
      el('stack', { fill: true }, [
        ...(rankingEvent && rankingScore !== null
          ? [forYouMetadata(rankingEvent, rankingScore)]
          : []),
        profilePostNode({
          alias,
          event: target,
          profiles,
          replyContext,
          embeds,
          activityHeaders: headers,
          archived,
          localPreference,
          mode,
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
  rankingScores,
  mode,
}: {
  alias: string;
  events: NrEvent[];
  profiles: Map<string, CachedProfile>;
  interactions: NrInteraction[];
  localPreferences: Map<string, 'like' | 'dislike'>;
  rankingScores: Record<string, number> | null;
  mode: NrListMode;
}): WebNode[] {
  const activitiesByTarget = new Map<
    string,
    { target: NostrEvent; activities: NrEvent[] }
  >();

  for (const event of events) {
    if (event.kind === 1) {
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
    if (event.kind !== 1) {
      const target = activityTarget(event);

      if (!target || renderedTargets.has(target.id)) {
        continue;
      }

      const aggregate = activitiesByTarget.get(target.id);

      if (!aggregate) {
        continue;
      }

      renderedTargets.add(target.id);

      nodes.push(
        mergedActivityNode({
          alias,
          target: aggregate.target,
          activities: aggregate.activities,
          profiles,
          localPreference: localPreferences.get(target.id) ?? null,
          rankingEvent: rankingScores ? event : null,
          rankingScore: rankingScores?.[event.id] ?? null,
          mode,
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
          activities: aggregate.activities,
          profiles,
          localPreference: localPreferences.get(event.id) ?? null,
          rankingEvent: rankingScores ? event : null,
          rankingScore: rankingScores?.[event.id] ?? null,
          mode,
        }),
      );
    } else {
      nodes.push(
        eventNode({
          alias,
          event,
          profiles,
          showReplyContext: mode === 'for-you',
          interactions,
          localPreference: localPreferences.get(event.id) ?? null,
          rankingScore: rankingScores?.[event.id] ?? null,
          mode,
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
  mode,
}: GroupNodeProps): WebNode {
  return {
    type: 'element',
    tag: 'treeItem',
    props: {
      id: `nr-${group.type}-${group.tag}`,
      defaultExpanded: false,
      filterText: group.tag,
      filterName: group.tag,
      filterPath: `${group.type}/${group.tag}`,
    },
    summary: el(
      'row',
      { gap: 'xs', itemAlign: 'center', align: 'between', fill: true },
      [
        el('text', { weight: 'semibold' }, [
          text(countLabel(group.tag, group.unreadCount)),
        ]),
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
                action: readTagAction(alias, group.type, group.tag, mode),
              },
            },
          ],
        ),
      ],
    ),
    children: groupEventNodes({
      alias,
      events: group.events,
      profiles,
      interactions,
      localPreferences,
      rankingScores: null,
      mode,
    }),
  };
}

type SectionNodeProps = {
  alias: string;
  title: string;
  type: 'topic' | 'mood';
  groups: NrTagGroup[];
  profiles: Map<string, CachedProfile>;
  interactions: NrInteraction[];
  localPreferences: Map<string, 'like' | 'dislike'>;
  mode: NrListMode;
};

function sectionNode({
  alias,
  title,
  type,
  groups,
  profiles,
  interactions,
  localPreferences,
  mode,
}: SectionNodeProps): WebNode {
  const sectionUnreadCount = groups.reduce(
    (sum, group) => sum + group.unreadCount,
    0,
  );

  return {
    type: 'element',
    tag: 'treeItem',
    props: {
      id: `nr-section-${title.toLowerCase()}`,
      defaultExpanded: true,
      filterName: title,
      filterText: title,
    },
    summary: el(
      'row',
      { gap: 'xs', itemAlign: 'center', align: 'between', fill: true },
      [
        el('row', { gap: 'xs', itemAlign: 'center' }, [
          el('text', { weight: 'bold' }, [
            text(countLabel(title, sectionUnreadCount)),
          ]),
          badge(String(sectionUnreadCount)),
        ]),
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
                label: type === 'topic' ? 'Add a topic' : 'Add a mood',
                action: taxonomyEditorAction(alias, type),
              },
            },
          ],
        ),
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
              mode,
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
    modalTitle: type === 'topic' ? 'Add a topic' : 'Add a mood',
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

function fetchProgressStatus(): WebNode {
  return el('treeItem', { id: 'nr-fetch-progress', defaultExpanded: false }, [
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
  ]);
}

function listModeAction(alias: string, mode: NrListMode) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'list',
    arguments: {},
    options: { mode },
    recordInTimeline: false,
  };
}

function listFilterAction(alias: string, mode: NrListMode) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'list',
    arguments: {},
    options: { mode },
    recordInTimeline: false,
  };
}

function listFilterPanel(
  alias: string,
  mode: 'timeline' | 'profile',
  selected: NrFeedCategory[],
): WebNode {
  return el(
    'form',
    {
      className: 'web-form web-form--stacked nr-list-filter-panel',
      revealId: NR_LIST_FILTER_REVEAL_ID,
      hiddenUntilRevealed: true,
      formOptionFieldNames: ['kinds'],
      action: listFilterAction(alias, mode),
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
            action: { type: 'hideReveal', targetId: NR_LIST_FILTER_REVEAL_ID },
          },
          [],
        ),
      ]),
    ],
  );
}

function listModeSwitch(alias: string, mode: NrListMode): WebNode {
  return el(
    'row',
    { className: 'widget-tabs', gap: 'xs', itemAlign: 'center' },
    [
      el(
        'button',
        {
          label: 'Timeline',
          className: `web-button widget-tab${mode === 'timeline' ? ' active' : ''}`,
          action: listModeAction(alias, 'timeline'),
        },
        [],
      ),
      el(
        'button',
        {
          label: 'For You',
          className: `web-button widget-tab${mode === 'for-you' ? ' active' : ''}`,
          action: listModeAction(alias, 'for-you'),
        },
        [],
      ),
      el(
        'button',
        {
          label: 'Profile',
          className: `web-button widget-tab${mode === 'profile' ? ' active' : ''}`,
          action: listModeAction(alias, 'profile'),
        },
        [],
      ),
      el(
        'button',
        {
          label: 'Archive',
          className: `web-button widget-tab${mode === 'archive' ? ' active' : ''}`,
          action: listModeAction(alias, 'archive'),
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
  mode,
}: {
  alias: string;
  event: NostrEvent;
  profiles: Map<string, CachedProfile>;
  replyContext: ReturnType<typeof profileReference>[];
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
  mode: NrListMode;
}): WebNode {
  const profile = profileForPubkey({ profiles, pubkey: event.pubkey });

  return el(
    'nostrPost',
    {
      size: 'sm',
      nostrEventId: event.id,
      nostrPubkey: event.pubkey,
      nostrNpub: npubForPubkey(event.pubkey),
      nostrAuthorName: profile?.displayName,
      nostrAuthorUsername: profile?.name,
      nostrAuthorPicture: profile?.picture,
      nostrAuthorAbout: profile?.about,
      nostrCreatedAt: event.created_at,
      nostrContent: event.content,
      nostrInlineProfiles: inlineProfiles(event.content, profiles),
      nostrReplyContext: replyContext,
      nostrShowReplyContext: replyContext.length > 0,
      nostrEmbeds: embeds,
      nostrReplyAction: replyNostrEventAction({ alias, event, profile }),
      nostrLikeAction: likeNostrEventAction(alias, event),
      nostrRepostAction: repostNostrEventAction({ alias, event, profile }),
      ...(localPreference === undefined
        ? {}
        : {
            nostrTrailingActions: localPreferenceActions({
              alias,
              eventId: event.id,
              mode,
              preference: localPreference,
            }),
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
  );
}

function activityHeaderFor({
  label,
  event,
  profiles,
}: {
  label: string;
  event: NostrEvent;
  profiles: Map<string, CachedProfile>;
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
  };
}

function profileReference({
  alias,
  event,
  profiles,
}: {
  alias: string;
  event: NostrEvent;
  profiles: Map<string, CachedProfile>;
}) {
  const profile = profileForPubkey({ profiles, pubkey: event.pubkey });

  return {
    type: 'event' as const,
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    npub: npubForPubkey(event.pubkey),
    authorName: profile?.displayName,
    authorUsername: profile?.name,
    authorPicture: profile?.picture,
    authorAbout: profile?.about,
    relayHints: [],
    createdAt: event.created_at,
    content: event.content,
    likeAction: likeNostrEventAction(alias, event),
    replyAction: replyNostrEventAction({ alias, event, profile }),
    repostAction: repostNostrEventAction({ alias, event, profile }),
    showActions: true,
    inlineProfiles: inlineProfiles(event.content, profiles),
  };
}

type ProfileReferenceWithEmbedsProps = {
  alias: string;
  event: NostrEvent;
  profiles: Map<string, CachedProfile>;
  relatedEvents: Map<string, NostrEvent>;
};

function profileReferenceWithEmbeds({
  alias,
  event,
  profiles,
  relatedEvents,
}: ProfileReferenceWithEmbedsProps) {
  return {
    ...profileReference({ alias, event, profiles }),
    embeddedReferences: [
      ...extractEventReferences(event.content).flatMap((reference) => {
        const embeddedEvent = relatedEvents.get(reference.id);

        return embeddedEvent
          ? [
              {
                ...profileReference({ alias, event: embeddedEvent, profiles }),
                token: reference.token,
              },
            ]
          : [];
      }),
      ...addressReferences({ content: event.content, profiles }),
    ],
  };
}

function profileEventNode({
  alias,
  profileEvent,
  profiles,
  mode,
}: {
  alias: string;
  profileEvent: NrProfileEvent;
  profiles: Map<string, CachedProfile>;
  mode: NrListMode;
}): WebNode {
  const { event, referencedEvents } = profileEvent;

  let reposted: NostrEvent | null = null;

  if (event.kind === 6) {
    try {
      const parsed = NostrEventSchema.safeParse(JSON.parse(event.content));
      reposted = parsed.success ? parsed.data : null;
    } catch {
      reposted = null;
    }
  }

  const displayEvent = reposted ?? event;
  const category = categoryForNrEvent(event);

  const referencedEventsById = new Map(
    referencedEvents.map((reference) => [reference.id, reference]),
  );

  const activityHeader =
    event.kind === 6
      ? activityHeaderFor({ label: 'Reposted', event, profiles })
      : event.kind === 7
        ? activityHeaderFor({
            label: `Reacted ${event.content || '+'}`,
            event,
            profiles,
          })
        : null;

  const replyContext =
    category === 'replies'
      ? extractNip10References(event)
          .map((reference) => referencedEventsById.get(reference.id))
          .filter(
            (reference): reference is NostrEvent => reference !== undefined,
          )
          .map((reference) =>
            profileReferenceWithEmbeds({
              alias,
              event: reference,
              profiles,
              relatedEvents: referencedEventsById,
            }),
          )
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
                }),
              ],
            ]
          : [];
      },
    ),
    ...addressReferences({ content: displayEvent.content, profiles }).map(
      (reference) => [reference.token, reference] as const,
    ),
  ]);

  return {
    type: 'element',
    tag: 'treeItem',
    props: { id: `nr-profile-${event.id}`, defaultExpanded: true },
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
              mode,
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
              mode,
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
  mode,
}: {
  alias: string;
  event: NrEvent;
  profiles: Map<string, CachedProfile>;
  mode: NrListMode;
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
    mode,
  });
}

export function renderNrListWeb({
  alias,
  listData,
  profiles,
}: RenderNrListWebProps): WebNodeRoot {
  const localPreferences = new Map<string, 'like' | 'dislike'>();

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
    },
    stylesheets: [fetchCoverageStylesheet, nrListStylesheet],
    tree: el('stack', { gap: 'sm' }, [
      listModeSwitch(alias, listData.mode),
      ...(listData.mode === 'timeline' || listData.mode === 'profile'
        ? [listFilterPanel(alias, listData.mode, listData.selectedCategories)]
        : []),
      {
        type: 'element',
        tag: 'tree',
        props: {
          className: 'nr-list-tree',
          gap: 'xs',
          filterable: true,
          filterPlaceholder: 'Filter tags, moods, posts',
          toolbarActions: [
            ...(listData.mode === 'timeline' || listData.mode === 'profile'
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
              label: 'Settings',
              icon: 'settings',
              action: settingsAction(alias),
              visibleOnSurfaces: ['timeline', 'modal', 'dock'],
            },
          ],
        },
        children: [
          ...(listData.mode === 'timeline'
            ? [
                fetchCoverageBar(alias, listData),
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
                    mode: 'profile',
                  }),
                )
              : [
                  el('text', { tone: 'muted' }, [
                    text('No matching profile events found.'),
                  ]),
                ]
            : []),
          ...(listData.mode === 'for-you'
            ? listData.forYouEvents.length > 0
              ? groupEventNodes({
                  alias,
                  events: listData.forYouEvents,
                  profiles,
                  interactions: listData.interactions,
                  localPreferences,
                  rankingScores: listData.forYouScores,
                  mode: 'for-you',
                })
              : [
                  el('text', { tone: 'muted' }, [
                    text('No unread Timeline events found.'),
                  ]),
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
                  mode: listData.mode,
                }),
                sectionNode({
                  alias,
                  title: 'Moods',
                  type: 'mood',
                  groups: listData.moodGroups,
                  profiles,
                  interactions: listData.interactions,
                  localPreferences,
                  mode: listData.mode,
                }),
              ]),
        ],
      },
    ]),
  };
}
