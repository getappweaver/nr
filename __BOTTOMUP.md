---
scope_root: true
direct_hash: 45bc58af9bdcd8d146cd6c276ff2036bba6a661ca818a1d6c48147c4c109b731
subtree_hash: 4d3772c06f3ec3bc5b77a9e8fea67918ce9da6b23e82e6033887a0046d61ea6a
enriched: true
enriched_version: 1
files:
  .gitignore: 8a435b8af578ee94d524a3ebcde2625b68fece422bca596270b07179a4e2698b
  adapter.ts: 46648a30ab1cf9bb0fcee505d9e92f5498f87a37d8d40ccbb48c326aba3b7cec
  AGENTS.md: 9e018327842afd60ac441abc12e615113f6496b91b3f85348bb29ff41681e7da
  CHANGELOG.md: 5480bef488021ffae0374592a9f8f32c77e775b420c7907a277461518e28dc9c
  classifier-ai.ts: 09a7342b024e5ecc85726ca9b4621a7d00b7d0a6c782dd101b4ca3b585ec903c
  classifier.ts: eb81ebb0250b403f4a4313bc5233fc77852bbd66bc70a462ca56f6e91974f33a
  context.ts: 147555683dabd05ab45b5cb16f36dbd928099496bf5e355865822eb0e9f648bf
  db.test.ts: 18a77f2e541a79e5594808122d744596e559cff8813dee0567b48625f168d831
  db.ts: 7300dc2bfd96a75f8ab6aac43b5c3155d90f5984797e93c2bdf5a06b9c92a62f
  definition.ts: 9de831be22db45afdae73fb859a4c0c5cd49b37a2566c319a48d4d4c13767ee8
  format.ts: 568aa9eaf9bba5e166d2882833e1e4d7b507436883b11b4fb88c9d5567de826b
  init.ts: 48a8bc2378322dc7e1c6db86e9aff0c0df2a98200ac84a956b6d4a4ff7525ca0
  LICENSE: 6b0382b16279f26ff69014300541967a356a666eb0b91b422f6862f6b7dad17e
  nostr-resolution.test.ts: 3ffc77d1fe9d56d48d8a207d9546c3b19811d21c5ba9ebe42769f795fa3dae2f
  nostr-resolution.ts: 4dc980739b380505d348245cce0e9d387783bcb6a6b4940986583b6a1bfb95b9
  package.json: 30c3e23cc728e5a09e70ac72b9ee0ecf1c6044f9f9fd5137c9593823106798f6
  README.md: d9a97586bde47aea7be9e18ff9d5a0bb7b02d2cb09f0f72b5c4a997db2b7e41a
  references.ts: c59eee5d911844aefd87dfb4f2fcc2306c639a60c48c066f00cc3b354230700d
  settings.ts: 5b18fd7c126b100f243776c1edc5208b8888f84036f9361dd4a3d567960c8722
  thread-context.ts: 230eb075858b79df99c5c7f23537e82fce151b102755570ef0842288fc3b95c9
children:
  commands: 8bea30a43c105a2fc0f26da9b4ee4da4cbaef7d1763fc9ef6f28060ffd48674f
  scripts: 5d7f584a68316d0a8e26045f72d3b62b84676b7d2fe3bf0236c504b381df81fd
  types: 28780babe49a737a5a25950c98115c6748a9c05444710d8a47a26ae4efa728d7
---

# nr

## Purpose
Nostr Radar is an AppWeaver plugin that fetches, stores, classifies, and presents Nostr activity as an intentional reader. Its root wires plugin lifecycle and commands to SQLite persistence, AI/heuristic classification, event-context resolution, and settings.

## Files
- `.gitignore` - Excludes local SQLite databases, WAL files, and backups.
- `adapter.ts` - Parses Nr command input and dispatches validated subcommands to their adapters.
- `AGENTS.md` - Plugin publishing and local documentation maintenance instructions.
- `CHANGELOG.md` - Versioned release history for the Nr plugin.
- `classifier-ai.ts` - Runs configured AI backends to classify events with taxonomy and conversation context, falling back to heuristics on failure.
- `classifier.ts` - Provides heuristic event classification plus AI prompt construction and response parsing.
- `context.ts` - Builds taxonomy and tag-usage context supplied to the classifier.
- `db.test.ts` - Tests persistence behavior for cached events, classifications, state, and shared-cache seeding.
- `db.ts` - Owns Nr SQLite schema, event ingestion, classifications, feeds, preferences, fetch tracking, and evaluation queue operations.
- `definition.ts` - Defines the Nr command and its supported subcommands for the shared command system.
- `format.ts` - Formats cached events, grouped feeds, and event details as text responses.
- `init.ts` - Exports and initializes the Nr AppWeaver plugin, database, command handler, and help text.
- `LICENSE` - Unlicense public-domain dedication and warranty disclaimer.
- `nostr-resolution.test.ts` - Tests shared event-cache seeding and referenced-context graph hydration helpers.
- `nostr-resolution.ts` - Seeds shared event caches and resolves compact stored context through the Nostr resolution service.
- `package.json` - Declares the Nostr Radar plugin package metadata and maintenance scripts.
- `README.md` - Placeholder plugin documentation outlining expected command, storage, draft, and CLI coverage.
- `references.ts` - Extracts NIP-19 note, profile, and address references and fetches referenced events from relays.
- `settings.ts` - Defines persisted classification, sharing, and concurrency settings with defaults.
- `thread-context.ts` - Extracts NIP-10 thread references and fetches their context events from relays.

## Notes
- Plugin data is stored locally in db.sqlite.
- Commands support both CLI-style and structured web input.

## Subdirectories
- `commands/` - Command-layer modules for the Nr plugin, with a subdirectory per text or web command flow.
- `scripts/` - Maintenance and data-seeding scripts for Nostr cache/context migration and recommendation signals.
- `types/` - Parameter types used to adapt parsed Nr command invocations into execution context.
