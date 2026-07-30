---
direct_hash: ce0cb954004a2cb9b3e95edb4ec2b9909d4083ca4380b1f42d4fec0866062162
subtree_hash: a8658b81e05b14a368cb158a80e299ea98dcef70c4b2d023658f4352ef630065
enriched: true
enriched_version: 1
files:
  fetch-status.ts: 1b50b1b59dc8406f3cfd7ad85a13aff851dba5886a3d3b3112701703a674c9a1
children:
  ai: 1c3d7812cd6802adb47ca8ae95ab9ad30521edb60e57ff8288362f1c45b8f1b9
  author-interest-record: 2a20588ffd8b4959508ef97541002ea22da4931b66f26046c26f8652835b8f6c
  context: e1386256b987e080f65ce51718022e4fdb891291ab663051875373dc3c214e52
  fetch-latest: 1b5bbe579b14d36b9c8a33f207d12b2e0836d53a62334f1e7a612692e1d9eb19
  help: dbd7c3feff57bf167ec757e7a2ca21abaeec7afb9704926de70b3323c49913cb
  interaction-record: 508993da3a4e6505bb0438771a6f9386fc3d33a2f4ccb45296aac0db9a9ac30f
  interest-record: 8d8b213b957052ac19dc60997084e46431c6c8fe957c7e1b8088e235d0b1ab41
  list: dbe2fa12e5b790fdc054118e5080fdf4d985ec3c2415364dce0cef7633c72a7d
  list-parse-single: 300708077961577fce5f4c10ce6cada5f6a4ba2d813069eaeda2fb3321ede3a6
  mark: 86d6ff21db380524ae2f1a8e0e1bf243e3515b2c909a66b9f7a08be2e4ff87cb
  parse: d8df1aa23594724e46361679549cd260e66810f288339c0e8ff069c88dfd9620
  read: 001fda7e0fc576ebaa5c9c57adc6b8a039410b835f3817d4a31b06fac1bf8061
  reevaluate: a7532351f866cb61eb43d0ae40207b06c2370bfc59e481eef40a6b5d225caec6
  settings: 9278adc762a60d5d97d2f5a065689a7a9941df07ba0e1847d332820210805bf8
  shared: d4ced9f8152afdef1d75e6ad9d3b6901226036691034fd6441f14319dfec9ca6
  taxonomy: 5db5f6c3f9f1cc2f059026acbc5dd1ed2c917ae74262229fc82d9540b3d344a0
---

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
