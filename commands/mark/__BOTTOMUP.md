---
direct_hash: 53294ac1cf240390bdda7473e4e8164381258aae3d7d91ab2170a43d225485f4
subtree_hash: 86d6ff21db380524ae2f1a8e0e1bf243e3515b2c909a66b9f7a08be2e4ff87cb
enriched: true
enriched_version: 1
files:
  adapter.ts: a10217f50773f38c3f2b8155537cb9e0c5f0492c59ec35e368431195b1006729
  definition.ts: bedb3a9d49fec4dd29d58a8b54798cd6a686dcf1afb7be2e73adfe723ec3c71d
children:
---

# commands/mark

## Purpose
Implements the `mark` Nr subcommand for changing cached event read/archive state. It supports single-event updates, topic/mood bulk updates, and optional cache hydration from supplied event JSON.

## Files
- `adapter.ts` - Validates mark inputs, updates cached event or tag-matched state, and reports command results.
- `definition.ts` - Declares the mark command arguments, state flags, bulk-tag options, and usage examples.

## Notes
- Archive actions record an Nr interest signal.
- Exactly one state flag is required per command.
