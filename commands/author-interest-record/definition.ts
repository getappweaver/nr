import type { SubcommandDefinition } from '@src/system/command-definition';

export const authorInterestRecordDefinition = (): SubcommandDefinition => ({
  name: 'author-interest-record',
  summary: 'Record a private author preference for this NR instance.',
  aliases: [],
  arguments: [],
  options: [
    {
      name: 'pubkey',
      flag: '--pubkey',
      summary: 'Target author pubkey.',
      kind: 'string',
      required: true,
    },
    {
      name: 'preference',
      flag: '--preference',
      summary: 'Private author recommendation preference.',
      kind: 'string',
      required: true,
      choices: ['like', 'dislike', 'none'],
    },
  ],
  examples: [],
});
