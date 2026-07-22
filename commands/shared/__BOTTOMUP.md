---
direct_hash: 19838889c9cb17610c0e7e101da409dd0efd0203733890576fd3a640a84a3ce9
subtree_hash: d4ced9f8152afdef1d75e6ad9d3b6901226036691034fd6441f14319dfec9ca6
enriched: true
enriched_version: 1
files:
  output.ts: 5f7e1615faf1b1afed288c10748ce697291e08dedf5c2631c5410486df464179
  render.ts: a54c5cd469de006f0b4f8c42f1f3348ccf6d5044cadf7f0068b2a1c8e8908651
  reply.ts: 717bd0b610569b0c00ea4afc5f6bf683a0c15796fa036827e605d6fc62503a08
  types.ts: b17e44525bbc5ed206f9218a650113f273fda753570a8306506c690074493e64
  variadic-text.ts: a1228c3f6258152323b25c4a44863fe1199d22e09b9211cdf304ded5cc9890b3
children:
---

# commands/shared

## Purpose
Shared command-layer representations, reply helpers, rendering adapters, and Nostr-related types. It supports consistent text and web output for Nr command flows.

## Files
- `output.ts` - Defines validated message output representations and a factory for creating them.
- `render.ts` - Declares Nr web renderable shapes, type guards, and text rendering for help or message output.
- `reply.ts` - Classifies plain reply text by tone and wraps it as an Nr message representation.
- `types.ts` - Centralizes validated Nostr event records and shared Nr domain, feed, interaction, taxonomy, and classification types.
- `variadic-text.ts` - Converts an optional variadic command argument into normalized text.

## Notes
- Message representations carry command metadata and a visual tone.
- Web-specific Nr representations are intentionally separate from text rendering.
