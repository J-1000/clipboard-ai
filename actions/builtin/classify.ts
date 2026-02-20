import type { Action, ActionContext, ActionResult } from "../lib/types.js";
import OpenAI from "openai";
import {
  isOpenAICompatibleProvider,
  openAICompatibilityError,
} from "../lib/provider.js";

export const classify: Action = {
  metadata: {
    id: "classify",
    name: "Classify",
    description: "Categorize clipboard content by type",
    triggers: [],
  },

  async execute(ctx: ActionContext): Promise<ActionResult> {
    if (!isOpenAICompatibleProvider(ctx.config.provider.type)) {
      return {
        success: false,
        error: openAICompatibilityError(ctx.config.provider.type),
      };
    }

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
              "You are a content classifier. Categorize the given text into exactly one of these categories: email, code, url, log, article, chat, command, data, error, other. Respond with JSON only: {\"category\": \"...\", \"confidence\": 0.0-1.0, \"reasoning\": \"...\"}",
          },
          {
            role: "user",
            content: `Classify this content:\n\n${ctx.text}`,
          },
        ],
        max_tokens: 256,
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

export default classify;
