# commands/list

## Purpose
Implements the Nostr Radar `list` subcommand, including mode selection, feed-category and multi-range time filtering, cached data retrieval, profile-event refresh, and text/web rendering. It bridges command inputs with stored Nostr resolution data.

## Files
- `adapter.ts` - Coordinates list modes, stored-event hydration, optional profile refresh, and text or web output.
- `categories.ts` - Defines supported feed categories and maps them to and from Nostr event kinds.
- `definition.ts` - Declares the `list` command options, examples, and Nostr Radar web-widget metadata.
- `handler.ts` - Retrieves mode-specific Nostr Radar list data from the database.
- `profile-events.ts` - Fetches the master profile’s selected event kinds, resolves their reference graphs, and returns recent profile entries.

## Notes
- Profile mode fetches and resolves recent events from the configured master profile.
- Timeline and profile category selections are persisted.
- Timeline coverage can switch from the latest 24 hours to multi-row historical fetched/partial slots that still contain posts visible under the active unread Timeline filters.

## Local modules

- [renderers](renderers/README.md)
