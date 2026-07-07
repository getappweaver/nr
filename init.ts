// ---------------------------------------------------------------------------
// plugins/nr/init.ts — NrPlugin definition
// ---------------------------------------------------------------------------

import { basename } from 'path';

import type { Database } from 'bun:sqlite';

import {
  parsePluginPackageJson,
  type BotPlugin,
  type PluginContext,
  type PluginInvocationContext,
} from '@src/core/plugin';
import type { WebHandlerResult } from '@src/web/ui-schema';

import { handleNrAdapter } from './adapter';
import { getNrCommandDefinition, getNrHelpLines } from './commands/help/module';
import { openDb } from './db';

const pluginDir = import.meta.dir;
const alias = basename(pluginDir);

const nrPkg = parsePluginPackageJson({ pluginDir });

if (!nrPkg) {
  throw new Error(
    `Nr plugin: invalid or missing package.json. Required: name, version, dmBot.coreApiVersion, dmBot.description`,
  );
}

export let NrPluginContext: PluginContext | null = null;
export let NrPluginDb: Database | null = null;

export const NrPlugin: BotPlugin = {
  identity: {
    name: nrPkg.name,
    alias,
    version: nrPkg.version,
    description: nrPkg.description,
  },
  handler: async (
    args: string[],
    context: PluginInvocationContext,
  ): Promise<WebHandlerResult> => {
    if (!NrPluginContext) {
      throw new Error('NrPlugin not initialized');
    }

    if (!NrPluginDb) {
      throw new Error('NrPluginDb not initialized');
    }

    return handleNrAdapter({
      args,
      prefix: context.prefix,
      alias,
      db: NrPluginDb,
      source: context.source,
      identity: NrPlugin.identity,
      storedCtx: NrPluginContext,
      runAgent: context.runAgent,
      sendReply: context.sendReply ?? NrPluginContext.sendReply,
      jsonPayload: context.jsonPayload,
    });
  },
  onInit: (ctx: PluginContext) => {
    NrPluginContext = ctx;
    NrPluginDb = openDb();
  },
  helpText: (helpAlias: string, prefix: string) => [
    `Nr: parse Nostr events, classify unread posts into tags/moods, and mark events read globally.`,
    '',
    `${prefix}${helpAlias} help [topic] — structured help`,
    ...getNrHelpLines(prefix, helpAlias),
  ],
  commandDefinition: (prefix: string, pluginAlias: string) =>
    getNrCommandDefinition(prefix, pluginAlias),
};
