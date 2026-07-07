import type { SubcommandDefinition } from '@src/system/command-definition';

export const readDefinition = (
  prefix: string,
  alias: string,
): SubcommandDefinition => ({
  name: 'read',
  summary: 'Mark a cached event or every unread post in a topic/mood read.',
  aliases: [],
  arguments: [
    {
      name: 'event_id',
      summary: 'Nostr event id. Can also be provided with --id.',
      kind: 'string',
      required: false,
      variadic: false,
    },
  ],
  options: [
    {
      name: 'id',
      flag: '--id',
      summary: 'Nostr event id to mark read.',
      kind: 'string',
      required: false,
    },
    {
      name: 'type',
      flag: '--type',
      summary: 'Tag type to bulk mark read: topic or mood.',
      kind: 'string',
      required: false,
      choices: ['topic', 'mood'],
    },
    {
      name: 'tag',
      flag: '--tag',
      summary: 'Topic or mood tag to bulk mark read.',
      kind: 'string',
      required: false,
    },
  ],
  examples: [
    `${prefix}${alias} read <event_id>`,
    `${prefix}${alias} read --id <event_id>`,
    `${prefix}${alias} read --type topic --tag meme`,
    `${prefix}${alias} read --type mood --tag funny`,
  ],
});
