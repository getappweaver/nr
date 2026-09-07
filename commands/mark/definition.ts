import type { SubcommandDefinition } from '@src/system/command-definition';

export const markDefinition = (
  prefix: string,
  alias: string,
): SubcommandDefinition => ({
  name: 'mark',
  summary:
    'Mark a cached event or every matching topic/mood as read, unread, archived, or unarchived.',
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
      summary: 'Nostr event id to mark.',
      kind: 'string',
      required: false,
    },
    {
      name: 'read',
      flag: '--read',
      summary: 'Mark as read.',
      kind: 'boolean',
      required: false,
    },
    {
      name: 'unread',
      flag: '--unread',
      summary: 'Mark as unread.',
      kind: 'boolean',
      required: false,
    },
    {
      name: 'archived',
      flag: '--archived',
      summary: 'Mark as archived.',
      kind: 'boolean',
      required: false,
    },
    {
      name: 'unarchived',
      flag: '--unarchived',
      summary: 'Mark as unarchived.',
      kind: 'boolean',
      required: false,
    },
    {
      name: 'type',
      flag: '--type',
      summary: 'Tag type to bulk mark: topic or mood.',
      kind: 'string',
      required: false,
      choices: ['topic', 'mood'],
    },
    {
      name: 'tag',
      flag: '--tag',
      summary: 'Topic or mood tag to bulk mark.',
      kind: 'string',
      required: false,
    },
    {
      name: 'event_json',
      flag: '--event-json',
      summary: 'Internal raw Nostr event JSON to cache before marking.',
      kind: 'string',
      required: false,
    },
    {
      name: 'event_ids',
      flag: '--event-ids',
      summary: 'Internal comma-separated event IDs to mark together.',
      kind: 'string',
      required: false,
    },
  ],
  examples: [
    `${prefix}${alias} mark <event_id> --read`,
    `${prefix}${alias} mark <event_id> --archived`,
    `${prefix}${alias} mark --id <event_id> --unarchived`,
    `${prefix}${alias} mark --type topic --tag meme --read`,
    `${prefix}${alias} mark --type mood --tag funny --archived`,
  ],
});
