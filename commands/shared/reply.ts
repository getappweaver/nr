import {
  createMessageRepresentation,
  type MessageRepresentation,
} from './output';

export function toneForPlainReply(text: string): 'info' | 'success' | 'error' {
  if (text.startsWith('Usage:')) {
    return 'error';
  }

  if (text.startsWith('Failed')) {
    return 'error';
  }

  if (text.includes('requires an agent backend')) {
    return 'error';
  }

  if (text.startsWith('No nrs.')) {
    return 'info';
  }

  return 'success';
}

export function NrReplyMessage(params: {
  alias: string;
  subcommand: string;
  text: string;
}): MessageRepresentation {
  return createMessageRepresentation({
    command: params.alias,
    subcommand: params.subcommand,
    tone: toneForPlainReply(params.text),
    text: params.text,
  });
}
