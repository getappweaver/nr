# commands/mark

## Purpose
Implements the `mark` Nr subcommand for changing cached event read/archive state. It supports single-event updates, topic/mood bulk updates, and optional cache hydration from supplied event JSON.

## Files
- `adapter.ts` - Validates mark inputs, updates cached event or tag-matched state, and reports command results.
- `definition.ts` - Declares the mark command arguments, state flags, bulk-tag options, and usage examples.

## Notes
- Archive actions record an Nr interest signal.
- Exactly one state flag is required per command.
