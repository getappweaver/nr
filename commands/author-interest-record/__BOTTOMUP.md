---
direct_hash: c013962fe9a3b06f683227b34fe346cd675d1538ff89b9995f6aad87c6000813
subtree_hash: 2a20588ffd8b4959508ef97541002ea22da4931b66f26046c26f8652835b8f6c
enriched: true
enriched_version: 1
files:
  adapter.ts: 50c5f5b28a7116695e7cec77e65b828b13aa7f1b49c05dcb7ee548699bdf3ad6
  definition.ts: 84226f3807f384ad0f29ba02f7d2b9eb38d314cb8e8c19ca298a6d4cf078d041
children:
---
## Purpose
Defines the NR subcommand for recording or clearing a private like/dislike preference for an author pubkey.

## Files
- `adapter.ts` - Validates author preference arguments and persists the preference in the Nr database.
- `definition.ts` - Declares the author-interest-record subcommand, including required pubkey and preference options.

## Notes
- Author preferences complement event-level interest records and remain local to the Nr plugin.

## Subdirectories
