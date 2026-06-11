// The actions package is a standalone action library. Its contract returns
// ActionResult objects and can be executed outside the CLI runner. The CLI's
// plugin/runtime action shape in cli/src/lib/action-types.ts is intentionally
// separate because it injects an AIClient and expects run() to return a string.
export interface ActionMetadata {
  id: string;
  name: string;
  description: string;
  triggers?: string[];
}

export interface ActionContext {
  text: string;
  contentType: string;
  config: {
    provider: {
      type: string;
      endpoint: string;
      model: string;
      apiKey?: string;
    };
  };
}

export interface ActionResult {
  success: boolean;
  output?: string;
  error?: string;
}

export type ActionHandler = (ctx: ActionContext) => Promise<ActionResult>;

export interface Action {
  metadata: ActionMetadata;
  execute: ActionHandler;
}
