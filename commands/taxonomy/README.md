# commands/taxonomy

## Purpose
Implements the `taxonomy` subcommand for managing interested/uninterested topic preferences and manual mood terms used by classification. It defines the command contract and adapts it for text and web-based editing.

## Files
- `adapter.ts` - Handles taxonomy validation, preference-aware persistence, text responses, and the two-section interested/uninterested topic editor.
- `definition.ts` - Declares taxonomy and topic-preference options, usage examples, and help metadata.

## Notes
- Topic web requests render dense interested and uninterested checkbox sections with separate add fields; mood editing remains a single list.
- Existing manual terms migrate to interested by default, and saving preferences does not rewrite existing post tags.
