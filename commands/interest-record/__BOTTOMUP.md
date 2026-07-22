---
direct_hash: 5d7f02160f4241cbfb95ce78b560d6963d1be1933ef494095130e38f7c0dcd16
subtree_hash: 8d8b213b957052ac19dc60997084e46431c6c8fe957c7e1b8088e235d0b1ab41
enriched: true
enriched_version: 1
files:
  adapter.ts: 86141213d260b548f32415e90cf3c1123720a6a5aaaf403df9264f8b1c289e9d
  definition.ts: c35b657f892850e58076dd8ecd6de3311738cd3eebb86a5c0b092843666a22ad
children:
---

# commands/interest-record

## Purpose
Defines the `interest-record` NR subcommand for storing a local private preference on a target Nostr event.

## Files
- `adapter.ts` - Validates parsed interest fields and persists the local event preference.
- `definition.ts` - Declares the interest-record command, its required target event and preference options.

## Notes
- Preferences are limited to like, dislike, or none.
