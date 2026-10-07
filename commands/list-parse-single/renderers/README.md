# commands/list-parse-single/renderers

## Purpose
Web renderer for the Nostr radar single-event parsing view. It provides a pasted-event form and, when available, renders the parsed event with related context and interactions.

## Files
- `web.ts` - Builds the WebNode UI for parsing and inspecting one raw Nostr event.

## Notes
- Reuses shared list renderer primitives for event display.
- The form submits the plugin's debug subcommand.
