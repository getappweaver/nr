import type { SubcommandDefinition } from '@src/system/command-definition';

import { DEFAULT_NR_CLASSIFICATION_INSTRUCTIONS } from '../../settings';

export const settingsDefinition = (
  prefix: string,
  alias: string,
): SubcommandDefinition => ({
  name: 'settings',
  summary: 'Show or update AI settings used by nr parse.',
  aliases: ['config'],
  arguments: [],
  options: [
    {
      name: 'backend',
      flag: '--backend',
      summary: 'Backend for nr parse AI classification.',
      kind: 'string',
      required: false,
      choices: ['cursor', 'opencode'],
    },
    {
      name: 'model',
      flag: '--model',
      summary: 'Model override for nr parse AI classification.',
      kind: 'string',
      required: false,
    },
    {
      name: 'instructions',
      flag: '--instructions',
      summary: 'Classification instructions for nr parse.',
      kind: 'string',
      required: false,
      webInput: 'textarea',
      webDefaultValue: DEFAULT_NR_CLASSIFICATION_INSTRUCTIONS,
    },
    {
      name: 'reset',
      flag: '--reset',
      summary: 'Clear backend, model, and instructions overrides.',
      kind: 'boolean',
      required: false,
    },
  ],
  examples: [
    `${prefix}${alias} settings`,
    `${prefix}${alias} settings --backend opencode --model openrouter/google/gemini-2.0-flash-exp:free`,
    `${prefix}${alias} settings --reset`,
  ],
});
