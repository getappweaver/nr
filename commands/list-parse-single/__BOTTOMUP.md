---
direct_hash: 297d2bde8cd9cf8e47590b51914d79c5e377d3db871d9f337d554d991590b746
subtree_hash: 300708077961577fce5f4c10ce6cada5f6a4ba2d813069eaeda2fb3321ede3a6
files:
  adapter.ts: d423f0203279287d6aa5878d491bd64b1402afbc835dfb2087d7fa000efb8f60
  definition.ts: 84730b03abe5b1aea982a356d4dd1205e8bb52055f4a7fcce3d1a3d5f427f14c
children:
---

# commands/list-parse-single

## Purpose
Implements the `debug` subcommand for parsing, contextualizing, classifying, and displaying one pasted Nostr event. It supports text and web responses.

## Files
- `adapter.ts` - Validates a pasted event, resolves its context, stores and optionally reclassifies it, then renders text or web results.
- `definition.ts` - Declares the debug command arguments, classification options, aliases, and example usage.

## Notes
- Missing thread or referenced events defer processing.
