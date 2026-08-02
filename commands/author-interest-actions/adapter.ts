import type { ClientViewRoot } from '@src/web/ui-schema';

import { getNrAuthorPreference } from '../../db';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import { authorPreferenceActions } from '../list/renderers/profile';
import type { NrListMode } from '../shared/types';

export function adaptAuthorInterestActionsCommand(
  params: NrCommandAdapterParams,
): ClientViewRoot | string {
  const pubkey = params.parsed.options.pubkey;
  const mode = params.parsed.options.mode;

  if (
    typeof pubkey !== 'string' ||
    !pubkey.trim() ||
    (mode !== 'timeline' &&
      mode !== 'archive' &&
      mode !== 'for-you' &&
      mode !== 'profile')
  ) {
    return 'Missing private author preference query fields.';
  }

  const preference = getNrAuthorPreference({
    db: params.db,
    pubkey,
  });

  return {
    kind: 'client_view',
    version: 1,
    view: 'web.action-list',
    meta: {
      command: params.alias,
      subcommand: 'author-interest-actions',
    },
    payload: {
      actions: authorPreferenceActions({
        alias: params.alias,
        pubkey,
        mode: mode as NrListMode,
        preference: preference?.preference ?? null,
      }),
    },
  };
}
