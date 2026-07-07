import { buildHelpSubcommandRepresentation } from '@src/commands/help/command';
import { renderHelpText } from '@src/commands/help/renderers/text';

import type { NrCommandAdapterParams } from '../../types/adapter-params';

export function adaptHelpCommand(params: NrCommandAdapterParams): string {
  const result = buildHelpSubcommandRepresentation({
    prefix: params.prefix,
    alias: params.alias,
    command: params.command,
    parsed: params.parsed,
  });

  if (result.type === 'error') {
    return result.message;
  }

  return renderHelpText(result.representation, { prefix: params.prefix });
}
