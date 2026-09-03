import type { CachedProfile } from '@src/db';
import type { WebNode } from '@src/web/ui-schema';

import type {
  NrInterestSignal,
  NrListData,
  NrListMode,
  NrSignalAuthorAggregate,
  NrSignalTopicAggregate,
} from '../../shared/types';

import { el, keyed, text } from './primitives';

type SignalTopicNodeProps = {
  aggregate: NrSignalTopicAggregate;
  alias: string;
  mode: NrListMode;
  share: number;
};

type DeleteTopicSignalsProps = {
  alias: string;
  topic: string;
};

function deleteTopicSignalsAction({ alias, topic }: DeleteTopicSignalsProps) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'signal-delete',
    arguments: {},
    options: { topic },
    recordInTimeline: false,
    pendingUi: { presentation: 'entity' as const, label: 'Deleting…' },
    refresh: {
      command: alias,
      subcommand: 'list',
      arguments: {},
      options: { mode: 'signals', time_filter_initialized: true },
      recordInTimeline: false,
    },
  };
}

type DeleteAuthorSignalsProps = {
  alias: string;
  authorPubkey: string;
};

function deleteAuthorSignalsAction({
  alias,
  authorPubkey,
}: DeleteAuthorSignalsProps) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'signal-delete',
    arguments: {},
    options: { author_pubkey: authorPubkey },
    recordInTimeline: false,
    pendingUi: { presentation: 'entity' as const, label: 'Deleting…' },
    refresh: {
      command: alias,
      subcommand: 'list',
      arguments: {},
      options: { mode: 'signals', time_filter_initialized: true },
      recordInTimeline: false,
    },
  };
}

function signalTopicMenu({ alias, topic }: DeleteTopicSignalsProps): WebNode {
  return keyed(
    `nr:signals:topic:${encodeURIComponent(topic)}:menu`,
    el(
      'overflowMenu',
      {
        label: '⋮',
        buttonVariant: 'icon',
        stopPropagation: true,
      },
      [
        el(
          'menuItem',
          {
            label: 'Delete',
            tone: 'danger',
            action: deleteTopicSignalsAction({ alias, topic }),
          },
          [],
        ),
      ],
    ),
  );
}

function signalAuthorMenu({
  alias,
  authorPubkey,
}: DeleteAuthorSignalsProps): WebNode {
  return keyed(
    `nr:signals:author:${authorPubkey}:menu`,
    el(
      'overflowMenu',
      {
        label: '⋮',
        buttonVariant: 'icon',
        stopPropagation: true,
      },
      [
        el(
          'menuItem',
          {
            label: 'Delete',
            tone: 'danger',
            action: deleteAuthorSignalsAction({ alias, authorPubkey }),
          },
          [],
        ),
      ],
    ),
  );
}

function formatSignalTime(value: number): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function signalLeafNode({
  signal,
  scope,
}: {
  signal: NrInterestSignal;
  scope: string;
}): WebNode {
  const topics =
    signal.topics.length > 0 ? signal.topics.join(', ') : '(no topics)';

  return {
    type: 'element',
    tag: 'treeItem',
    renderKey: `nr:signals:${scope}:${signal.targetEventId}:${signal.type}`,
    props: {
      id: `nr-signal-${signal.targetEventId.slice(0, 8)}-${signal.type}`,
      defaultExpanded: false,
      filterText: `${signal.type} ${topics} ${signal.targetEventId}`,
      filterName: signal.type,
    },
    summary: el('row', { gap: 'xs', itemAlign: 'center', fill: true }, [
      el('text', { size: 'sm', weight: 'semibold' }, [
        text(
          `[${signal.type} ${signal.weight >= 0 ? '+' : ''}${signal.weight}]`,
        ),
      ]),
      el('text', { size: 'sm', tone: 'muted' }, [
        text(
          `${topics} · ${signal.source} · ${signal.targetEventId.slice(0, 12)}… · ${formatSignalTime(signal.updatedAt)}`,
        ),
      ]),
    ]),
    children: [
      el('text', { size: 'sm', tone: 'muted' }, [
        text(
          `Target ${signal.targetEventId} · created ${formatSignalTime(signal.createdAt)} · author ${(signal.authorPubkey ?? '(unknown)').slice(0, 16)}…`,
        ),
      ]),
    ],
  } as WebNode;
}

