import type { SubcommandDefinition } from '@src/system/command-definition';

import { DEFAULT_NR_CLASSIFICATION_INSTRUCTIONS } from '../../settings';

export const listParseSingleDefinition = (
  prefix: string,
  alias: string,
): SubcommandDefinition => ({
  name: 'debug',
  summary:
    'Show a list-style parser for one pasted event JSON and its related context.',
  aliases: ['list-parse-single'],
  arguments: [
    {
      name: 'event_json',
      summary: 'Raw Nostr event JSON to parse.',
      kind: 'string',
      required: false,
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
  examples: [`${prefix}${alias} debug`],
});
