import type { WebNostrPostExtraAction } from '@src/web/ui-schema';

import type { NrAuthorPreferenceValue, NrListMode } from '../../shared/types';

type AuthorPreferenceActionProps = {
  alias: string;
  pubkey: string;
  mode: NrListMode;
  preference: NrAuthorPreferenceValue | null;
};

type AuthorPreferenceCommandActionProps = {
  alias: string;
  pubkey: string;
  mode: NrListMode;
  preference: NrAuthorPreferenceValue | 'none';
};

function authorPreferenceCommandAction({
  alias,
  pubkey,
  mode,
  preference,
}: AuthorPreferenceCommandActionProps) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'author-interest-record',
    arguments: {},
    options: { pubkey, preference },
    recordInTimeline: false,
    pendingUi: { presentation: 'entity' as const, label: 'Updating...' },
    refresh: {
      command: alias,
      subcommand: 'list',
      arguments: {},
      options: { mode },
      recordInTimeline: false,
      target: 'taskbar' as const,
    },
  };
}

export function authorPreferenceActions({
  alias,
  pubkey,
  mode,
  preference,
}: AuthorPreferenceActionProps): WebNostrPostExtraAction[] {
  return [
    {
      optimisticKey: 'author-like',
      label: preference === 'like' ? 'clear 👍' : '👍 author',
      inactiveLabel: '👍 author',
      activeLabel: 'clear 👍',
      ariaLabel:
        preference === 'like'
          ? 'Remove positive author preference'
          : 'Show more posts from this author',
      action: authorPreferenceCommandAction({
        alias,
        pubkey,
        mode,
        preference: preference === 'like' ? 'none' : 'like',
      }),
      disabled: false,
      active: preference === 'like',
    },
    {
      optimisticKey: 'author-dislike',
      label: preference === 'dislike' ? 'clear 👎' : '👎 author',
      inactiveLabel: '👎 author',
      activeLabel: 'clear 👎',
      ariaLabel:
        preference === 'dislike'
          ? 'Remove negative author preference'
          : 'Show fewer posts from this author',
      action: authorPreferenceCommandAction({
        alias,
        pubkey,
        mode,
        preference: preference === 'dislike' ? 'none' : 'dislike',
      }),
      disabled: false,
      active: preference === 'dislike',
    },
  ];
}

export function authorPreferenceActionsReadAction({
  alias,
  pubkey,
  mode,
}: Omit<AuthorPreferenceActionProps, 'preference'>) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'author-interest-actions',
    arguments: {},
    options: { pubkey, mode },
    recordInTimeline: false,
    pendingUi: { presentation: 'none' as const },
  };
}
