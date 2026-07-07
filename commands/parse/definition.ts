import type { SubcommandDefinition } from '@src/system/command-definition';

import { DEFAULT_NR_CLASSIFICATION_INSTRUCTIONS } from '../../settings';

export const parseDefinition = (
  prefix: string,
  alias: string,
): SubcommandDefinition => ({
  name: 'parse',
  summary: 'Parse one raw Nostr event JSON, classify it, and cache it unread.',
  aliases: [],
  arguments: [
    {
      name: 'event_json',
      summary: 'Raw Nostr event JSON.',
      kind: 'string',
      required: true,
      variadic: true,
      webInput: 'textarea',
    },
  ],
  options: [
    {
      name: 'force_reclassify',
      flag: '--force-reclassify',
      summary: 'Re-run classification even if the event is already cached.',
      kind: 'boolean',
      required: false,
    },
    {
      name: 'instructions',
      flag: '--instructions',
      summary: 'One-off classification instructions for this event.',
      kind: 'string',
      required: false,
      webInput: 'textarea',
      webDefaultValue: DEFAULT_NR_CLASSIFICATION_INSTRUCTIONS,
    },
  ],
  examples: [`${prefix}${alias} parse '{"id":"...","kind":1,...}'`],
});
