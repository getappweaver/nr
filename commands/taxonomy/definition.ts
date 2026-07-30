import type { SubcommandDefinition } from '@src/system/command-definition';

export const taxonomyDefinition = (): SubcommandDefinition => ({
  name: 'taxonomy',
  summary: 'Manage manually preferred topic/mood terms for classification.',
  aliases: [],
  arguments: [],
  options: [
    {
      name: 'type',
      flag: '--type',
      summary: 'Term type to edit: topic or mood.',
      kind: 'string',
      required: true,
      choices: ['topic', 'mood'],
    },
    {
      name: 'mode',
      flag: '--mode',
      summary: 'Editor mode: edit, save, or add.',
      kind: 'string',
      required: false,
      choices: ['edit', 'save', 'add'],
    },
    {
      name: 'active_tags',
      flag: '--active-tags',
      summary: 'Active manual tags to keep enabled.',
      kind: 'string',
      required: false,
      multiple: true,
    },
    {
      name: 'new_tag',
      flag: '--new-tag',
      summary: 'Optional new manual tag to add.',
      kind: 'string',
      required: false,
    },
  ],
  examples: [
    '/nr taxonomy --type topic',
    '/nr taxonomy --type mood --mode save --active-tags funny --new-tag serious',
    '/nr taxonomy --type topic --mode add --new-tag nostr',
  ],
});
