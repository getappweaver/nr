import type { WebNode } from '@src/web/ui-schema';

import { profileEventNode, type ListModeNodesProps } from './event-nodes';
import { el, text } from './primitives';

export function profileNodes({
  alias,
  profileEvents,
  profiles,
  authorPreferences,
  sharePrefixes,
  translationTargetLanguage,
  mode,
  archivedIds,
}: ListModeNodesProps): WebNode[] {
  if (profileEvents.length === 0) {
    return [
      el('text', { tone: 'muted' }, [
        text('No matching profile events found.'),
      ]),
    ];
  }

  return profileEvents.map((profileEvent) =>
    profileEventNode({
      alias,
      profileEvent,
      profiles,
      authorPreferences,
      sharePrefixes,
      translationTargetLanguage,
      mode,
      renderScope: 'profile',
      archivedIds,
    }),
  );
}
