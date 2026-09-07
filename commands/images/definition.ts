import type { SubcommandDefinition } from '@src/system/command-definition';

export const imagesDefinition = (
  prefix: string,
  alias: string,
): SubcommandDefinition => ({
  name: 'images',
  summary: 'Show cached image evaluations for a Nostr event.',
  aliases: [],
  arguments: [
    {
      name: 'event_id',
      summary: 'Nostr event ID.',
      kind: 'string',
      required: true,
    },
  ],
  options: [],
  examples: [`${prefix}${alias} images <event_id>`],
});
