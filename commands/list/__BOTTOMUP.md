---
direct_hash: 70cc41354a9332718debb9fd80b45405160adc87bab3a873673dc807cc798564
subtree_hash: dbe2fa12e5b790fdc054118e5080fdf4d985ec3c2415364dce0cef7633c72a7d
files:
  adapter.ts: 9b210fdb48084c634f67cdff3e077a2b9eb899dac055b3cd8b90cd45d9076263
  categories.ts: b8347a4316462ed7e06f6f1a88842de36cf99d311f10b307998126466c080836
  definition.ts: 1d11da203f36ce0f26730344e1f6a6c1e42d5bdc34848013e106a04ac17f9761
  handler.ts: d179324c7d505d1b82e86170de9a5a9e0a83906063c7ac435cccc398835466b7
  profile-events.ts: f0b870e479b34a6c485a22f6feafae8e3d751baaa47cf26e5f8e35cdd1d50cd0
children:
---

# commands/list

## Purpose
Implements the Nostr Radar `list` subcommand, including mode selection, feed-category filtering, cached data retrieval, profile-event refresh, and text/web rendering. It bridges command inputs with stored Nostr resolution data.

## Files
- `adapter.ts` - Coordinates list modes, stored-event hydration, optional profile refresh, and text or web output.
- `categories.ts` - Defines supported feed categories and maps them to and from Nostr event kinds.
- `definition.ts` - Declares the `list` command options, examples, and Nostr Radar web-widget metadata.
- `handler.ts` - Retrieves mode-specific Nostr Radar list data from the database.
- `profile-events.ts` - Fetches the master profile’s selected event kinds, resolves their reference graphs, and returns recent profile entries.

## Notes
- Profile mode fetches and resolves recent events from the configured master profile.
- Timeline and profile category selections are persisted.
