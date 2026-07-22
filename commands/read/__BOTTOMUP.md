---
direct_hash: 83832c61ac87024a9a30dd7864eef9984c070a95c69ef68298e8e1fc87c0641e
subtree_hash: 001fda7e0fc576ebaa5c9c57adc6b8a039410b835f3817d4a31b06fac1bf8061
enriched: true
enriched_version: 1
files:
  adapter.ts: 8eb29bd3b80eecdc1f0417193c2a049b5f7ef977bceeb9ef8b460ebd6ce9122e
  definition.ts: 4b254f3e6046d1425ed715824abf5952e7a8e220f916bb0afc5067cc71789c92
children:
---

# commands/read

## Purpose
Defines the `read` subcommand for marking cached Nostr events as read. It supports a single event ID or bulk updates scoped to a topic or mood tag.

## Files
- `adapter.ts` - Validates read-command input, updates cached event read state, and returns usage or result messages.
- `definition.ts` - Declares the read subcommand’s arguments, tag-filter options, help text, and examples.

## Notes
- Bulk reads require both `--type` and `--tag`; event IDs cannot be combined with tag options.
