import type { CachedProfile } from '@src/db';
import type { WebNode, WebNodeRoot } from '@src/web/ui-schema';

import { nrSharePrefixes, type NrSettings } from '../../../settings';

import { el, eventNode, text } from '../../list/renderers/web';
import type { NrEvent, NrInteraction } from '../../shared/types';

type RenderNrListParseSingleWebProps = {
  alias: string;
  settings: NrSettings;
  profiles: Map<string, CachedProfile>;
  event: NrEvent | null;
  interactions: NrInteraction[];
  message: string | null;
};

function countContextEvents(rawJson: string): number {
  try {
    const parsed = JSON.parse(rawJson) as unknown;

    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function interactionSummary({
  event,
  interactions,
}: {
  event: NrEvent;
  interactions: NrInteraction[];
}): string {
  const types = [
    ...new Set(
      interactions
        .filter((interaction) => interaction.targetEventId === event.id)
        .map((interaction) => interaction.type),
    ),
  ];

  return types.length > 0 ? types.join(', ') : '(none)';
}

function parseSingleForm({
  alias,
  settings,
  defaultExpanded,
}: {
  alias: string;
  settings: NrSettings;
  defaultExpanded: boolean;
}): WebNode {
  return el(
    'treeItem',
    {
      id: 'nr-list-parse-single-form',
      defaultExpanded,
      filterName: 'Parse single event',
      filterText: 'parse single event json',
    },
    [
      el(
        'form',
        {
          className: 'web-form web-form--stacked nr-fetch-form',
          formOptionFieldNames: ['force_reclassify', 'instructions'],
          action: {
            type: 'command',
            command: alias,
            subcommand: 'debug',
            arguments: {},
            options: {},
            recordInTimeline: true,
          },
        },
        [
          el('text', { weight: 'semibold' }, [text('Parse single event')]),
          el('text', { tone: 'muted', size: 'sm' }, [
            text(
              `Backend: ${settings.backend ?? '(default)'} · Model: ${
                settings.model ?? '(default)'
              }`,
            ),
          ]),
          el(
            'textArea',
            {
              formFieldName: 'event_json',
              inputPlaceholder: 'paste raw Nostr event JSON',
              value: '',
              maxRows: 14,
            },
            [],
          ),
          el(
            'textArea',
            {
              formFieldName: 'instructions',
              inputPlaceholder: 'classification instructions',
              value: settings.instructions,
              maxRows: 10,
            },
            [],
          ),
          el('row', { gap: 'xs', className: 'web-form__actions' }, [
            el('button', { label: 'Parse', htmlType: 'submit' }, []),
          ]),
        ],
      ),
    ],
  );
}

export function renderNrListParseSingleWeb({
  alias,
  settings,
  profiles,
  event,
  interactions,
  message,
}: RenderNrListParseSingleWebProps): WebNodeRoot {
  return {
    kind: 'ui',
    version: 1,
    meta: {
      command: alias,
      subcommand: 'debug',
    },
    tree: el('stack', { gap: 'sm' }, [
      el('row', { gap: 'xs', align: 'between', itemAlign: 'center' }, [
        el('stack', { gap: 'xs' }, [
          el('text', { weight: 'bold' }, [text('Nostr radar')]),
          el('text', { tone: 'muted', size: 'sm' }, [
            text('Parse one pasted event and render it with related context'),
          ]),
        ]),
      ]),
      parseSingleForm({ alias, settings, defaultExpanded: event === null }),
      ...(message
        ? [
            el('text', { tone: event ? 'muted' : 'warning', size: 'sm' }, [
              text(message),
            ]),
          ]
        : []),
      ...(event
        ? [
            el('text', { tone: 'muted', size: 'sm' }, [
              text(
                `Thread events: ${countContextEvents(
                  event.thread_context_json,
                )} · Referenced events: ${countContextEvents(
                  event.referenced_events_json,
                )} · Interactions: ${interactionSummary({
                  event,
                  interactions,
                })}`,
              ),
            ]),
            {
              type: 'element' as const,
              tag: 'tree' as const,
              renderKey: 'nr:parse-single:tree',
              props: {
                gap: 'xs' as const,
                filterable: true as const,
                filterPlaceholder: 'Filter parsed post',
              },
              children: [
                eventNode({
                  alias,
                  event,
                  profiles,
                  showReplyContext: true,
                  interactions,
                  localPreferences: new Map(),
                  authorPreferences: new Map(),
                  sharePrefixes: nrSharePrefixes(settings),
                  translationTargetLanguage:
                    settings.translationTargetLanguage ?? 'en',
                  rankingScore: null,
                  resolveReferencesAutomatically:
                    settings.alwaysResolveUnresolvedReferences,
                  mode: 'timeline',
                  renderScope: 'parse-single',
                }),
              ],
            },
          ]
        : []),
    ]),
  };
}
