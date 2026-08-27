import type { AiDefinition } from '@src/system/ai-definition';

import { agentInstructions } from './commands/ai/agent-instructions';
import { executeTool } from './commands/ai/execute-tool';
import {
  ToolCallSchema,
  type NrToolCall,
  skillDescription,
  skillRules,
} from './commands/ai/schemas';
import { openDb } from './db';

export type { NrToolCall } from './commands/ai/schemas';
export {
  ToolCallSchema,
  skillDescription,
  skillRules,
} from './commands/ai/schemas';

export const aiDefinition = {
  toolCallSchema: ToolCallSchema,
  skillDescription,
  skillRules,
  openDb,
  executeTool: (props) => {
    if (!props.pool || !props.masterPubkey) {
      throw new Error(
        'nr aiDefinition.executeTool requires pool and masterPubkey',
      );
    }

    return executeTool({
      call: props.call,
      db: props.db,
      agent: props.agent,
      pool: props.pool,
      masterPubkey: props.masterPubkey,
    });
  },
  agentInstructions,
} satisfies AiDefinition<
  typeof ToolCallSchema,
  NrToolCall,
  ReturnType<typeof openDb>
>;
