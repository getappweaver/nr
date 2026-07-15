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
      summary: 'List mode: timeline, for-you, profile, or archive.',
      kind: 'string',
      required: false,
      choices: ['timeline', 'for-you', 'profile', 'archive'],
    },
    {
      name: 'kinds',
      flag: '--kinds',
      summary: 'Visible event categories for Timeline or Profile.',
      kind: 'string',
      multiple: true,
      choices: [
        'posts',
        'replies',
        'comments',
        'reposts',
        'quotes',
        'reactions',
      ],
    },
  ],
  examples: [`${prefix}${alias} list`, `${prefix}${alias} list --mode archive`],
  webWidget: {
    placement: 'right',
    surface: 'timeline_singleton',
    label: 'Nostr Radar',
    modalTitle: 'Nostr Radar',
    icon: './commands/list/renderers/list.svg',
    order: 10,
  },
});
