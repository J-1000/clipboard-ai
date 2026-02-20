import type { AIClient } from "./ai.js";
import type { ConfigResponse } from "./client.js";

export interface ActionContext {
  text: string;
  ai: AIClient;
  config: ConfigResponse;
  args: string[];
}

export interface ActionDefinition {
  id: string;
  aliases?: string[];
  description: string;
  progressMessage?: string;
  outputTitle: string;
  run(ctx: ActionContext): Promise<string>;
}
