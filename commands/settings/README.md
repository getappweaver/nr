# Settings command

Defines the Nostr Radar `settings`/`config` subcommand. It reads, validates,
updates, and resets settings through text commands and the web settings form.

## Responsibilities

- Choose LLM or classifier mode and configure NR-owned question/candidate catalogs.
- Configure image evaluation, sharing, fetching, and review options.
- Manage hourly scheduler setup through the shared scheduler capability.
- Persist settings through the parent settings module; empty overrides clear
  nullable backend/model selections.

Classifier inference uses the shared System One capability. Configure upstream
credentials in the System One plugin; NR's legacy Jev endpoint/key fields are
inactive, and the NR settings form does not manage provider credentials.

## Files

- `adapter.ts` — Settings validation, persistence/reset, scheduler setup, and web/text rendering.
- `definition.ts` — Options, aliases, help text, and usage examples.

See [System One setup](../../../systemone/README.md) and the
[plugin overview](../../README.md).
