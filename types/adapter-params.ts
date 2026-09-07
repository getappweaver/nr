import type { Database } from 'bun:sqlite';

import type {
  PluginContext,
  PluginAgentService,
  PluginIdentity,
  SendReplyFn,
} from '@src/core/plugin';
import type { MessageSource } from '@src/messaging';
import type { ParsedCliInvocation } from '@src/system/parser-cli';

import type { getNrCommandDefinition } from '../commands/help/module';

export type NrRuntimeContext = Pick<
  PluginContext,
  | 'pool'
  | 'masterPubkey'
  | 'wot'
  | 'nostrResolution'
  | 'agent'
  | 'sendWebPush'
  | 'getRoutstrSkKey'
  | 'capabilities'
  | 'monitoring'
>;

export type NrCommandAdapterParams = {
  prefix: string;
  alias: string;
  db: Database;
  source: MessageSource;
  parsed: ParsedCliInvocation;
  command: ReturnType<typeof getNrCommandDefinition>;
  identity: PluginIdentity;
  agent: PluginAgentService;
  sendReply: SendReplyFn | null;
  storedCtx: NrRuntimeContext;
  jsonPayload: unknown;
};
