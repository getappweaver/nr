---
direct_hash: 33aa9795d99e37c02d3367e1cbb9cf9c44a4379e509b67f72e32f10bd201891b
subtree_hash: e1386256b987e080f65ce51718022e4fdb891291ab663051875373dc3c214e52
enriched: true
enriched_version: 1
files:
  adapter.ts: 18e48910b169dd75c0c7d501bea9f57185d57da717503a0a36c2c4c6c71ad88e
  definition.ts: f830cfeb2a9fc5b801022506b65d0042c4afab8b6e492c6ee3aea064258b4822
children:
---

# commands/context

## Purpose
Defines the `context` subcommand for the NR plugin. It exposes command metadata and adapts invocations into existing classification-context text.

## Files
- `adapter.ts` - Builds the command response from the database-backed NR plugin context.
- `definition.ts` - Declares the `context` command syntax, description, and usage example.
