import type { SubcommandDefinition } from '@src/system/command-definition';

export const signalDeleteDefinition = (): SubcommandDefinition => ({
  name: 'signal-delete',
  summary: 'Delete Nostr Radar interest signals for one topic or author.',
  aliases: [],
  arguments: [],
  options: [
    {
      name: 'topic',
      flag: '--topic',
      summary: 'Delete every signal tagged with this topic.',
      kind: 'string',
      required: false,
    },
    {
      name: 'author_pubkey',
      flag: '--author-pubkey',
      summary: 'Delete every signal attributed to this author pubkey.',
      kind: 'string',
      required: false,
    },
  ],
  examples: [],
});
