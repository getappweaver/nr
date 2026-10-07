# commands/ai

## Purpose
Defines the AI-facing Nostr Radar tool contract and executes its hourly fetch-and-evaluate operation. It exposes instructions, Zod call validation, and the runtime adapter bridge.

## Files
- `agent-instructions.ts` - Provides concise operating instructions for agents using the Nostr Radar tool.
- `execute-tool.ts` - Builds Nostr and agent runtime dependencies, then runs the bounded hourly fetch-and-evaluate workflow.
- `schemas.ts` - Defines the validated tool-call schema and AI skill metadata for Nostr Radar.

## Notes
- The only supported call is fetch_evaluate for the previous completed hour.
- Execution writes local Nostr Radar state and must not run concurrently.
