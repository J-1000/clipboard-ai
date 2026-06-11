import type { Action, ActionContext, ActionResult } from "../lib/types.js";
import { executeAIAction } from "../lib/execute.js";

export const summarize: Action = {
  metadata: {
    id: "summarize",
    name: "Summarize",
    description: "Create a concise summary of the text",
    triggers: ["length > 200"],
  },

  async execute(ctx: ActionContext): Promise<ActionResult> {
    return executeAIAction(ctx, {
      systemPrompt: "You are a helpful assistant. Provide concise summaries.",
      userPrompt: `Summarize the following text:\n\n${ctx.text}`,
      maxTokens: 512,
    });
  },
};

export default summarize;
