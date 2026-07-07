import type { SubcommandDefinition } from '@src/system/command-definition';

export const interactionRecordDefinition = (): SubcommandDefinition => ({
  name: 'interaction-record',
  summary: 'Record a Nostr interaction published from the web client.',
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
      name: 'interaction_event_id',
      flag: '--interaction-event-id',
      summary: 'Published interaction event id.',
      kind: 'string',
      required: true,
    },
    {
      name: 'user_pubkey',
      flag: '--user-pubkey',
      summary: 'Signer pubkey that published the interaction.',
      kind: 'string',
      required: true,
    },
    {
      name: 'type',
      flag: '--type',
      summary: 'Interaction type: liked, replied, reposted, or quoted.',
      kind: 'string',
      required: true,
    },
    {
      name: 'interaction_created_at',
      flag: '--interaction-created-at',
      summary: 'Interaction event created_at unix timestamp.',
      kind: 'integer',
      required: true,
    },
  ],
  examples: [],
});
