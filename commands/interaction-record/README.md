# commands/interaction-record

## Purpose
Defines the web-client command that records published Nostr interactions and their corresponding Nr interest signals.

## Files
- `adapter.ts` - Validates command options, records the interaction and mapped interest signal, then returns a status message.
- `definition.ts` - Declares the interaction-record subcommand and its required event, signer, type, and timestamp options.

## Notes
- All fields are required and validated before persistence.
- Interaction types are limited to liked, replied, reposted, and quoted.
