import type { SubcommandDefinition } from '@src/system/command-definition';

export const authorInterestActionsDefinition = (): SubcommandDefinition => ({
  name: 'author-interest-actions',
  summary: 'Read current private author preference actions for a profile.',
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
      name: 'mode',
      flag: '--mode',
      summary: 'NR list mode to refresh after mutation.',
      kind: 'string',
      required: true,
      choices: ['timeline', 'archive', 'for-you', 'profile'],
    },
  ],
  examples: [],
});
