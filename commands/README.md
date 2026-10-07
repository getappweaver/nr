# commands

## Purpose
Nostr Radar command layer organized by subcommand. It contains one shared fetch-progress target constant and dedicated folders for command contracts, execution, and rendering.

## Files
- `fetch-status.ts` - Exports the target ID used for Nostr Radar fetch-progress status updates.

## Notes
- Commands support text and web responses where applicable.
- Shared command representations and adapters live in `shared`.

## Subdirectories
- `ai/` - Defines the AI-facing tool contract and runtime adapter for hourly fetch-and-evaluate work.
- `author-interest-record/` - Records or clears a private author preference.
- `context/` - Adapts context requests into classification-context text.
- `fetch-latest/` - Fetches followed-account activity, classifies it, persists results, and reports web progress.
- `help/` - Provides help command metadata, usage rendering, and subcommand listings.
- `interaction-record/` - Records published Nostr interactions and their associated interest signals.
- `interest-record/` - Stores a private preference for a target Nostr event.
- `list/` - Retrieves and renders stored radar items with filtering and profile refresh support.
- `list-parse-single/` - Parses, contextualizes, classifies, and displays one pasted Nostr event for debugging.
- `mark/` - Updates cached event read or archive state, including scoped bulk changes.
- `parse/` - Ingests, contextualizes, classifies, caches, and reports one raw Nostr event.
- `read/` - Marks cached events as read individually or by topic or mood scope.
- `reevaluate/` - Forces AI classification to rerun for a Nostr event.
- `settings/` - Configures parse AI behavior, sharing, and concurrency through text and web interfaces.
- `shared/` - Holds shared command representations, reply helpers, rendering adapters, and Nostr types.
- `taxonomy/` - Manages manual topic and mood terms used during classification.

## Local modules

- [settings](settings/README.md)
- [context](context/README.md)
- [list-parse-single](list-parse-single/README.md)
- [fetch-latest](fetch-latest/README.md)
- [parse](parse/README.md)
- [read](read/README.md)
- [mark](mark/README.md)
- [author-interest-record](author-interest-record/README.md)
- [shared](shared/README.md)
- [reevaluate](reevaluate/README.md)
- [interest-record](interest-record/README.md)
- [taxonomy](taxonomy/README.md)
- [ai](ai/README.md)
- [list](list/README.md)
- [interaction-record](interaction-record/README.md)
- [help](help/README.md)
