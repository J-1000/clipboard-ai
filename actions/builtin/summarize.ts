import type { Action, ActionContext, ActionResult } from "../lib/types.js";
import OpenAI from "openai";

export const summarize: Action = {
  metadata: {
    id: "summarize",
    name: "Summarize",
    description: "Create a concise summary of the text",
    triggers: ["length > 200"],
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
            content: "You are a helpful assistant. Provide concise summaries.",
          },
          {
            role: "user",
            content: `Summarize the following text:\n\n${ctx.text}`,
          },
        ],
        max_tokens: 512,
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

export default summarize;
