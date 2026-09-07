import { expect, mock, test } from 'bun:test';

import type { MessageSource } from '@src/messaging';

import type { NrRuntimeContext } from '../../types/adapter-params';

import { sendFetchCompletionNotification } from './adapter';

for (const source of ['web', 'local'] satisfies MessageSource[]) {
  test(`sends the fetch completion push for ${source} execution`, async () => {
    const sendWebPush = mock(async () => ({ status: 'disabled' as const }));

    await sendFetchCompletionNotification({
      params: {
        source,
        storedCtx: { sendWebPush } as unknown as NrRuntimeContext,
      },
      result:
        'Fetched latest notes from follows.\nSummary: 3 stored, 2 skipped/deferred, 0 failed.\nExtra details',
    });

    expect(sendWebPush).toHaveBeenCalledWith({
      title: 'Nostr Radar fetch finished',
      body: 'Fetched latest notes from follows.\nSummary: 3 stored, 2 skipped/deferred, 0 failed.',
      url: '/?command=nr&subcommand=list',
    });
  });
}

test('does not fail a completed fetch when Web Push rejects', async () => {
  await expect(
    sendFetchCompletionNotification({
      params: {
        source: 'local',
        storedCtx: {
          sendWebPush: async () => {
            throw new Error('push service unavailable');
          },
        } as unknown as NrRuntimeContext,
      },
      result: 'Fetched latest notes from follows.',
    }),
  ).resolves.toBeUndefined();
});
