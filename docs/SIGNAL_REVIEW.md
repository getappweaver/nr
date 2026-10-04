# Nostr Radar Signal Review

## Status

Signal review is implemented for all supported action families:

- Archive
- Public Like
- Reply
- Repost and Quote
- Local Like
- Local Dislike

The implementation includes reviewed topic and author selection, per-action review settings, exact signal persistence, learned author affinity, and post-publication signal recording.

This release intentionally uses a clean signal-schema cutover. It does not migrate or reconstruct signal history from an older Nostr Radar database. That compatibility break requires a major plugin release.

## Behavior

Before Nostr Radar creates a learned interest signal, the user can review the features included in that signal:

```text
Creating a signal for this post

Author
[x] AuthorA

Topics
[x] ai
[x] nostr
[x] markets

[ ] Don't ask again for Like

[Like + create signal] [Like without signal] [Cancel]
```

The review contains:

- The author of the exact target event.
- Topics classified directly on the target event.
- No empty topics and no `general` topic.
- No moods.
- Checked author and topic controls by default.

Topic-only, author-only, and empty signals are valid deliberate outcomes. An empty signal remains inert in ranking rather than restoring unchecked defaults.

## Review Modes

Archive, Like, Reply, and Repost/Quote each persist one mode:

```ts
type NrSignalReviewMode = 'ask' | 'always' | 'never';
```

- `ask`: show review before finalizing the action.
- `always`: create a signal with all candidate topics and the target author without opening review.
- `never`: perform the action without creating a signal.

Every mode defaults to `ask`. The settings UI exposes compact selectors for changing them.

When "Don't ask again" is selected:

- Create Signal stores `always` after the action succeeds.
- Without Signal stores `never` after the action succeeds.
- Cancel or action failure leaves the setting unchanged.

Local Like and Local Dislike always open review when activated or switched. They do not have persisted modes, do not offer Without Signal, and clear immediately when the active choice is clicked again.

## Action Timing

### Archive

Review happens before archive mutation. Create Signal sequences archive first and signal persistence second. Without Signal archives without changing signal rows. Unarchive does not create or remove learning.

### Public Like

Review happens before signing. The signal is recorded only after relay publication and interaction recording succeed. Publication failure or cancellation records nothing.

### Reply

Review fields are embedded in the reply composer. Reply content and signal outcome submit together. Canceling the composer publishes and records nothing.

### Repost And Quote

Review fields are embedded in the repost/quote panel. Empty content produces a Repost signal; non-empty content produces a Quote signal. Both share the Repost/Quote review-mode setting.

### Local Like And Dislike

Activation opens standalone review. Create Signal stores the selected features and removes the opposite local signal in the same decision flow. Cancel leaves state unchanged.

## Persistence

Reviewed signals are authoritative and use `(target_event_id, type)` as their logical key:

```sql
CREATE TABLE nr_interest_signals (
  target_event_id TEXT NOT NULL,
  type            TEXT NOT NULL,
  weight          INTEGER NOT NULL,
  topics_json     TEXT NOT NULL,
  moods_json      TEXT NOT NULL,
  author_pubkey   TEXT,
  source          TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (target_event_id, type)
);
```

Create Signal upserts the exact selected topics and optional author. New signals store `moods_json` as an empty array. Without Signal does not create, update, or delete a signal row.

Startup no longer reconstructs signals from public interactions or archived events. Restart therefore cannot widen reviewed selections or recreate intentionally omitted signals.

The schema adds `author_pubkey` without preserving the previous signal table. Existing Nostr Radar databases must be recreated for this major release.

## Ranking

Topic scoring continues to divide a signal's weight across its selected topics.

Reviewed authors contribute a separate bounded learned affinity:

```ts
learnedAuthorAffinity = 1.5 * Math.tanh(rawAuthorWeight / 5);
```

Explicit author preferences remain independent and stronger:

```ts
explicitAuthorBias = {
  like: 2,
  dislike: -6,
  neutral: 0,
};
```

The final score combines topic affinity, learned author affinity, and explicit author bias. Selecting an author during signal review never writes an explicit author preference.

## Timeline Author Discovery

The Timeline tree includes an Authors section alongside Topics, Moods, and
Languages. It groups eligible unread posts by authors present in reviewed signal
history, including posts without topic or mood tags. Both positive and negative
author signals qualify; a topic-only signal with no selected author does not.
Explicit author preferences alone do not create a signal-matched group.

Selected hourly slots constrain post creation times, not signal timestamps.
Existing kind, read-state, resolved-context, and hidden-reference filtering also
apply. Author groups and their posts follow existing score ordering. Cached
display names are preferred, with shortened pubkeys as a fallback. Author posts
participate in profile/context hydration and deduplicated unread counts, including
the historical unread-slot list.

- [x] Implement slot-scoped author groups, Authors tree rendering, hydration,
  score ordering, and unread-count integration.
- [x] Targeted ESLint and scoped NR TypeScript checks.
- [x] One-off in-memory check of slot boundaries, historical/case-normalized and
  negative author signals, read/unmatched exclusion, tagless posts, unread totals,
  cached author labels, nested post rendering, and empty slots.
- [x] One-off in-memory check that author-only unread slots appear and disappear
  with the last matching post's read state.

## Validation

`signal-record` enforces these server-side constraints:

- The selected author must match the cached or cryptographically verified target author.
- Submitted topics are normalized and constrained to the target's current direct topics.
- At most 32 topics may be selected.
- Each normalized topic is limited to 128 UTF-8 bytes.
- The serialized topic list is limited to 4096 UTF-8 bytes.
- Uncached raw targets must have a matching event ID and valid Nostr signature.
- Create and Without Signal accept only their corresponding mode updates.

Public command input cannot provide arbitrary continuation actions. Renderers construct only allow-listed command and client-action sequences.

## Delivery Semantics

Public publication is authoritative. If a relay accepts an action but local interaction or signal recording later fails, the public action remains successful and the local failure is surfaced without automatic retry or startup reconstruction.

Repeating the same Create command is idempotent for the same target and signal type. A later successful reviewed Create decision replaces the prior selected features for that key.

## Implementation Map

- `commands/signal-review/`: derives target data and renders standalone review.
- `commands/signal-record/`: validates and persists reviewed outcomes.
- `commands/list/renderers/web.ts`: wires review modes and candidate features into Archive, Like, Reply, Repost/Quote, and local actions.
- `commands/settings/`: exposes review-mode controls.
- `commands/shared/types.ts`: defines signal, review, and list contracts.
- `db.ts`: owns signal persistence, target lookup, and learned ranking.
- `settings.ts`: owns review-mode defaults and persistence.
- `context.ts`: converts positive and negative topic signals into classifier context.

Generic web support for repeated form values, modal cancellation, command sequencing, and interaction continuations remains plugin-agnostic in AppWeaver core.

## Release Verification

Before publishing the major release, manually verify:

- Archive in `ask`, `always`, and `never` modes.
- Like cancellation, publication failure, and successful signal creation.
- Reply Create and Without Signal outcomes from one composer.
- Repost and Quote outcomes from one panel.
- Local Like/Dislike activation, switching, cancellation, and clearing.
- Remembered mode changes only after successful actions.
- Exact topic and author selections survive restart.
- Existing explicit author preferences remain independent.
- A fresh database creates the final signal schema.
