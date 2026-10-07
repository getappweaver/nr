# commands/read

## Purpose
Defines the `read` subcommand for marking cached Nostr events as read. It supports a single event ID or bulk updates scoped to a topic or mood tag.

## Files
- `adapter.ts` - Validates read-command input, updates cached event read state, and returns usage or result messages.
- `definition.ts` - Declares the read subcommand’s arguments, tag-filter options, help text, and examples.

## Notes
- Bulk reads require both `--type` and `--tag`; event IDs cannot be combined with tag options.
