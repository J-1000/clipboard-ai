import type { Action, ActionContext, ActionResult } from "../lib/types.js";
import OpenAI from "openai";

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

    try {
      const client = new OpenAI({
        baseURL: ctx.config.provider.endpoint,
        apiKey: ctx.config.provider.apiKey || "dummy",
      });

      const response = await client.chat.completions.create({
        model: ctx.config.provider.model,
        messages: [
          {
            role: "system",
            content: `You are a translator. Translate the text to ${targetLang}. Only output the translation, nothing else.`,
          },
          {
            role: "user",
            content: ctx.text,
          },
        ],
        max_tokens: 1024,
      });

      return {
        success: true,
        output: response.choices[0]?.message.content || "",
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  },
};

export default translate;
