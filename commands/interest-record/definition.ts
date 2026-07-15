import type { SubcommandDefinition } from '@src/system/command-definition';

export const interestRecordDefinition = (): SubcommandDefinition => ({
  name: 'interest-record',
  summary: 'Record a private interest signal for this NR instance.',
  aliases: [],
  arguments: [],
  options: [
    {
      name: 'target_event_id',
      flag: '--target-event-id',
      summary: 'Target Nostr event id.',
      kind: 'string',
      required: true,
    },
    {
      name: 'preference',
      flag: '--preference',
      summary: 'Private recommendation preference.',
      kind: 'string',
      required: true,
      choices: ['like', 'dislike', 'none'],
    },
  ],
  examples: [],
});
