import type { Action, ActionContext, ActionResult } from "../lib/types.js";
import OpenAI from "openai";

export const explain: Action = {
  metadata: {
    id: "explain",
    name: "Explain",
    description: "Explain the content, especially useful for code",
    triggers: ["mime:code"],
  },

  async execute(ctx: ActionContext): Promise<ActionResult> {
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
            content:
              "You are a helpful assistant. If the content looks like code, explain what it does. Otherwise, explain the meaning and context.",
          },
          {
            role: "user",
            content: `Explain the following:\n\n${ctx.text}`,
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

export default explain;
