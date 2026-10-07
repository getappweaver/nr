# nr

## Purpose
Nostr Radar is an AppWeaver plugin for fetching, classifying, storing, and reviewing Nostr activity. Its root wires the plugin, command dispatch, SQLite persistence, AI classification, and shared Nostr-context resolution.

## Files
- `.gitignore` - Excludes the plugin’s SQLite database, WAL files, and backups.
- `adapter.ts` - Parses `/nr` CLI or web payloads and dispatches supported subcommands to their adapters.
- `AGENTS.md` - Stable working instructions and the explicit release workflow; only edit when the user requests instruction changes.
- `ai.ts` - Exposes the Nostr Radar AI tool definition, database opener, execution bridge, and agent instructions.
- `CHANGELOG.md` - Lists tagged Nostr Radar release changes.
- `classifier-ai.ts` - Runs configured agent-backed event classification with contextual references, reactions, and heuristic fallback.
- `classifier-jev.ts` - Builds NR-specific topic/mood Choice questions over bounded candidate subsets (up to 200 topics) alongside language and relevance, invokes the shared `system-one:v1` capability, and maps its typed answers into NR classification.
- `classifier-jev.test.ts` - Covers question construction, capability invocation, answer mapping, missing-provider behavior, and signal recovery.
- `classifier.ts` - Provides heuristic classification plus prompt construction and resilient parsing, including normalized primary-language codes, for AI classification results.
- `context.ts` - Builds compact classifier interest context from explicit topic preferences and separately ranked positive/negative interest signals.
- `db.test.ts` - Covers event storage behavior around shared-cache seeding, classification reuse, and read/archive preservation.
- `db.ts` - Re-exports the modular persistence API under `db/` for events, classification, fetching, preferences, taxonomy, feeds, and interest signals.
- `definition.ts` - Defines the structured `/nr` command and its available subcommands.
- `format.ts` - Formats Nostr Radar lists and event details for text responses.
- `image-evaluation.ts` - Prepares and caches optional vision descriptions with the selected image model for LLM evaluation.
- `init.ts` - Registers and initializes the Nostr Radar plugin, command handler, help text, database, and AI definition.
- `LICENSE` - Places the plugin in the public domain under the Unlicense.
- `nostr-resolution.ts` - Seeds and hydrates Nostr events through the shared resolution service and traverses resolved reference graphs.
- `package.json` - Declares plugin metadata, compatibility requirements, and maintenance scripts.
- `README.md` - User-facing commands, classifier configuration, and documentation navigation.
- `references.ts` - Extracts Nostr event, profile, and address references from content and fetches referenced events.
- `settings.ts` - Defines persisted LLM/classifier modes, NR-owned question catalogs, legacy unused Jev endpoint/key fields, sharing, and concurrency settings.
- `thread-context.ts` - Extracts NIP-10 thread references and fetches their context events.

## Notes
- Plugin data is stored in a local SQLite database.
- Timeline Authors groups show unread posts by authors selected in recorded signals, constrained by selected slots and kind filters, including posts without topic/mood tags. Historical signals identify authors; slot selection filters posts, not signal timestamps. Groups and posts use feed score ordering.
- The `/nr` command surface is defined through subcommand modules.
- LLM mode uses the configured agent backend and heuristic fallback. Classifier mode invokes `system-one:v1`, using manual, event-tag, signal, and configured candidates; topic and mood Choice questions each receive up to 10 candidates by default and run together with language/relevance in one provider request per event. NR does not store or send provider credentials itself. The hourly fetch job reads the current mode on each run. Signal moods are captured for new signals and recovered from classified target events for older signals.

## Subdirectories
- `commands/` - Nostr Radar command layer organized by subcommand, including contracts, execution, and rendering.
- `docs/` - Standalone design references for substantial Nostr Radar features, including reviewed interest-signal creation.
- `landing.ts` - Data-only typed website content export including features and gallery metadata.
- `landing/assets/` - Plugin-owned install screenshot and gallery media, copied by the landing generator.
- `scripts/` - Maintenance and data-seeding scripts for Nostr cache/context migration and recommendation signals.
- `types/` - Defines parsed-command adapter and runtime-context parameter types.

## Additional source map

Nostr Radar root wiring, classification and persistence APIs support fetching and reviewing Nostr activity; classifier mode delegates inference to the shared System One capability while retaining NR interpretation.

## Source map

- `activity.ts` — Extracts the direct target event ID from reaction, zap, and repost events.
- `adapter.ts` — Parses CLI or structured web input and dispatches supported Nostr Radar subcommands to their adapters.
- `ai.ts` — Exports the Nostr Radar AI tool definition, schema, instructions, database opener, and guarded execution bridge.
- `classifier-ai.ts` — Runs configured agent-backed classification with event context, audience reactions, and image descriptions, or delegates classifier mode to System One.
- `classifier-jev.test.ts` — Existing classifier coverage verifies provider-default model selection, bounded questions, answer mapping, capability errors and signal recovery.
- `classifier-jev.ts` — Builds bounded NR classification questions and state, inherits the System One provider model, invokes the capability, discards cancelled results, and maps typed answers into event classification.
- `classifier.ts` — Provides heuristic event classification, builds contextual AI prompts, and parses AI results with validated language codes and fallbacks.
- `context.ts` — Builds classifier interest context from manual topic preferences and separately ranked positive and negative signals.
- `db.test.ts` — Tests persistence behavior for shared-cache seeding, event state, unread comments, zap scoring, and signal-driven read marking.
- `db.ts` — Re-exports the Nostr Radar database API from its implementation directory.
- `definition.ts` — Defines the structured /nr command and registers its subcommands.
- `format.ts` — Formats Nostr Radar lists, grouped counts, and event details as text.
- `image-evaluation.ts` — Extracts event image sources, prepares and caches bounded image descriptions through the configured agent, and cleans up temporary files.
- `init.ts` — Defines the Nostr Radar plugin lifecycle, initializes its database and scheduler migration, and connects command, help, and AI definitions.
- `nostr-resolution.ts` — Seeds Nostr events into the shared resolution service, hydrates stored context, and traverses resolved reference graphs.
- `references.ts` — Extracts Nostr event, profile, and address references from content and fetches referenced events from relays.
- `scoring.test.ts` — Tests For You scoring for exact and hierarchical topic affinity, relevance, author signals, and zap amounts.
- `settings.test.ts` — Tests image-agent selection, settings persistence and reset, and classifier-mode settings behavior.
- `settings.ts` — Defines persisted Nostr Radar classification, image, sharing, fetching, review, and scheduler-resource settings with defaults and accessors.
- `thread-context.test.ts` — Tests extraction of NIP-10 and NIP-22 root and parent thread references.
- `thread-context.ts` — Extracts NIP-10 thread references and fetches their context events from relays.
- `zap.test.ts` — Tests NIP-57 zap receipt parsing and logarithmic zap scoring.
- `zap.ts` — Parses NIP-57 zap receipts to identify participants, targets, amounts, and comments, and calculates a capped zap score.
