# commands/parse

## Purpose
Defines the `parse` subcommand for ingesting one raw Nostr event. It validates input, resolves related context, classifies and caches the event, then reports the result.

## Files
- `adapter.ts` - Executes parse-command validation, context retrieval, AI classification, caching, and text result formatting.
- `definition.ts` - Declares the parse subcommand’s event JSON argument and reclassification/instructions options.

## Notes
- Missing thread or referenced events defer ingestion rather than storing incomplete context.
