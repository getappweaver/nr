---
direct_hash: a9a6f48a2312ea2f2f664dccb03eb10f2047b49449375fe2ae0f4d351c61d757
subtree_hash: 1c3d7812cd6802adb47ca8ae95ab9ad30521edb60e57ff8288362f1c45b8f1b9
files:
  agent-instructions.ts: d5801a9e8b610e2d8ec9de6fc72f8a02e5d4a08512ce9c9c8ad7a955e82e6c0a
  execute-tool.ts: 83509c2f28a35d9db52c4511dcea94d62ae2d470dd1ab8b362c44a3c0fe43593
  schemas.ts: 6a2a65e2e2e610d95e8a53124a490a27d0e00ab1d510d75bd650e94d8215228d
children:
---

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
