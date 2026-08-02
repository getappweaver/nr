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
    {
      name: 'event_share_prefix',
      flag: '--event-share-prefix',
      summary: 'Event share URL prefix or template containing [nevent].',
      kind: 'string',
      required: false,
    },
    {
      name: 'profile_share_prefix',
      flag: '--profile-share-prefix',
      summary: 'Profile share URL prefix or template containing [nprofile].',
      kind: 'string',
      required: false,
    },
    {
      name: 'translation_target_language',
      flag: '--translation-target-language',
      summary: 'BCP 47 target language for post translation (default: en).',
      kind: 'string',
      required: false,
    },
    {
      name: 'hourly_scheduler',
      flag: '--hourly-scheduler',
      summary: 'Create an hourly scheduler to fetch and evaluate Nostr posts.',
      kind: 'boolean',
      required: false,
    },
    {
      name: 'filter_to_latest_fetched_slot_on_open',
      flag: '--filter-to-latest-fetched-slot-on-open',
      summary:
        'Select the latest fetched or partially fetched hour when Nostr Radar first opens.',
      kind: 'string',
      required: false,
      choices: ['enabled', 'disabled'],
    },
    {
      name: 'relay_fetch_concurrency',
      flag: '--relay-fetch-concurrency',
      summary: 'Maximum relay-author groups fetched concurrently.',
      kind: 'integer',
      required: false,
    },
    {
      name: 'ai_evaluation_concurrency',
      flag: '--ai-evaluation-concurrency',
      summary: 'Maximum AI evaluations run concurrently.',
      kind: 'integer',
      required: false,
    },
  ],
  examples: [
    `${prefix}${alias} settings`,
    `${prefix}${alias} settings --backend opencode --model openrouter/google/gemini-2.0-flash-exp:free`,
    `${prefix}${alias} settings --reset`,
  ],
});
