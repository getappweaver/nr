import type { SubcommandDefinition } from '@src/system/command-definition';

import { DEFAULT_NR_CLASSIFICATION_INSTRUCTIONS } from '../../settings';

export const fetchLatestDefinition = (
  prefix: string,
  alias: string,
): SubcommandDefinition => ({
  name: 'fetch-latest',
  summary: 'Fetch kind 1 notes from your follows and classify them.',
  aliases: ['latest', 'fetch'],
  arguments: [],
  options: [
    {
      name: 'people',
      flag: '--people',
      summary:
        'Optional maximum followed pubkeys to use. Omit for all follows.',
      kind: 'integer',
      required: false,
    },
    {
      name: 'since_hours',
      flag: '--since-hours',
      summary: 'How far back to fetch notes when --since is omitted.',
      kind: 'integer',
      required: false,
      webDefaultValue: 1,
    },
    {
      name: 'since',
      flag: '--since',
      summary: 'Unix timestamp in seconds for the start of the fetch window.',
      kind: 'integer',
      required: false,
    },
    {
      name: 'until',
      flag: '--until',
      summary: 'Unix timestamp in seconds for the end of the fetch window.',
      kind: 'integer',
      required: false,
    },
    {
      name: 'limit',
      flag: '--limit',
      summary: 'Maximum fetched events to inspect before skipping cached ones.',
      kind: 'integer',
      required: false,
      webDefaultValue: 50,
    },
    {
      name: 'instructions',
      flag: '--instructions',
      summary: 'One-off classification instructions for fetched events.',
      kind: 'string',
      required: false,
      webInput: 'textarea',
      webDefaultValue: DEFAULT_NR_CLASSIFICATION_INSTRUCTIONS,
    },
  ],
  examples: [
    `${prefix}${alias} fetch-latest --since-hours 1`,
    `${prefix}${alias} fetch --since 1783090800 --until 1783094400`,
  ],
});
