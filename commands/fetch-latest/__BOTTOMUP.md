---
direct_hash: 385e36e49748bd1ef57696e6bb8f7ba574218d474f0720643ab69c7dd6a18789
subtree_hash: 1b5bbe579b14d36b9c8a33f207d12b2e0836d53a62334f1e7a612692e1d9eb19
files:
  adapter.ts: fc88e6575fc955e5249b09535c5b62a9c8b16678a40777f954cfe29eeee7f881
  definition.ts: b100adcbaccdcf3a5accc067dd9a08339ac114118c0634f9f9f671225ec80220
children:
---

# commands/fetch-latest

## Purpose
Implements the Nr `fetch-latest` command, which retrieves recent activity from followed Nostr accounts, resolves context, classifies events, and persists results. It supports resumable relay pagination and web progress updates.

## Files
- `adapter.ts` - Command adapter that fetches followed authors’ events across relays, processes queued context-aware classification, records resumable progress, and returns a detailed fetch summary.
- `definition.ts` - Declares the `fetch-latest` command, its aliases, time-window and limit options, classification-instruction input, and usage examples.

## Notes
- Fetch state and evaluation queues are persisted through the Nr database layer.
- Classification instructions can be overridden per command invocation.
