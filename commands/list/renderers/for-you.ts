import type { WebNode } from '@src/web/ui-schema';

import { nrListCommandAction } from '../list-options';

import { groupEventNodes, type ListModeNodesProps } from './event-nodes';
import { el, text } from './primitives';

export function forYouNodes({
  alias,
  forYouEvents,
  forYouHasMore,
  profiles,
  interactions,
  localPreferences,
  authorPreferences,
  sharePrefixes,
  translationTargetLanguage,
  rankingScores,
  archiveSignalReviewMode,
  likeSignalReviewMode,
  replySignalReviewMode,
  repostQuoteSignalReviewMode,
  resolveReferencesAutomatically,
  mode,
  selectedTimeRanges,
}: ListModeNodesProps): WebNode[] {
  return [
    ...groupEventNodes({
      alias,
      events: forYouEvents,
      profiles,
      interactions,
      localPreferences,
      authorPreferences,
      sharePrefixes,
      translationTargetLanguage,
      rankingScores,
      archiveSignalReviewMode,
      likeSignalReviewMode,
      replySignalReviewMode,
      repostQuoteSignalReviewMode,
      resolveReferencesAutomatically,
      mode,
      renderScope: 'for-you',
    }),
    el(
      'treeEmpty',
      { className: 'nr-for-you-empty' },
      forYouHasMore
        ? [
            el(
              'button',
              {
                label: 'Load next 25',
                action: nrListCommandAction({
                  alias,
                  mode: 'for-you',
                  selectedTimeRanges,
                }),
              },
              [],
            ),
          ]
        : [
            el('text', { tone: 'muted' }, [
              text('No unread For You posts found.'),
            ]),
          ],
    ),
  ];
}
