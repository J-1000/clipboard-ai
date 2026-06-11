import type { Action, ActionContext, ActionResult } from "../lib/types.js";
import { executeAIAction } from "../lib/execute.js";

export const translate: Action = {
  metadata: {
    id: "translate",
    name: "Translate",
    description: "Translate text to another language",
    triggers: [],
  },

  async execute(
    ctx: ActionContext & { targetLang?: string }
  ): Promise<ActionResult> {
    const targetLang = ctx.targetLang || "English";

    return executeAIAction(ctx, {
      systemPrompt: `You are a translator. Translate the text to ${targetLang}. Only output the translation, nothing else.`,
      userPrompt: ctx.text,
      maxTokens: 1024,
    });
  },
};

export default translate;
