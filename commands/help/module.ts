import type {
  CommandArgumentDefinition,
  CommandDefinition,
  CommandOptionDefinition,
} from '@src/system/command-definition';

import { commandDefinition } from '../../definition';

function formatArgument(argument: CommandArgumentDefinition): string {
  const value = argument.variadic
    ? `<${argument.name}...>`
    : `<${argument.name}>`;

  return argument.required ? value : `[${value}]`;
}

function formatOption(option: CommandOptionDefinition): string {
  const value =
    option.kind === 'boolean' ? option.flag : `${option.flag} <${option.name}>`;

  return option.required ? value : `[${value}]`;
}

function formatSubcommandUsage(params: {
  prefix: string;
  alias: string;
  command: CommandDefinition;
}): string[] {
  const subcommands = params.command.subcommands ?? [];

  return subcommands.map((subcommand) => {
    const arguments_ = subcommand.arguments ?? [];
    const options = subcommand.options ?? [];

    const parts = [
      `${params.prefix}${params.alias}`,
      subcommand.name,
      ...arguments_.map(formatArgument),
      ...options.map(formatOption),
    ];

    return `${parts.join(' ')} — ${subcommand.summary}`;
  });
}

export function getNrHelpLines(prefix: string, alias: string): string[] {
  const command = commandDefinition(prefix, alias);

  return [
    'Available subcommands:',
    ...formatSubcommandUsage({
      prefix,
      alias,
      command,
    }),
  ];
}

export function getNrCommandDefinition(
  prefix: string,
  alias: string,
): CommandDefinition {
  return commandDefinition(prefix, alias);
}
