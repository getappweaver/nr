import type { SubcommandDefinition } from '@src/system/command-definition';

export const signalReviewDefinition = (): SubcommandDefinition => ({
  name: 'signal-review',
  summary: 'Render a web-only Nostr Radar signal review form.',
  aliases: [],
  arguments: [],
  options: [
    {
      name: 'target_event_id',
      flag: '--target-event-id',
      summary: 'Canonical target event id to review.',
      kind: 'string',
      required: true,
    },
    {
      name: 'action_category',
      flag: '--action-category',
      summary: 'Action category being reviewed.',
      kind: 'string',
      required: true,
      choices: [
        'archive',
        'like',
        'reply',
        'repost_quote',
        'local_like',
        'local_dislike',
      ],
    },
    {
      name: 'target_author_label',
      flag: '--target-author-label',
      summary: 'Display label for the target author.',
      kind: 'string',
      required: false,
    },
    {
      name: 'target_author_pubkey',
      flag: '--target-author-pubkey',
      summary:
        'Trusted web-rendered target author fallback for uncached targets.',
      kind: 'string',
      required: false,
    },
    {
      name: 'target_event_json',
      flag: '--target-event-json',
      summary: 'Verified raw target event fallback for referenced posts.',
      kind: 'string',
      required: false,
    },
    {
      name: 'candidate_topics',
      flag: '--candidate-topic',
      summary:
        'Trusted web-rendered candidate topic fallback for uncached targets.',
      kind: 'string',
      required: false,
      multiple: true,
    },
    {
      name: 'list_mode',
      flag: '--list-mode',
      summary: 'List mode to refresh after review completion.',
      kind: 'string',
      required: false,
      choices: ['timeline', 'for-you', 'profile', 'archive'],
    },
  ],
  examples: [],
});
