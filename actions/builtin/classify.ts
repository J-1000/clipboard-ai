import type { Action, ActionContext, ActionResult } from "../lib/types.js";
import { executeAIAction } from "../lib/execute.js";

export const classify: Action = {
  metadata: {
    id: "classify",
    name: "Classify",
    description: "Categorize clipboard content by type",
    triggers: [],
  },

  async execute(ctx: ActionContext): Promise<ActionResult> {
    return executeAIAction(ctx, {
      systemPrompt:
        "You are a content classifier. Categorize the given text into exactly one of these categories: email, code, url, log, article, chat, command, data, error, other. Respond with JSON only: {\"category\": \"...\", \"confidence\": 0.0-1.0, \"reasoning\": \"...\"}",
      userPrompt: `Classify this content:\n\n${ctx.text}`,
      maxTokens: 256,
    });
  },
};

export default classify;