function signalTopicNode({
  aggregate,
  alias,
  mode,
  share,
}: SignalTopicNodeProps): WebNode {
  const average =
    aggregate.matchedEventCount > 0
      ? aggregate.totalWeight / aggregate.matchedEventCount
      : 0;

  const breakdown = aggregate.byType
    .map(
      (entry) =>
        `${entry.count} × ${entry.type} (${entry.weight >= 0 ? '+' : ''}${entry.weight} each) = ${entry.weight >= 0 ? '+' : ''}${entry.count * entry.weight}`,
    )
    .join(' · ');

  return {
    type: 'element',
    tag: 'treeItem',
    renderKey: `nr:${mode}:signals:topic:${encodeURIComponent(aggregate.topic)}`,
    props: {
      id: `nr-signals-topic-${aggregate.topic}`,
      entityKey: `nr-signal-topic:${aggregate.topic}`,
      defaultExpanded: false,
      filterText: aggregate.topic,
      filterName: aggregate.topic,
      filterPath: `signals/topic/${aggregate.topic}`,
      pruneWhenNoTreeItems: true,
    },
    summary: el(
      'row',
      { gap: 'xs', itemAlign: 'center', align: 'between', fill: true },
      [
        el('row', { gap: 'xs', itemAlign: 'center' }, [
          el('countLabel', { label: aggregate.topic, weight: 'semibold' }, []),
        ]),
        el('row', { gap: 'xs', itemAlign: 'center' }, [
          el('text', { size: 'sm', tone: 'muted' }, [
            text(
              `${aggregate.matchedEventCount} matched · ${aggregate.signalCount} signals · total ${aggregate.totalWeight >= 0 ? '+' : ''}${aggregate.totalWeight} · affinity ${aggregate.affinity.toFixed(2)} · share ${(share * 100).toFixed(1)}% · avg ${average.toFixed(2)}/post`,
            ),
          ]),
          signalTopicMenu({ alias, topic: aggregate.topic }),
        ]),
      ],
    ),
    children: [
      el('text', { size: 'sm', tone: 'muted' }, [
        text(breakdown || '(no signals)'),
      ]),
      el('text', { size: 'sm', tone: 'muted' }, [
        text(
          `Affinity splits each signal weight across its topics (weight / topic count), then sums. Average = total / matched posts including read.`,
        ),
      ]),
      ...aggregate.signals.map((signal) =>
        signalLeafNode({ signal, scope: `topic:${aggregate.topic}` }),
      ),
    ],
  } as WebNode;
}

type SignalAuthorNodeProps = {
  aggregate: NrSignalAuthorAggregate;
  authorName: string | null;
  alias: string;
  mode: NrListMode;
  share: number;
};

function signalAuthorNode({
  aggregate,
  authorName,
  alias,
  mode,
  share,
}: SignalAuthorNodeProps): WebNode {
  const short = aggregate.authorPubkey.slice(0, 12);
  const label = authorName ?? short;

  const breakdown = aggregate.byType
    .map(
      (entry) =>
        `${entry.count} × ${entry.type} (${entry.weight >= 0 ? '+' : ''}${entry.weight} each) = ${entry.weight >= 0 ? '+' : ''}${entry.count * entry.weight}`,
    )
    .join(' · ');

  return {
    type: 'element',
    tag: 'treeItem',
    renderKey: `nr:${mode}:signals:author:${aggregate.authorPubkey}`,
    props: {
      id: `nr-signals-author-${short}`,
      entityKey: `nr-signal-author:${aggregate.authorPubkey}`,
      defaultExpanded: false,
      filterText: `${label} ${aggregate.authorPubkey}`,
      filterName: label,
      filterPath: `signals/author/${aggregate.authorPubkey}`,
      pruneWhenNoTreeItems: true,
    },
    summary: el(
      'row',
      { gap: 'xs', itemAlign: 'center', align: 'between', fill: true },
      [
        el('row', { gap: 'xs', itemAlign: 'center' }, [
          el('countLabel', { label, weight: 'semibold' }, []),
        ]),
        el('row', { gap: 'xs', itemAlign: 'center' }, [
          el('text', { size: 'sm', tone: 'muted' }, [
            text(
              `${aggregate.matchedEventCount} posts · ${aggregate.signalCount} signals · raw ${aggregate.totalWeight >= 0 ? '+' : ''}${aggregate.totalWeight} · learned ${aggregate.learnedAffinity.toFixed(2)} · share ${(share * 100).toFixed(1)}%`,
            ),
          ]),
          signalAuthorMenu({ alias, authorPubkey: aggregate.authorPubkey }),
        ]),
      ],
    ),
    children: [
      el('text', { size: 'sm', tone: 'muted' }, [
        text(breakdown || '(no signals)'),
      ]),
      el('text', { size: 'sm', tone: 'muted' }, [
        text(
          `Learned author score = 1.5 × tanh(raw / 5). Matched posts counts all cached events from this author including read.`,
        ),
      ]),
      ...aggregate.signals.map((signal) =>
        signalLeafNode({ signal, scope: `author:${short}` }),
      ),
    ],
  } as WebNode;
}

