---
direct_hash: 2c2a894ff534b95b2eb496993fb6ffb71e1efe23d6ec3d37bf685801d19c681a
subtree_hash: 508993da3a4e6505bb0438771a6f9386fc3d33a2f4ccb45296aac0db9a9ac30f
enriched: true
enriched_version: 1
files:
  adapter.ts: c50eccabf815a0500eeb80f3abb7e68d6802232d000226f34f8ee0dd177ee7d7
  definition.ts: b9691408ac2a39c078b42adbcc811b0b01c2a534f68b641c59bc0a14b7a6e45f
children:
---

# commands/interaction-record

## Purpose
Defines the web-client command that records published Nostr interactions and their corresponding Nr interest signals.

## Files
- `adapter.ts` - Validates command options, records the interaction and mapped interest signal, then returns a status message.
- `definition.ts` - Declares the interaction-record subcommand and its required event, signer, type, and timestamp options.

## Notes
- All fields are required and validated before persistence.
- Interaction types are limited to liked, replied, reposted, and quoted.
