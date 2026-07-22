---
direct_hash: 1795901f4065a25b1901507fafd7e72ec9a9af98aa42d9aa5ed1dfe954558904
subtree_hash: d8df1aa23594724e46361679549cd260e66810f288339c0e8ff069c88dfd9620
enriched: true
enriched_version: 1
files:
  adapter.ts: 754329f3c489715f8d4fe8b17346ff2ed699c897cd537a115f9f3decd770e213
  definition.ts: 5d370c4bf3d6ad1515ffdc92f9b00064c2fb33c1fa1e32afc18ccb962d868be0
children:
---

# commands/parse

## Purpose
Defines the `parse` subcommand for ingesting one raw Nostr event. It validates input, resolves related context, classifies and caches the event, then reports the result.

## Files
- `adapter.ts` - Executes parse-command validation, context retrieval, AI classification, caching, and text result formatting.
- `definition.ts` - Declares the parse subcommand’s event JSON argument and reclassification/instructions options.

## Notes
- Missing thread or referenced events defer ingestion rather than storing incomplete context.
