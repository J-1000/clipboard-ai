import type { Action, ActionContext, ActionResult } from "../lib/types.js";
import { executeAIAction } from "../lib/execute.js";

export const explain: Action = {
  metadata: {
    id: "explain",
    name: "Explain",
    description: "Explain the content, especially useful for code",
    triggers: ["mime:code"],
  },

  async execute(ctx: ActionContext): Promise<ActionResult> {
    return executeAIAction(ctx, {
      systemPrompt:
        "You are a helpful assistant. If the content looks like code, explain what it does. Otherwise, explain the meaning and context.",
      userPrompt: `Explain the following:\n\n${ctx.text}`,
      maxTokens: 1024,
    });
  },
};

export default explain;
