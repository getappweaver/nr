# commands/context

## Purpose
Defines the `context` subcommand for the NR plugin. It exposes command metadata and adapts invocations into existing classification-context text.

## Files
- `adapter.ts` - Builds the command response from the database-backed NR plugin context.
- `definition.ts` - Declares the `context` command syntax, description, and usage example.
