// ---------------------------------------------------------------------------
// plugins/nr/format.ts — Display helpers for the nr plugin
// ---------------------------------------------------------------------------
import type { Nr, NrListData, NrTagGroup } from './commands/shared/types';

export function formatNrs(items: Nr[]): string {
  if (items.length === 0) {
    return 'No cached Nostr events.';
  }

  return items
    .map((t) => `  ${t.id} ${t.summary || t.content.slice(0, 80)}`)
    .join('\n');
}

function formatGroups(title: string, groups: NrTagGroup[]): string[] {
  if (groups.length === 0) {
    return [title, '  (none)'];
  }

  return [
    title,
    ...groups.map((group) => `  ${group.tag} (${group.unreadCount})`),
  ];
}

export function formatNrListData(listData: NrListData): string {
  const noun = listData.mode === 'archive' ? 'archived' : 'unread';

  if (listData.unreadTotal === 0) {
    return `No ${noun} cached Nostr events.`;
  }

  if (listData.mode === 'for-you') {
    return [
      `For You events: ${listData.forYouEvents.length}`,
      '',
      ...listData.forYouEvents.map(
        (event) =>
          `  ${event.id} ${event.summary || event.content.slice(0, 80)}`,
      ),
    ].join('\n');
  }

  return [
    `${noun[0]?.toUpperCase() ?? ''}${noun.slice(1)} events: ${listData.unreadTotal}`,
    '',
    ...formatGroups('Topics', listData.topicGroups),
    '',
    ...formatGroups('Moods', listData.moodGroups),
    '',
    ...formatGroups('Languages', listData.languageGroups),
  ].join('\n');
}

export function formatNrDetail(t: Nr): string {
  return [
    `ID:   ${t.id}`,
    `Author: ${t.pubkey}`,
    `Created: ${new Date(t.event_created_at * 1000).toLocaleString()}`,
    `Topics: ${t.topics.join(', ')}`,
    `Moods: ${t.moods.join(', ')}`,
    `Summary: ${t.summary}`,
    `Content: ${t.content}`,
  ].join('\n');
}
