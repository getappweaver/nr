import { renderHelpText } from '@src/commands/help/renderers/text';
import type { HelpRepresentation } from '@src/commands/help/representation';
import type { TextRenderContext } from '@src/system/render-context';

import type { MessageRepresentation } from './output';
import type { Nr } from './types';

export type NrListWebRepresentation = {
  kind: 'list_web';
  version: 1;
  meta: {
    command: string;
    subcommand: string;
  };
  data: {
    items: Nr[];
  };
};

export type NrShowWebRepresentation = {
  kind: 'show_web';
  version: 1;
  meta: {
    command: string;
    subcommand: string;
  };
  data: {
    item: Nr;
  };
};

export type NrRenderable =
  | HelpRepresentation
  | MessageRepresentation
  | NrListWebRepresentation
  | NrShowWebRepresentation;

export function isNrListWebRepresentation(
  representation: NrRenderable,
): representation is NrListWebRepresentation {
  return representation.kind === 'list_web';
}

export function isNrShowWebRepresentation(
  representation: NrRenderable,
): representation is NrShowWebRepresentation {
  return representation.kind === 'show_web';
}

export function renderNrText(
  representation: HelpRepresentation | MessageRepresentation,
  context: TextRenderContext,
): string {
  if (representation.kind === 'help') {
    return renderHelpText(representation, context);
  }

  return representation.data.text;
}
