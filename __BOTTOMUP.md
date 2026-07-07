---
scope_root: true
---

# plugins/nr

Private WIP Nostr radar plugin. It fetches or manually parses raw Nostr event JSON, fetches one-level NIP-10/NIP-21 related context, caches immutable events in SQLite, classifies them into topic tags and mood tags, lists unread events grouped in a web tree, and marks events read globally so they disappear from every tag/mood branch.

## Layout

- `init.ts` — `BotPlugin`, `PluginContext` / DB handles, `commandDefinition`
- `adapter.ts` — `parseCliInput` + per-subcommand adapters
- `definition.ts` — aggregated `CommandDefinition`
- `commands/help/module.ts` — `getNrCommandDefinition`, `getNrHelpLines`
- `commands/shared/render.ts` — shared render types and `renderNrText`
- `commands/drafts/store.ts` / `commands/drafts/types.ts` — draft persistence + draft types
- `commands/parse/*` — raw Nostr event JSON ingest, validation, classification, and persistence
- `commands/list-parse-single/*` — `/nr debug` web UI for pasting one event JSON, fetching related context, storing/classifying it, and rendering the same compact post card used by `/nr list`
- `commands/read/*` — global read marker for one event id
- `commands/settings/*` — DB-backed AI backend/model/instructions settings using regular command form metadata and text output
- `commands/shared/types.ts` — Nostr event/cache/classification/list schemas and legacy scaffold input schemas
- `commands/shared/output.ts` — shared message representation + builder
- `commands/list/renderers/{text,web}.ts` — unread topic/mood counts; web renderer uses `tree` / `treeItem` with fetch-from-follows controls and shared compact post-card helpers
- `commands/show/renderers/{text,web}.ts` — cached event detail renderers
- `classifier.ts` — deterministic heuristic topic/mood classification used before any LLM integration
- `db.ts` — SQLite open + event/classification/tag tables, parse upsert, unread grouping, and read state
- `ai.ts` — tool schema + `executeTool` (used by `plugin:generate` and local CLI)

Regenerate bottom-up docs for this folder after substantive edits (`bun src/cli.ts file bottomup …` per appweaver-file skill).
