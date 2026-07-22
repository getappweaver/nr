---
direct_hash: 4890f64685daf3ab72e85957328e06cec1e2fd668da4bfc1a6f17e8da5e3227e
subtree_hash: a7532351f866cb61eb43d0ae40207b06c2370bfc59e481eef40a6b5d225caec6
enriched: true
enriched_version: 1
files:
  adapter.ts: e3c7170d2c0bcb5f5be24a419c2baf05498d799f4e078eec254f17ff378375e4
  definition.ts: a5e0faecf3731128a3e191f1db3aebbf8aacd7d1a0f6e36780c0f6692da52e4f
children:
---

# commands/reevaluate

## Purpose
Defines the `reevaluate` NR subcommand for forcing AI classification to run again on one Nostr event. It supports cached events and optionally supplied raw event JSON.

## Files
- `adapter.ts` - Handles reevaluation by resolving event context, forcing storage and AI classification, then formatting the updated result.
- `definition.ts` - Declares the `reevaluate`/`reclassify` command, event ID argument, and internal raw-event option.

## Notes
- Reevaluation defers when required thread or referenced context cannot be resolved.
- The adapter refreshes nested reference context before storing the forced classification result.
