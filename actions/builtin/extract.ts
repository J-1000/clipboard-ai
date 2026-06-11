import type { Action, ActionContext, ActionResult } from "../lib/types.js";
import { executeAIAction } from "../lib/execute.js";

export const extract: Action = {
  metadata: {
    id: "extract",
    name: "Extract Data",
    description: "Extract structured data from text",
    triggers: [],
  },

  async execute(ctx: ActionContext): Promise<ActionResult> {
    return executeAIAction(ctx, {
      systemPrompt:
        "You are a data extraction assistant. Extract key information from the text and output it in a structured format. Use JSON when appropriate.",
      userPrompt: `Extract structured data from the following:\n\n${ctx.text}`,
      maxTokens: 1024,
    });
  },
};

export default extract;
