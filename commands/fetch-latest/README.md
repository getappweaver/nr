# commands/fetch-latest

## Purpose
Implements the Nr `fetch-latest` command, which retrieves recent activity from followed Nostr accounts, resolves context, classifies events, and persists results. It supports resumable relay pagination and web progress updates.

## Files
- `adapter.ts` - Command adapter that fetches followed authors’ events across relays, processes queued context-aware classification, records resumable progress, and returns a detailed fetch summary.
- `definition.ts` - Declares the `fetch-latest` command, its aliases, time-window and limit options, classification-instruction input, and usage examples.

## Notes
- Fetch state and evaluation queues are persisted through the Nr database layer.
- Classification instructions can be overridden per command invocation.
