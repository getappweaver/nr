---
direct_hash: 5aec84878263fdd3f2979c42b1d43b3dacd13fb84498b7f3d4b509a9067083b5
subtree_hash: ae200142eb25d64d33b06e58ab27a2ba457cd6a0266431540424f8893385ed79
enriched: true
enriched_version: 1
files:
  web.ts: c1bfc1fefa84d939dc5c37f449c240a4812fc6123372ae6b0fc9c32f4a4e0cbc
children:
---

# commands/list-parse-single/renderers

## Purpose
Web renderer for the Nostr radar single-event parsing view. It provides a pasted-event form and, when available, renders the parsed event with related context and interactions.

## Files
- `web.ts` - Builds the WebNode UI for parsing and inspecting one raw Nostr event.

## Notes
- Reuses shared list renderer primitives for event display.
- The form submits the plugin's debug subcommand.
