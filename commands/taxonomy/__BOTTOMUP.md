---
direct_hash: d7ec766f6a4386a40321fd1f4199439bfaa84d6c811a2790915f078cf4648e29
subtree_hash: 5db5f6c3f9f1cc2f059026acbc5dd1ed2c917ae74262229fc82d9540b3d344a0
enriched: true
enriched_version: 1
files:
  adapter.ts: bea8d8abddf452f56bb17c49fb08d8b3e46ff94b1272312934982a1028e3cf45
  definition.ts: 55f456b8d821f161c4c9f6465b9e636f34cd16a695ffda90ad89e6b7e85b5405
children:
---

# commands/taxonomy

## Purpose
Implements the `taxonomy` subcommand for managing interested/uninterested topic preferences and manual mood terms used by classification. It defines the command contract and adapts it for text and web-based editing.

## Files
- `adapter.ts` - Handles taxonomy validation, preference-aware persistence, text responses, and the two-section interested/uninterested topic editor.
- `definition.ts` - Declares taxonomy and topic-preference options, usage examples, and help metadata.

## Notes
- Topic web requests render dense interested and uninterested checkbox sections with separate add fields; mood editing remains a single list.
- Existing manual terms migrate to interested by default, and saving preferences does not rewrite existing post tags.
