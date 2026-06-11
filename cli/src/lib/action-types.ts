import type { AIClient } from "./ai.js";
import type { ConfigResponse } from "./client.js";

// CLI action definitions are the runtime/plugin contract used by cbai. They
// receive an injected AIClient and return displayable strings. The separate
// actions package exposes library-style actions with metadata/execute() and
// ActionResult so those actions can be tested and packaged independently.
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
