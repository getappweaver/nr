# commands/reevaluate

## Purpose
Defines the `reevaluate` NR subcommand for forcing AI classification to run again on one Nostr event. It supports cached events and optionally supplied raw event JSON.

## Files
- `adapter.ts` - Handles reevaluation by resolving event context, forcing storage and AI classification, then formatting the updated result.
- `definition.ts` - Declares the `reevaluate`/`reclassify` command, event ID argument, and internal raw-event option.

## Notes
- Reevaluation defers when required thread or referenced context cannot be resolved.
- The adapter refreshes nested reference context before storing the forced classification result.
