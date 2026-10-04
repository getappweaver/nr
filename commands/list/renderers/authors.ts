import type { WebNode } from '@src/web/ui-schema';

import type { NrAuthorGroup } from '../../shared/types';

import { groupEventNodes, type ListModeNodesProps } from './event-nodes';
import { el, text } from './primitives';

type AuthorsSectionNodeProps = ListModeNodesProps & {
  authorGroups: NrAuthorGroup[];
};

export function authorsSectionNode({
  authorGroups,
  ...postProps
}: AuthorsSectionNodeProps): WebNode {
  const { profiles, mode } = postProps;

  return {
    type: 'element',
    tag: 'treeItem',
    renderKey: `nr:${mode}:section:author`,
    props: {
      id: 'nr-section-authors',
      defaultExpanded: false,
      filterName: 'Authors',
      filterText: 'Authors',
    },
    summary: el('row', { gap: 'xs', itemAlign: 'center', fill: true }, [
      el('countLabel', { label: 'Authors', weight: 'bold' }, []),
    ]),
    children:
      authorGroups.length === 0
        ? [el('text', { tone: 'muted', size: 'sm' }, [text('(none)')])]
        : authorGroups.map(({ pubkey, events }) => {
            const profile = profiles.get(pubkey);

            const label =
              profile?.displayName?.trim() ||
              profile?.name?.trim() ||
              pubkey.slice(0, 12);

            return {
              type: 'element',
              tag: 'treeItem',
              renderKey: `nr:${mode}:group:author:${pubkey}`,
              props: {
                id: `nr-author-${pubkey}`,
                entityKey: `nr-author:${pubkey}`,
                defaultExpanded: false,
                filterName: label,
                filterText: `${label} ${pubkey}`,
                filterPath: `author/${pubkey}`,
                pruneWhenNoTreeItems: true,
              },
              summary: el(
                'row',
                { gap: 'xs', itemAlign: 'center', fill: true },
                [el('countLabel', { label, weight: 'semibold' }, [])],
              ),
              children: groupEventNodes({
                ...postProps,
                events,
                renderScope: `author:${pubkey}`,
              }),
            };
          }),
  };
}
