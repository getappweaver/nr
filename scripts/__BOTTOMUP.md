---
direct_hash: c21b869a53477d3be2973ee0b20a381ea2f2e3f33b86c46746ca9a98f8fc2180
subtree_hash: 5d7f584a68316d0a8e26045f72d3b62b84676b7d2fe3bf0236c504b381df81fd
enriched: true
enriched_version: 1
files:
  migrate-compact-context.test.ts: 83ef2549c8742b58e12a888ecf3fe7a68b6c99bb7223057e47ad32a17ce150fa
  migrate-compact-context.ts: 63e4a0f33b89c324841d253d83937d05b31d963569f754f351c683031f08f082
  seed-for-you.ts: 114cd18fb3e5fda3d1fc25ab8654bc6ad86b43a9beab3adb2d69d066fd2534e0
children:
---

# scripts

## Purpose
Maintenance and data-seeding scripts for Nostr cache/context migration and NR recommendation signals.

## Files
- `migrate-compact-context.test.ts` - In-memory database test verifying context compaction preserves NR read and archive state.
- `migrate-compact-context.ts` - CLI migration that caches embedded context events and replaces stored event payloads with unique ID references.
- `seed-for-you.ts` - CLI utility that derives seeded NR interest signals from a profile’s Nostr interactions and previews ranking effects.

## Notes
- Migration supports dry-run, backup, and apply modes.
- Seeding defaults to preview before database changes.
