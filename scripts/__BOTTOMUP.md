---
direct_hash: 46b8528327fe64055d607819d500f4c3788416951fb861a12db3e436d854dd0a
subtree_hash: c90c45841e9ab158ae1c0646eaa3a0274fa6328121f88ff038a29205f6c2dacd
files:
  migrate-compact-context.test.ts: 83ef2549c8742b58e12a888ecf3fe7a68b6c99bb7223057e47ad32a17ce150fa
  migrate-compact-context.ts: 63e4a0f33b89c324841d253d83937d05b31d963569f754f351c683031f08f082
children:
---

# scripts

## Purpose
Maintenance and data-seeding scripts for Nostr cache/context migration and NR recommendation signals.

## Files
- `migrate-compact-context.test.ts` - In-memory database test verifying context compaction preserves NR read and archive state.
- `migrate-compact-context.ts` - CLI migration that caches embedded context events and replaces stored event payloads with unique ID references.

## Notes
- Migration supports dry-run, backup, and apply modes.
- Seeding defaults to preview before database changes.
