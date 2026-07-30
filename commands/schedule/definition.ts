import type { SubcommandDefinition } from '@src/system/command-definition';

export const scheduleDefinition = (
  prefix: string,
  alias: string,
): SubcommandDefinition => ({
  name: 'schedule',
  summary: 'Schedule or show the recurring fetch-and-evaluate job.',
  aliases: [],
  arguments: [],
  options: [
    {
      name: 'provider',
      flag: '--provider',
      summary: 'Explicit scheduler provider id.',
      kind: 'string',
      required: false,
    },
  ],
  examples: [`${prefix}${alias} schedule`],
});
