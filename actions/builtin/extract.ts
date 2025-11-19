import type { Action, ActionContext, ActionResult } from "../lib/types.js";
import OpenAI from "openai";

export const extract: Action = {
  metadata: {
    id: "extract",
    name: "Extract Data",
    description: "Extract structured data from text",
    triggers: [],
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
              "You are a data extraction assistant. Extract key information from the text and output it in a structured format. Use JSON when appropriate.",
          },
          {
            role: "user",
            content: `Extract structured data from the following:\n\n${ctx.text}`,
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

export default extract;
