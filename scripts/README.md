# scripts

## Purpose
Maintenance and data-seeding scripts for Nostr cache/context migration and NR recommendation signals.

## Files
- `migrate-compact-context.test.ts` - In-memory database test verifying context compaction preserves NR read and archive state.
- `migrate-compact-context.ts` - CLI migration that caches embedded context events and replaces stored event payloads with unique ID references.

## Notes
- Migration supports dry-run, backup, and apply modes.
- Seeding defaults to preview before database changes.
