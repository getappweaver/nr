---
direct_hash: efb622da0cfc167c5c0800142c37c94248aab3d369bc30b6e0a7e7597793decd
subtree_hash: 309ff304285394e980e26d65e10624ec7d92d7587e4f824523f001dfcb6cb5c8
enriched: true
enriched_version: 1
files:
  adapter.ts: 59bd9a90b96fcc5d9d4fa6bae6ddc1c6c7dba8125c43e77005bfe2eeaef2d526
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
