---
direct_hash: 3758d7dbabe82ea44be28c5411d7d9edea11ae24e2fa6b580e9c8d46432d2211
subtree_hash: 9278adc762a60d5d97d2f5a065689a7a9941df07ba0e1847d332820210805bf8
files:
  adapter.ts: ee9903cfffb2de2e14c705353e05aaa10ad618c1db6b37dae5b304d4f0c293d5
  definition.ts: b42594a435bf3ef7fc16bc51ef81aee51d9054d8f9e84f75430062df1d3a3ff2
children:
---

# commands/settings

## Purpose
Defines the `settings`/`config` subcommand for configuring nr parse AI behavior and related sharing and concurrency options. It supports both text-command output and a web settings form.

## Files
- `adapter.ts` - Handles settings reads, validation, persistence, resets, and web/text rendering for the subcommand.
- `definition.ts` - Declares the settings command options, aliases, help text, and usage examples.

## Notes
- Settings persist through the parent settings module.
- Empty string overrides clear nullable backend/model values.
