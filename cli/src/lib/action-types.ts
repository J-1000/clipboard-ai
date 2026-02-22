import type { AIClient } from "./ai.js";
import type { ConfigResponse } from "./client.js";

export interface ActionContext {
  text: string;
  rtf?: string;
  imageBase64?: string;
  imageMime?: string;
  contentType?: string;
  ai: AIClient;
  config: ConfigResponse;
  args: string[];
}

export interface ActionDefinition {
  id: string;
  aliases?: string[];
  description: string;
  inputTypes?: Array<"text" | "image" | "rtf">;
  progressMessage?: string;
  outputTitle: string;
  run(ctx: ActionContext): Promise<string>;
}
