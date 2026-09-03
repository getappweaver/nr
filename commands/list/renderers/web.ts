import type { CapabilityResourceRef } from '@src/capabilities/types';
import type { PluginAgentDefaults } from '@src/core/plugin';
import type { CachedProfile } from '@src/db';
import type {
  WebNode,
  WebNodeRoot,
  WebTreeTimeRange,
} from '@src/web/ui-schema';

import { nrSharePrefixes } from '../../../settings';

import { NR_FETCH_STATUS_TARGET_ID } from '../../fetch-status';
import type {
  NrAuthorPreferenceValue,
  NrListData,
  NrListMode,
  NrListTimeRange,
} from '../../shared/types';

import {
  NR_FEED_CATEGORIES,
  NR_FEED_CATEGORY_LABELS,
  type NrFeedCategory,
} from '../categories';
import {
  nrListCommandAction,
  nrListCommandOptions,
  nrListTimeRangeKey,
} from '../list-options';

import { archiveNodes } from './archive';
import type { ListModeNodesProps } from './event-nodes';
import {
  fetchCoverageBar,
  fetchCoverageStylesheet,
  NR_TIMELINE_TIME_FILTER_GROUP,
} from './fetch-coverage';
import { forYouNodes } from './for-you';
import { el, keyed, text } from './primitives';
import { profileNodes } from './profile';
import { signalsSectionNode } from './signals';
import { timelineNodes } from './timeline';

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
  agentDefaults: PluginAgentDefaults;
  effectiveModel: string;
  schedulerResource: CapabilityResourceRef | null;
  profiles: Map<string, CachedProfile>;
};

function agentSettingsAction(alias: string) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'settings',
    arguments: {},
    options: { agent: true },
    surface: 'modal' as const,
    modalTitle: 'Nostr radar AI settings',
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
      el(
        'button',
        {
          label: 'Signals',
          className: `web-button widget-tab${mode === 'signals' ? ' active' : ''}`,
          action: nrListCommandAction({
            alias,
            mode: 'signals',
            selectedTimeRanges,
          }),
        },
        [],
      ),
    ],
  );
}

export function renderNrListWeb({
  alias,
  listData,
  agentDefaults,
  effectiveModel,
  schedulerResource,
  profiles,
}: RenderNrListWebProps): WebNodeRoot {
  const localPreferences = new Map<string, 'like' | 'dislike'>();
  const sharePrefixes = nrSharePrefixes(listData.settings);

  const translationTargetLanguage =
    listData.settings.translationTargetLanguage ?? 'en';

  const effectiveBackend = listData.settings.backend ?? agentDefaults.backend;

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

  const modeNodesProps: ListModeNodesProps = {
    alias,
    topicGroups: listData.topicGroups,
    moodGroups: listData.moodGroups,
    languageGroups: listData.languageGroups,
    forYouEvents: listData.forYouEvents,
    forYouHasMore: listData.forYouHasMore,
    profileEvents: listData.profileEvents,
    profiles,
    interactions: listData.interactions,
    localPreferences,
    authorPreferences,
    sharePrefixes,
    translationTargetLanguage,
    rankingScores: listData.forYouScores,
    archiveSignalReviewMode: listData.settings.archiveSignalReviewMode,
    likeSignalReviewMode: listData.settings.likeSignalReviewMode,
    replySignalReviewMode: listData.settings.replySignalReviewMode,
    repostQuoteSignalReviewMode: listData.settings.repostQuoteSignalReviewMode,
    resolveReferencesAutomatically:
      listData.settings.alwaysResolveUnresolvedReferences,
    mode: listData.mode,
    selectedTimeRanges: listData.selectedTimeRanges,
  };

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
        el('row', { gap: 'xs', itemAlign: 'center' }, [
          text(`Backend ${effectiveBackend}, Model ${effectiveModel}`),
          el(
            'button',
            {
              label: 'Manage',
              className: 'web-button--link',
              action: agentSettingsAction(alias),
            },
            [],
          ),
        ]),
        ...(listData.mode !== 'archive' && listData.mode !== 'signals'
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
            filterPlaceholder:
              listData.mode === 'signals'
                ? 'Filter signals, topics, authors'
                : 'Filter tags, moods, posts',
            toolbarActions: [
              ...(listData.mode !== 'archive' && listData.mode !== 'signals'
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
              ? profileNodes(modeNodesProps)
              : []),
            ...(listData.mode === 'for-you' ? forYouNodes(modeNodesProps) : []),
            ...(listData.mode === 'signals'
              ? signalsSectionNode({
                  listData,
                  profiles,
                  alias,
                  mode: listData.mode,
                })
              : []),
            ...(listData.mode === 'timeline'
              ? timelineNodes(modeNodesProps)
              : []),
            ...(listData.mode === 'archive'
              ? archiveNodes(modeNodesProps)
              : []),
          ],
        },
      ]),
    ),
  };
}
