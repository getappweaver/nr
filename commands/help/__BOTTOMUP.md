---
direct_hash: 87e2488f2565d665514b00834b4dd2d28d7bbacc211d8a9c4c88e3ed925e34e3
subtree_hash: dbd7c3feff57bf167ec757e7a2ca21abaeec7afb9704926de70b3323c49913cb
enriched: true
enriched_version: 1
files:
  adapter.ts: 97144617d3bbf24e19f43a46c7ad018ee5830dc3ed7613d35ef132b348466ac9
  module.ts: c0f65b10cee0e974c60668066015cdf6daa5d6a894fb693c273830fe4c99f615
children:
---

# commands/help

## Purpose
Defines the help command adapter and metadata helpers for Nr command usage. It converts parsed help requests into rendered text and lists available subcommands.

## Files
- `adapter.ts` - Adapts parsed Nr help requests into text output, including user-facing errors.
- `module.ts` - Builds command definitions and formatted subcommand usage lines for help displays.
