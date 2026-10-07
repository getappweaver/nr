## Purpose
Defines the NR subcommand for recording or clearing a private like/dislike preference for an author pubkey.

## Files
- `adapter.ts` - Validates author preference arguments and persists the preference in the Nr database.
- `definition.ts` - Declares the author-interest-record subcommand, including required pubkey and preference options.

## Notes
- Author preferences complement event-level interest records and remain local to the Nr plugin.

## Subdirectories
