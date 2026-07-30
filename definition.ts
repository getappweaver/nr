import { createHelpSubcommandDefinition } from '@src/commands/help/command';
import type { CommandDefinition } from '@src/system/command-definition';

import { authorInterestRecordDefinition } from './commands/author-interest-record/definition';
import { contextDefinition } from './commands/context/definition';
import { fetchLatestDefinition } from './commands/fetch-latest/definition';
import { interactionRecordDefinition } from './commands/interaction-record/definition';
import { interestRecordDefinition } from './commands/interest-record/definition';
import { listDefinition } from './commands/list/definition';
import { listParseSingleDefinition } from './commands/list-parse-single/definition';
import { markDefinition } from './commands/mark/definition';
import { parseDefinition } from './commands/parse/definition';
import { reevaluateDefinition } from './commands/reevaluate/definition';
import { settingsDefinition } from './commands/settings/definition';
import { scheduleDefinition } from './commands/schedule/definition';
import { taxonomyDefinition } from './commands/taxonomy/definition';

export const commandDefinition = (
  prefix: string,
  alias: string,
): CommandDefinition => ({
  name: alias,
  summary:
    'Nostr radar: parse Nostr events, classify them, and mark read/archive state.',
  aliases: [],
  subcommands: [
    createHelpSubcommandDefinition(prefix, alias, {
      topicArgSummary:
        'Optional subcommand: list, fetch-latest, parse, mark, reevaluate, settings, context, …',
      exampleTopics: ['parse', 'list', 'mark'],
    }),
    parseDefinition(prefix, alias),
    markDefinition(prefix, alias),
    reevaluateDefinition(prefix, alias),
    settingsDefinition(prefix, alias),
    scheduleDefinition(prefix, alias),
    contextDefinition(prefix, alias),
    taxonomyDefinition(),
    fetchLatestDefinition(prefix, alias),
    interactionRecordDefinition(),
    interestRecordDefinition(),
    authorInterestRecordDefinition(),
    listParseSingleDefinition(prefix, alias),
    listDefinition(prefix, alias),
  ],
});
