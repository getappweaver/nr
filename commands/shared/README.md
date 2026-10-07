# commands/shared

## Purpose
Shared command-layer representations, reply helpers, rendering adapters, and Nostr-related types. It supports consistent text and web output for Nr command flows.

## Files
- `output.ts` - Defines validated message output representations and a factory for creating them.
- `render.ts` - Declares Nr web renderable shapes, type guards, and text rendering for help or message output.
- `reply.ts` - Classifies plain reply text by tone and wraps it as an Nr message representation.
- `types.ts` - Centralizes validated Nostr event records and shared Nr domain, feed, interaction, taxonomy, and classification types.
- `variadic-text.ts` - Converts an optional variadic command argument into normalized text.

## Notes
- Message representations carry command metadata and a visual tone.
- Web-specific Nr representations are intentionally separate from text rendering.
