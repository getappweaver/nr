import { z } from 'zod';

import { createRepresentationSchema } from '@src/system/representation';

export const MessageDataSchema = z.object({
  tone: z.enum(['info', 'success', 'error']),
  text: z.string().min(1),
});

export const MessageRepresentationSchema = createRepresentationSchema(
  MessageDataSchema,
).extend({
  kind: z.literal('message'),
});

export type MessageRepresentation = z.infer<typeof MessageRepresentationSchema>;

export function createMessageRepresentation(params: {
  command: string;
  subcommand: string;
  tone: 'info' | 'success' | 'error';
  text: string;
}): MessageRepresentation {
  return {
    kind: 'message',
    version: 1,
    meta: {
      command: params.command,
      subcommand: params.subcommand,
    },
    data: {
      tone: params.tone,
      text: params.text,
    },
  };
}
