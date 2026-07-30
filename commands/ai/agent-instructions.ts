export function agentInstructions(alias: string): string {
  return `## Nostr Radar (${alias} tools)

Use \`fetch_evaluate\` to fetch and classify posts from followed Nostr authors for the previous completed hourly timeline slot.

The tool computes the exact hour boundaries at execution time, updates local Nostr Radar data immediately, and returns a fetch and evaluation summary. It does not create a draft.

The command can take several minutes. Run it with a timeout of at least 30 minutes and wait for the existing invocation to finish.

Do not run concurrent Nostr Radar fetches or retry an active, partial, failed, or timed-out invocation.`;
}
