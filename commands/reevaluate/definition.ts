import type { SubcommandDefinition } from '@src/system/command-definition';

export const reevaluateDefinition = (
  prefix: string,
  alias: string,
): SubcommandDefinition => ({
  name: 'reevaluate',
  summary: 'Re-run classification for one cached event.',
  aliases: ['reclassify'],
  arguments: [
    {
      name: 'event_id',
      summary: 'Nostr event id.',
      kind: 'string',
      required: true,
      variadic: false,
    },
  ],
  options: [],
  examples: [`${prefix}${alias} reevaluate <event_id>`],
});