type SignalsSectionProps = {
  listData: NrListData;
  profiles: Map<string, CachedProfile>;
  alias: string;
  mode: NrListMode;
};

function signalsLegend(): WebNode {
  return el('stack', { gap: 'xs' }, [
    el('text', { size: 'sm', weight: 'semibold' }, [
      text('How to read a row:'),
    ]),
    el('text', { size: 'sm', tone: 'muted' }, [
      text('matched = cached posts sharing this topic/author, incl. read'),
    ]),
    el('text', { size: 'sm', tone: 'muted' }, [
      text('signals = reviewed signals grouped here'),
    ]),
    el('text', { size: 'sm', tone: 'muted' }, [
      text(
        'total/raw = Σ weights (like +1, reply +2, repost +3, quote +2, archive +5, local_like +5, local_dislike −5)',
      ),
    ]),
    el('text', { size: 'sm', tone: 'muted' }, [
      text('affinity = Σ (weight ÷ topics per signal), drives For You ranking'),
    ]),
    el('text', { size: 'sm', tone: 'muted' }, [
      text(
        'share = topic affinity ÷ all topic affinity (authors: raw ÷ all author raw)',
      ),
    ]),
    el('text', { size: 'sm', tone: 'muted' }, [text('avg = total ÷ matched')]),
    el('text', { size: 'sm', tone: 'muted' }, [
      text('learned = 1.5 × tanh(raw / 5)'),
    ]),
  ]);
}

export function signalsSectionNode({
  listData,
  profiles,
  alias,
  mode,
}: SignalsSectionProps): WebNode[] {
  if (listData.interestSignals.length === 0) {
    return [el('text', { tone: 'muted' }, [text('No signals yet.')])];
  }

  const totalTopicAffinity = listData.signalTopicAggregates.reduce(
    (total, aggregate) => total + aggregate.affinity,
    0,
  );

  const totalAuthorRaw = listData.signalAuthorAggregates.reduce(
    (total, aggregate) => total + aggregate.totalWeight,
    0,
  );

  const topicNodes =
    listData.signalTopicAggregates.length === 0
      ? [
          el('text', { tone: 'muted', size: 'sm' }, [
            text('(no topic signals)'),
          ]),
        ]
      : listData.signalTopicAggregates.map((aggregate) =>
          signalTopicNode({
            aggregate,
            alias,
            mode,
            share:
              totalTopicAffinity === 0
                ? 0
                : aggregate.affinity / totalTopicAffinity,
          }),
        );

  const authorNodes =
    listData.signalAuthorAggregates.length === 0
      ? [
          el('text', { tone: 'muted', size: 'sm' }, [
            text('(no author signals)'),
          ]),
        ]
      : listData.signalAuthorAggregates.map((aggregate) => {
          const profile = profiles.get(aggregate.authorPubkey.toLowerCase());

          return signalAuthorNode({
            aggregate,
            authorName:
              profile?.displayName?.trim() || profile?.name?.trim() || null,
            alias,
            mode,
            share:
              totalAuthorRaw === 0 ? 0 : aggregate.totalWeight / totalAuthorRaw,
          });
        });

  const topicSection = {
    type: 'element',
    tag: 'treeItem',
    renderKey: `nr:${mode}:signals:section:topics`,
    props: {
      id: 'nr-signals-section-topics',
      defaultExpanded: true,
      filterName: 'Topics',
      filterText: 'Topics',
    },
    summary: el('row', { gap: 'xs', itemAlign: 'center', fill: true }, [
      el('countLabel', { label: 'Topics', weight: 'bold' }, []),
      el('text', { size: 'sm', tone: 'muted' }, [
        text(
          `${listData.signalTopicAggregates.length} topics · ${listData.interestSignals.length} signals`,
        ),
      ]),
    ]),
    children: topicNodes,
  } as WebNode;

  const authorSection = {
    type: 'element',
    tag: 'treeItem',
    renderKey: `nr:${mode}:signals:section:authors`,
    props: {
      id: 'nr-signals-section-authors',
      defaultExpanded: false,
      filterName: 'Authors',
      filterText: 'Authors',
    },
    summary: el('row', { gap: 'xs', itemAlign: 'center', fill: true }, [
      el('countLabel', { label: 'Authors', weight: 'bold' }, []),
      el('text', { size: 'sm', tone: 'muted' }, [
        text(`${listData.signalAuthorAggregates.length} authors`),
      ]),
    ]),
    children: authorNodes,
  } as WebNode;

  return [signalsLegend(), topicSection, authorSection];
}
