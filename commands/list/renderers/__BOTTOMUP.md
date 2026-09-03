---
direct_hash: 6d17e83c127e49c46eef3626a26063fc158951df5e9bf18a5e4808f4b0c3ff40
subtree_hash: 06eb53edb85a2aaef74e9288ba3d89624b7b282753ff23b1560faee02057e096
enriched: true
enriched_version: 1
files:
  fetch-coverage.ts: 4010c95bd4a2a5096117afffa600eda0d65d543d105faa357fcf48b9619dd3a1
  list.svg: eabdf43356a7c4ad9437b6891a0eb74b282caa5b309c4a3ec7a0141c24dd8716
  profile.ts: 9de4aaccbaf66f63332240794761b3ad08dde094c17a03471f04eb8ff459e84e
  text.ts: bf9c4b0738bd1f6ce61cf3c8a1cfa1790769e415cbf54c41a9a2063b3f167321
  web.test.ts: ce1173c1281b9dddafb2295593765b413931f4ffa1553898a02ae33f0113e36f
  web.ts: cfca5232a68ef0cf03b896e8e7e47cadbc79bf91a408b16a8945ec55b7a7d1bc
children:
---

# commands/list/renderers

## Purpose
Renderers for the Nostr Radar list command, producing text and WebNode-based UI for timeline, for-you, profile, archive, signals, and ranked feeds.

## Files
- `archive.ts` - Archive-mode tree composition (Topics/Moods/Languages sections).
- `event-nodes.ts` - Shared post rendering core: event/activity/profile nodes, grouping, sections, actions, embeds, thread context, and author preference actions.
- `fetch-coverage.ts` - Builds the 24-hour fetch-coverage bar, including status styling and interval-specific fetch actions.
- `for-you.ts` - For-You-mode tree composition (ranked events plus empty state).
- `list.svg` - Nostr Radar icon asset.
- `primitives.ts` - Tiny WebNode builders (text, el, keyed, entity keys).
- `profile.ts` - Profile-mode tree composition (profile events plus empty state).
- `signals.ts` - Signals-mode tree: legend plus Topic/Author aggregates with score breakdowns.
- `text.ts` - Delegates list output formatting to the shared text formatter.
- `timeline.ts` - Timeline-mode tree composition (Topics/Moods/Languages sections).
- `web.ts` - Widget chrome (tabs, filter panel, toolbar) and render orchestration dispatching to per-mode renderers.

## Notes
- Web actions refresh the list without recording timeline entries.
- Stylesheets are scoped through the WebNode root.
