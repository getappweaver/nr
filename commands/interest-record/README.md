# commands/interest-record

## Purpose
Defines the `interest-record` NR subcommand for storing a local private preference on a target Nostr event.

## Files
- `adapter.ts` - Validates parsed interest fields and persists the local event preference.
- `definition.ts` - Declares the interest-record command, its required target event and preference options.

## Notes
- Preferences are limited to like, dislike, or none.
