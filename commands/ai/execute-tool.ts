import type { Database } from 'bun:sqlite';
import type { SimplePool } from 'nostr-tools/pool';
import { getPublicKey } from 'nostr-tools/pure';
import { hexToBytes } from 'nostr-tools/utils';

import {
  capabilityRegistry,
  createCapabilityClient,
} from '@src/core/capabilities/registry';
import { monitoring } from '@src/core/monitoring';
import type { PluginAgentService } from '@src/core/plugin';
import { getRoutstrSkKey, initSkKeyEncryption, openCoreDb } from '@src/db';
import { loadBotConfig } from '@src/env';
import { openNostrCacheDb } from '@src/nostr/cache/db';
import { PROFILE_RELAYS_FOR_QUERY } from '@src/nostr/nip65';
import {
  allowRelayOperation,
  filterBlockedReadRelays,
  installRelayNoticeTracking,
} from '@src/nostr/relay-notices';
import { createNostrResolutionService } from '@src/nostr/resolution-service';
import { createWotServices } from '@src/nostr/wot-service';
import { notifyAllWebPushSubscriptions } from '@src/web/push-send';

import { fetchEvaluate } from '../fetch-latest/adapter';

import type { NrToolCall } from './schemas';

type ExecuteToolProps = {
  call: NrToolCall;
  db: Database;
  pool: SimplePool;
  masterPubkey: string;
  agent: PluginAgentService;
};

const HOUR_SECONDS = 60 * 60;

export async function executeTool({
  call,
  db,
  pool,
  masterPubkey,
  agent,
}: ExecuteToolProps): Promise<string> {
  void call.window;

  const config = loadBotConfig();
  const coreDb = openCoreDb();

  const botPubkey =
    config.botPubkey ?? getPublicKey(hexToBytes(config.botKeyHex));

  initSkKeyEncryption(config.botKeyHex, botPubkey);
  pool.allowConnectingToRelay = allowRelayOperation;
  installRelayNoticeTracking(pool);

  const nostrCacheDb = openNostrCacheDb();

  const nostrResolutionRuntime = createNostrResolutionService({
    db: nostrCacheDb,
    pool,
    nowMs: Date.now,
    filterReadRelays: filterBlockedReadRelays,
    profileRelays: PROFILE_RELAYS_FOR_QUERY,
    closeDbOnShutdown: false,
  });

  try {
    const until =
      Math.floor(Math.floor(Date.now() / 1000) / HOUR_SECONDS) * HOUR_SECONDS;

    const since = until - HOUR_SECONDS;

    return await fetchEvaluate({
      params: {
        db,
        source: 'local',
        agent,
        sendReply: null,
        storedCtx: {
          pool,
          masterPubkey,
          wot: createWotServices({
            db: coreDb,
            nostrResolution: nostrResolutionRuntime.service,
            rootPubkey: masterPubkey,
            fallbackRelays: config.botRelayUrls,
          }),
          nostrResolution: nostrResolutionRuntime.service,
          agent,
          sendWebPush: async ({ title, body, url }) => {
            if (config.webPush === null) {
              return { status: 'disabled' as const };
            }

            const summary = await notifyAllWebPushSubscriptions({
              db: coreDb,
              config: config.webPush,
              title,
              body,
              url,
            });

            return { status: 'complete' as const, ...summary };
          },
          getRoutstrSkKey: () => getRoutstrSkKey(coreDb),
          capabilities: createCapabilityClient({
            registry: capabilityRegistry,
            caller: {
              type: 'plugin',
              pluginName: 'appweaver-nr-plugin',
              alias: 'nr',
            },
          }),
          monitoring,
        },
      },
      peopleLimit: null,
      sinceHours: 1,
      explicitSince: since,
      explicitUntil: until,
      limit: 50,
      oneOffInstructions: null,
      waitForRelayListRefresh: true,
    });
  } finally {
    try {
      await nostrResolutionRuntime.shutdown();
    } finally {
      nostrCacheDb.close();
      coreDb.close();
    }
  }
}
