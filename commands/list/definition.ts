import type { SubcommandDefinition } from '@src/system/command-definition';

export const listDefinition = (
  prefix: string,
  alias: string,
): SubcommandDefinition => ({
  name: 'list',
  summary:
    'List cached Nostr Radar items or recent activity from your write relays.',
  aliases: [],
  arguments: [],
  options: [
    {
      name: 'mode',
      flag: '--mode',
      summary: 'List mode: timeline, for-you, profile, archive, or signals.',
      kind: 'string',
      required: false,
      choices: ['timeline', 'for-you', 'profile', 'archive', 'signals'],
    },
    {
      name: 'kinds',
      flag: '--kinds',
      summary: 'Visible event categories for Timeline, For You, or Profile.',
      kind: 'string',
      multiple: true,
      choices: [
        'posts',
        'replies',
        'comments',
        'highlights',
        'reposts',
        'quotes',
        'reactions',
      ],
    },
    {
      name: 'local_mutation',
      flag: '--local-mutation',
      summary: 'Internal cached refresh after a local NR mutation.',
      kind: 'boolean',
      required: false,
    },
    {
      name: 'time_range',
      flag: '--time-range',
      summary:
        'Selected half-open event time range encoded as since:until. Repeat to select multiple ranges.',
      kind: 'string',
      multiple: true,
      required: false,
    },
    {
      name: 'time_filter_initialized',
      flag: '--time-filter-initialized',
      summary:
        'Marks the time filter as initialized; with no ranges, keeps the list explicitly unfiltered.',
      kind: 'boolean',
      required: false,
    },
  ],
  examples: [
    `${prefix}${alias} list`,
    `${prefix}${alias} list --mode archive`,
    `${prefix}${alias} list --mode signals`,
  ],
  monitoring: { name: 'nr.list', attributes: {} },
  webWidget: {
    placement: 'right',
    surface: 'timeline_singleton',
    label: 'Nostr Radar',
    modalTitle: 'Nostr Radar',
    icon: './commands/list/renderers/list.svg',
    order: 10,
  },
});
