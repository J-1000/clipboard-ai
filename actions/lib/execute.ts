import OpenAI from "openai";
import type { ActionContext, ActionResult } from "./types.js";
import {
  isOpenAICompatibleProvider,
  openAICompatibilityError,
} from "./provider.js";

export interface ExecuteAIActionOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export async function executeAIAction(
  ctx: ActionContext,
  options: ExecuteAIActionOptions
): Promise<ActionResult> {
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
          content: options.systemPrompt,
        },
        {
          role: "user",
          content: options.userPrompt,
        },
      ],
      max_tokens: options.maxTokens ?? 1024,
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
}
