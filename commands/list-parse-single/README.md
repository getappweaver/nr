# commands/list-parse-single

## Purpose
Implements the `debug` subcommand for parsing, contextualizing, classifying, and displaying one pasted Nostr event. It supports text and web responses.

## Files
- `adapter.ts` - Validates a pasted event, resolves its context, stores and optionally reclassifies it, then renders text or web results.
- `definition.ts` - Declares the debug command arguments, classification options, aliases, and example usage.

## Notes
- Missing thread or referenced events defer processing.

## Local modules

- [renderers](renderers/README.md)
