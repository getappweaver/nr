---
scope_root: true
direct_hash: 8b447589dd404d9cce5c06d5193115f9cca8cce76d0fba775ce5ed85f0ea70e6
subtree_hash: 666d832bbf221ba01a5d50c069bc7b8e8c9fae401ff9922ce3c039a7636e29ce
enriched: true
enriched_version: 1
files:
  .gitignore: 8a435b8af578ee94d524a3ebcde2625b68fece422bca596270b07179a4e2698b
  adapter.ts: c4a923e00339ded99806c5dd8b7002669f04770e411efba5c3cdcaaa05c7652c
  AGENTS.md: 9e018327842afd60ac441abc12e615113f6496b91b3f85348bb29ff41681e7da
  ai.ts: 5cfde82bd977d068de4197f6bd155803d8a98470fd2680d6a7037d38f2003d16
  CHANGELOG.md: 39b03886a22f93e6cd494f00f3a2dddb3569aee9db564defa246457bb53ec32b
  classifier-ai.ts: f050fedc01cc76261c12a909b2f594b17a0db3849149ceb660a146423981035e
  classifier.ts: eb81ebb0250b403f4a4313bc5233fc77852bbd66bc70a462ca56f6e91974f33a
  context.ts: 147555683dabd05ab45b5cb16f36dbd928099496bf5e355865822eb0e9f648bf
  db.test.ts: 18a77f2e541a79e5594808122d744596e559cff8813dee0567b48625f168d831
  db.ts: 5e07c3e19ae9b48e609295016b5dcacecb64e361103d149723241f823b30b564
  definition.ts: 9de831be22db45afdae73fb859a4c0c5cd49b37a2566c319a48d4d4c13767ee8
  format.ts: 568aa9eaf9bba5e166d2882833e1e4d7b507436883b11b4fb88c9d5567de826b
  init.ts: cce8038f25dd558c4fbcee2e8734d5d40c8b9a40dd333b0fc378d4e17e9ff91c
  LICENSE: 6b0382b16279f26ff69014300541967a356a666eb0b91b422f6862f6b7dad17e
  nostr-resolution.ts: 4dc980739b380505d348245cce0e9d387783bcb6a6b4940986583b6a1bfb95b9
  package.json: e919c525b2b3496ee624c00c1c7bb0ee9d1209362062dc7f29856e7bf08dc0c0
  README.md: d9a97586bde47aea7be9e18ff9d5a0bb7b02d2cb09f0f72b5c4a997db2b7e41a
  references.ts: c59eee5d911844aefd87dfb4f2fcc2306c639a60c48c066f00cc3b354230700d
  settings.ts: 5b18fd7c126b100f243776c1edc5208b8888f84036f9361dd4a3d567960c8722
  thread-context.ts: 230eb075858b79df99c5c7f23537e82fce151b102755570ef0842288fc3b95c9
children:
  commands: a8658b81e05b14a368cb158a80e299ea98dcef70c4b2d023658f4352ef630065
  scripts: c90c45841e9ab158ae1c0646eaa3a0274fa6328121f88ff038a29205f6c2dacd
  types: 7604bd9621fb462f1312457aa0cf56784ecbd55a15184f148a95a2ecdb09f693
---

# nr

## Purpose
Nostr Radar is an AppWeaver plugin for fetching, classifying, storing, and reviewing Nostr activity. Its root wires the plugin, command dispatch, SQLite persistence, AI classification, and shared Nostr-context resolution.

## Files
- `.gitignore` - Excludes the plugin’s SQLite database, WAL files, and backups.
- `adapter.ts` - Parses `/nr` CLI or web payloads and dispatches supported subcommands to their adapters.
- `AGENTS.md` - Records plugin publishing steps and the requirement to maintain local bottom-up documentation.
- `ai.ts` - Exposes the Nostr Radar AI tool definition, database opener, execution bridge, and agent instructions.
- `CHANGELOG.md` - Lists tagged Nostr Radar release changes.
- `classifier-ai.ts` - Runs configured agent-backed event classification with contextual references, reactions, and heuristic fallback.
- `classifier-jev.ts` - Evaluates cloned topic and mood Choice questions over bounded candidate subsets (up to 200 topics) alongside language and relevance in one Jev request; keeps credentials server-side and leaves summaries empty.
- `classifier-jev.test.ts` - Covers typed Jev evaluation and missing-credential behavior.
- `classifier.ts` - Provides heuristic classification plus prompt construction and resilient parsing, including normalized primary-language codes, for AI classification results.
- `context.ts` - Builds compact classifier interest context from explicit topic preferences and separately ranked positive/negative interest signals.
- `db.test.ts` - Covers event storage behavior around shared-cache seeding, classification reuse, and read/archive preservation.
- `db.ts` - Owns the plugin SQLite schema and persistence APIs for events, classification, fetching, visible historical unread-slot aggregation, preferences, preference-aware taxonomy, and feeds; indexes tag lookups for bulk read actions and list groups, and combines stored Jev relevance with For You scoring.
- `definition.ts` - Defines the structured `/nr` command and its available subcommands.
- `format.ts` - Formats Nostr Radar lists and event details for text responses.
- `image-evaluation.ts` - Prepares and caches optional vision descriptions with the selected image model for LLM evaluation.
- `init.ts` - Registers and initializes the Nostr Radar plugin, command handler, help text, database, and AI definition.
- `LICENSE` - Places the plugin in the public domain under the Unlicense.
- `nostr-resolution.ts` - Seeds and hydrates Nostr events through the shared resolution service and traverses resolved reference graphs.
- `package.json` - Declares plugin metadata, compatibility requirements, and maintenance scripts.
- `README.md` - Template placeholder for user-facing plugin documentation.
- `references.ts` - Extracts Nostr event, profile, and address references from content and fetches referenced events.
- `settings.ts` - Defines persisted LLM and Jev evaluation modes, candidate catalogs, private Jev credentials, sharing, and concurrency settings.
- `thread-context.ts` - Extracts NIP-10 thread references and fetches their context events.

## Notes
- Plugin data is stored in a local SQLite database.
- The `/nr` command surface is defined through subcommand modules.
- LLM mode uses the configured agent backend and heuristic fallback. Classifier mode uses manual, event-tag, signal, and configured candidates; topic and mood Choice questions each receive up to 10 candidates by default and run together in one Jev request per event. The hourly fetch job reads the current mode on each run. Signal moods are captured for new signals and recovered from classified target events for older signals.

## Subdirectories
- `commands/` - Nostr Radar command layer organized by subcommand, including contracts, execution, and rendering.
- `docs/` - Standalone design references for substantial Nostr Radar features, including reviewed interest-signal creation.
- `scripts/` - Maintenance and data-seeding scripts for Nostr cache/context migration and recommendation signals.
- `types/` - Defines parsed-command adapter and runtime-context parameter types.
