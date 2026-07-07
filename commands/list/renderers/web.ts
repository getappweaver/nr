import { nip19 } from 'nostr-tools';

import type { CachedProfile } from '@src/db';
import type { WebNode, WebNodeRoot } from '@src/web/ui-schema';

import { extractEventReferences } from '../../../references';
import { extractProfileReferences } from '../../../references';

import { NR_FETCH_STATUS_TARGET_ID } from '../../fetch-status';
import type {
  NrInteraction,
  NostrEvent,
  NrEvent,
  NrListData,
  NrListMode,
  NrTagGroup,
} from '../../shared/types';

import { fetchCoverageBar, fetchCoverageStylesheet } from './fetch-coverage';

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

function neventForEvent(event: NrEvent): string | undefined {
  try {
    return nip19.neventEncode({
      id: event.id,
      author: event.pubkey,
      kind: event.kind,
      relays: event.relay_hints.slice(0, 1),
    });
  } catch {
    return undefined;
  }
}

function openInNostrAction(event: NrEvent) {
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

function copyNeventAction(event: NrEvent) {
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

function archiveAction(alias: string, event: NrEvent, mode: NrListMode) {
  return markAction({
    alias,
    eventId: event.id,
    state: event.archived_at ? 'unarchived' : 'archived',
    mode,
  });
}

function archiveRawEventAction(
  alias: string,
  event: NostrEvent,
  mode: NrListMode,
) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'mark',
    arguments: { event_id: event.id },
    options: { archived: true, event_json: JSON.stringify(event) },
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

function reevaluateAction(alias: string, eventId: string) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'reevaluate',
    arguments: { event_id: eventId },
    options: {},
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
          action: reevaluateAction(alias, event.id),
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

    return Array.isArray(parsed) ? (parsed as NostrEvent[]) : [];
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
      readAction: referencedEvent
        ? readAction(alias, referencedEvent.id, mode)
        : undefined,
      likeAction: referencedEvent
        ? likeNostrEventAction(alias, referencedEvent)
        : undefined,
      archiveAction: referencedEvent
        ? archiveRawEventAction(alias, referencedEvent, mode)
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
      readAction: readAction(alias, contextEvent.id, mode),
      likeAction: likeNostrEventAction(alias, contextEvent),
      archiveAction: archiveRawEventAction(alias, contextEvent, mode),
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
  mode: NrListMode;
};

export function eventNode({
  alias,
  event,
  profiles,
  showReplyContext,
  interactions,
  mode,
}: EventNodeProps): WebNode {
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
      defaultExpanded: true,
      filterText,
      filterName: event.summary || event.id,
      filterPath: `event/${event.id}`,
    },
    summary: el('row', { gap: 'xs', align: 'between', itemAlign: 'start' }, [
      el('stack', { gap: 'xs', fill: true }, [
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
        el('row', { gap: 'xs' }, [
          ...event.topics.map((tag) => badge(`#${tag}`)),
          ...event.moods.map((tag) => badge(tag)),
        ]),
      ]),
      eventActionsMenu(alias, event, mode),
    ]),
    children: [],
  };
}

type GroupNodeProps = {
  alias: string;
  group: NrTagGroup;
  profiles: Map<string, CachedProfile>;
  interactions: NrInteraction[];
  mode: NrListMode;
};

function groupNode({
  alias,
  group,
  profiles,
  interactions,
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
    children: group.events.map((event) =>
      eventNode({
        alias,
        event,
        profiles,
        showReplyContext: false,
        interactions,
        mode,
      }),
    ),
  };
}

type SectionNodeProps = {
  alias: string;
  title: string;
  type: 'topic' | 'mood';
  groups: NrTagGroup[];
  profiles: Map<string, CachedProfile>;
  interactions: NrInteraction[];
  mode: NrListMode;
};

function sectionNode({
  alias,
  title,
  type,
  groups,
  profiles,
  interactions,
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
            groupNode({ alias, group, profiles, interactions, mode }),
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
          label: 'Archive',
          className: `web-button widget-tab${mode === 'archive' ? ' active' : ''}`,
          action: listModeAction(alias, 'archive'),
        },
        [],
      ),
    ],
  );
}

export function renderNrListWeb({
  alias,
  listData,
  profiles,
}: RenderNrListWebProps): WebNodeRoot {
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
      {
        type: 'element',
        tag: 'tree',
        props: {
          className: 'nr-list-tree',
          gap: 'xs',
          filterable: true,
          filterPlaceholder: 'Filter tags, moods, posts',
          toolbarActions: [
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
          sectionNode({
            alias,
            title: 'Topics',
            type: 'topic',
            groups: listData.topicGroups,
            profiles,
            interactions: listData.interactions,
            mode: listData.mode,
          }),
          sectionNode({
            alias,
            title: 'Moods',
            type: 'mood',
            groups: listData.moodGroups,
            profiles,
            interactions: listData.interactions,
            mode: listData.mode,
          }),
        ],
      },
    ]),
  };
}
