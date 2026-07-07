import type { SubcommandDefinition } from '@src/system/command-definition';

export const contextDefinition = (
  prefix: string,
  alias: string,
): SubcommandDefinition => ({
  name: 'context',
  summary: 'Show existing topic and mood tags for AI classification context.',
  aliases: [],
  arguments: [],
  options: [],
  examples: [`${prefix}${alias} context`],
});
