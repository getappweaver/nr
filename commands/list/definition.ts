import type { SubcommandDefinition } from '@src/system/command-definition';

export const listDefinition = (
  prefix: string,
  alias: string,
): SubcommandDefinition => ({
  name: 'list',
  summary:
    'List timeline or archived cached posts grouped by topic tags and mood tags.',
  aliases: [],
  arguments: [],
  options: [
    {
      name: 'mode',
      flag: '--mode',
      summary: 'List mode: timeline or archive.',
      kind: 'string',
      required: false,
      choices: ['timeline', 'archive'],
    },
  ],
  examples: [`${prefix}${alias} list`, `${prefix}${alias} list --mode archive`],
});
