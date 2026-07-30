import { z } from 'zod';

const FetchEvaluateCallSchema = z.object({
  type: z.literal('fetch_evaluate'),
  window: z.literal('previous-complete-hour').default('previous-complete-hour'),
});

export const ToolCallSchema = z.discriminatedUnion('type', [
  FetchEvaluateCallSchema,
]);

export type NrToolCall = z.infer<typeof ToolCallSchema>;

export const skillDescription =
  'Fetch and evaluate recent Nostr posts from followed authors using Nostr Radar.';

export const skillRules = [
  '`fetch_evaluate` runs immediately and does not create a draft.',
  'It reads from Nostr relays and writes fetched events, classifications, cursors, and fetch status to the local Nostr Radar database.',
  '`original_prompt` is not required.',
  'The command can take several minutes; use a timeout of at least 30 minutes and wait for it to finish.',
  'Do not run it concurrently with another Nostr Radar fetch or retry an active or timed-out invocation.',
  'Do not blindly retry partial or failed fetches; report the returned coverage and error information.',
];
