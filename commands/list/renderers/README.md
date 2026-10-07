# commands/list/renderers

## Purpose
Renderers for the Nostr Radar list command, producing text and WebNode-based UI for timeline, for-you, profile, archive, signals, and ranked feeds.

## Files
- `archive.ts` - Archive-mode tree composition (Topics/Moods/Languages sections).
- `authors.ts` - Timeline Authors tree: cached display names with pubkey fallbacks, filterable author rows, and shared post/conversation rendering for signal-matched authors.
- `event-nodes.ts` - Shared post rendering core: event/activity/profile nodes, grouping, sections, actions, embeds, thread context, and author preference actions; the tag read shortcut optimistically removes the group and reconciles with a nonblocking refresh after the mark command.
- `fetch-coverage.ts` - Builds the 24-hour fetch-coverage bar, including status styling and interval-specific fetch actions.
- `for-you.ts` - For-You-mode tree composition (ranked events plus empty state).
- `list.svg` - Nostr Radar icon asset.
- `primitives.ts` - Tiny WebNode builders (text, el, keyed, entity keys).
- `profile.ts` - Profile-mode tree composition (profile events plus empty state).
- `signals.ts` - Signals-mode tree: legend plus Topic/Author aggregates with score breakdowns.
- `text.ts` - Delegates list output formatting to the shared text formatter.
- `timeline.ts` - Timeline-mode tree composition (Topics/Moods/Languages/Authors sections).
- `web.ts` - Widget chrome (tabs, filter panel, toolbar) and render orchestration dispatching to per-mode renderers.

## Notes
- Web actions refresh the list without recording timeline entries.
- Stylesheets are scoped through the WebNode root.
