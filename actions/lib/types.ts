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
