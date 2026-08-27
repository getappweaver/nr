// ---------------------------------------------------------------------------
// plugins/nr/adapter.ts — parse CLI + dispatch to command adapters
// ---------------------------------------------------------------------------

import type { Database } from 'bun:sqlite';

import type {
  PluginAgentService,
  PluginIdentity,
  SendReplyFn,
} from '@src/core/plugin';
import type { MessageSource } from '@src/messaging';
import { parseCliInput, parseStructuredInput } from '@src/system/parser-cli';
import type { WebHandlerResult } from '@src/web/ui-schema';

import { adaptAuthorInterestActionsCommand } from './commands/author-interest-actions/adapter';
import { adaptAuthorInterestRecordCommand } from './commands/author-interest-record/adapter';
import { adaptContextCommand } from './commands/context/adapter';
import { adaptFetchLatestCommand } from './commands/fetch-latest/adapter';
import { adaptHelpCommand } from './commands/help/adapter';
import { getNrCommandDefinition } from './commands/help/module';
import { adaptInteractionRecordCommand } from './commands/interaction-record/adapter';
import { adaptInterestRecordCommand } from './commands/interest-record/adapter';
import { adaptListCommand } from './commands/list/adapter';
import { adaptListParseSingleCommand } from './commands/list-parse-single/adapter';
import { adaptMarkCommand } from './commands/mark/adapter';
import { adaptParseCommand } from './commands/parse/adapter';
import { adaptReadCommand } from './commands/read/adapter';
import { adaptReevaluateCommand } from './commands/reevaluate/adapter';
import { adaptScheduleCommand } from './commands/schedule/adapter';
import { adaptSettingsCommand } from './commands/settings/adapter';
import { adaptSignalRecordCommand } from './commands/signal-record/adapter';
import { adaptSignalReviewCommand } from './commands/signal-review/adapter';
import { adaptTaxonomyCommand } from './commands/taxonomy/adapter';
import type {
  NrCommandAdapterParams,
  NrRuntimeContext,
} from './types/adapter-params';

type NrSubcommand =
  | 'help'
  | 'parse'
  | 'mark'
  | 'read'
  | 'reevaluate'
  | 'reclassify'
  | 'settings'
  | 'signal-review'
  | 'signal-record'
  | 'schedule'
  | 'context'
  | 'taxonomy'
  | 'fetch-latest'
  | 'latest'
  | 'interaction-record'
  | 'interest-record'
  | 'author-interest-actions'
  | 'author-interest-record'
  | 'debug'
  | 'list-parse-single'
  | 'list';

type MaybePromise<T> = T | Promise<T>;

type NrCommandAdapter = (
  params: NrCommandAdapterParams,
) => MaybePromise<WebHandlerResult>;

const normalizedDefinitions = new Map<
  string,
  ReturnType<typeof getNrCommandDefinition>
>();

const subcommandAdapters: Record<NrSubcommand, NrCommandAdapter> = {
  help: adaptHelpCommand,
  parse: adaptParseCommand,
  mark: adaptMarkCommand,
  read: adaptReadCommand,
  reevaluate: adaptReevaluateCommand,
  reclassify: adaptReevaluateCommand,
  settings: adaptSettingsCommand,
  'signal-review': adaptSignalReviewCommand,
  'signal-record': adaptSignalRecordCommand,
  schedule: adaptScheduleCommand,
  context: adaptContextCommand,
  taxonomy: adaptTaxonomyCommand,
  'fetch-latest': adaptFetchLatestCommand,
  latest: adaptFetchLatestCommand,
  'interaction-record': adaptInteractionRecordCommand,
  'interest-record': adaptInterestRecordCommand,
  'author-interest-actions': adaptAuthorInterestActionsCommand,
  'author-interest-record': adaptAuthorInterestRecordCommand,
  debug: adaptListParseSingleCommand,
  'list-parse-single': adaptListParseSingleCommand,
  list: adaptListCommand,
};

function getDefinitionKey(prefix: string, alias: string): string {
  return `${prefix}:${alias}`;
}

function getNormalizedDefinition(prefix: string, alias: string) {
  const key = getDefinitionKey(prefix, alias);
  const cached = normalizedDefinitions.get(key);

  if (cached) {
    return cached;
  }

  const normalized = getNrCommandDefinition(prefix, alias);

  normalizedDefinitions.set(key, normalized);

  return normalized;
}

function isNrSubcommand(value: string): value is NrSubcommand {
  return (
    value === 'help' ||
    value === 'parse' ||
    value === 'mark' ||
    value === 'read' ||
    value === 'reevaluate' ||
    value === 'reclassify' ||
    value === 'settings' ||
    value === 'signal-review' ||
    value === 'signal-record' ||
    value === 'schedule' ||
    value === 'context' ||
    value === 'taxonomy' ||
    value === 'fetch-latest' ||
    value === 'latest' ||
    value === 'interaction-record' ||
    value === 'interest-record' ||
    value === 'author-interest-actions' ||
    value === 'author-interest-record' ||
    value === 'debug' ||
    value === 'list-parse-single' ||
    value === 'list'
  );
}

type HandleNrAdapterProps = {
  args: string[];
  prefix: string;
  alias: string;
  db: Database;
  source: MessageSource;
  identity: PluginIdentity;
  storedCtx: NrRuntimeContext;
  agent: PluginAgentService;
  sendReply: SendReplyFn | null;
  jsonPayload: unknown;
};

function isStructuredWebPayload(value: unknown): value is {
  arguments?: Record<string, unknown>;
  options?: Record<string, unknown>;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as { arguments?: unknown; options?: unknown };

  const hasValidArguments =
    candidate.arguments === undefined ||
    (typeof candidate.arguments === 'object' &&
      candidate.arguments !== null &&
      !Array.isArray(candidate.arguments));

  const hasValidOptions =
    candidate.options === undefined ||
    (typeof candidate.options === 'object' &&
      candidate.options !== null &&
      !Array.isArray(candidate.options));

  return hasValidArguments && hasValidOptions;
}

export async function handleNrAdapter({
  args,
  prefix,
  alias,
  db,
  source,
  identity,
  storedCtx,
  agent,
  sendReply,
  jsonPayload,
}: HandleNrAdapterProps): Promise<WebHandlerResult> {
  void storedCtx;

  const normalizedArgs = args.length === 0 ? ['help'] : args;
  const subcommand = normalizedArgs[0]?.toLowerCase();

  if (!isNrSubcommand(subcommand)) {
    return `Unknown command: ${prefix}${alias} ${subcommand ?? 'unknown'}`;
  }

  try {
    const command = getNormalizedDefinition(prefix, alias);

    const parsed =
      source === 'web' && isStructuredWebPayload(jsonPayload)
        ? parseStructuredInput({
            command,
            subcommand,
            arguments: jsonPayload.arguments ?? {},
            options: jsonPayload.options ?? {},
            rawInput: `${prefix}${alias} ${subcommand} (web json)`,
          })
        : parseCliInput({
            command,
            tokens: normalizedArgs,
            rawInput: `${prefix}${alias} ${normalizedArgs.join(' ')}`.trim(),
          });

    if (!isNrSubcommand(parsed.subcommand)) {
      return `Unknown command: ${prefix}${alias} ${parsed.subcommand}`;
    }

    const adapter = subcommandAdapters[parsed.subcommand];

    return await adapter({
      prefix,
      alias,
      db,
      source,
      parsed,
      command,
      identity,
      agent,
      sendReply,
      storedCtx,
      jsonPayload,
    });
  } catch (err) {
    return String(err instanceof Error ? err.message : err);
  }
}
