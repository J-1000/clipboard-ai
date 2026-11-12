import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { getActionRegistry, type ActionRegistry } from "../lib/action-registry.js";
import {
  getConfig,
  runAgentAction,
  type ActionRequest,
  type ActionResponse,
  type ConfigResponse,
} from "../lib/client.js";
import { VERSION } from "../version.js";

const ACTION_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_TEXT_CHARS = 100_000;
const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_CHARS = 4_096;

const actionInputSchema = z.object({
  text: z
    .string()
    .max(MAX_TEXT_CHARS)
    .optional()
    .describe("Text to process. Omit it to use the current clipboard contents."),
  arguments: z
    .array(z.string().max(MAX_ARGUMENT_CHARS))
    .max(MAX_ARGUMENTS)
    .optional()
    .describe("Optional positional arguments, such as a target language for translate."),
});

export interface McpAction {
  id: string;
  title: string;
  description: string;
  inputTypes: Array<"text" | "image" | "rtf">;
}

export interface McpServerDeps {
  getConfig: typeof getConfig;
  getActionRegistry: typeof getActionRegistry;
  runAgentAction: (action: string, input?: ActionRequest) => Promise<ActionResponse>;
}

const defaultDeps: McpServerDeps = {
  getConfig,
  getActionRegistry,
  runAgentAction,
};

export async function discoverMcpActions(
  deps: Pick<McpServerDeps, "getConfig" | "getActionRegistry"> = defaultDeps
): Promise<McpAction[]> {
  const [config, registry] = await Promise.all([deps.getConfig(), deps.getActionRegistry()]);
  const actions = new Map<string, McpAction>();

  for (const action of registry.actions) {
    addAction(actions, {
      id: action.id,
      title: action.outputTitle,
      description: action.description,
      inputTypes: action.inputTypes ?? ["text"],
    });
  }

  addPromptActions(actions, config, registry);
  return [...actions.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function createMcpServer(
  actions: McpAction[],
  runAction: McpServerDeps["runAgentAction"] = runAgentAction
): McpServer {
  const server = new McpServer(
    { name: "clipboard-ai", version: VERSION },
    {
      instructions:
        "Each tool runs a clipboard-ai action. Pass text explicitly, or omit it to use the current clipboard. " +
        "The local agent enforces safe mode, provider limits, and sensitive-data policy.",
    }
  );

  for (const action of actions) {
    server.registerTool(
      action.id,
      {
        title: action.title,
        description: toolDescription(action),
        inputSchema: actionInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ text, arguments: args }): Promise<CallToolResult> => {
        try {
          const response = await runAction(action.id, {
            ...(text === undefined ? {} : { text }),
            ...(args === undefined ? {} : { args }),
            source: "mcp",
          });
          return actionResult(response);
        } catch (error) {
          return toolError((error as Error).message);
        }
      }
    );
  }

  return server;
}

export async function startMcpServer(deps: Partial<McpServerDeps> = {}): Promise<StdioServerHandle> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  const actions = await discoverMcpActions(resolvedDeps);
  const handle = serveStdio(
    () => createMcpServer(actions, resolvedDeps.runAgentAction),
    {
      onerror: (error) => console.error(`MCP transport error: ${error.message}`),
    }
  );
  console.error(`clipboard-ai MCP server ready with ${actions.length} action tool(s)`);
  return handle;
}

function addPromptActions(
  actions: Map<string, McpAction>,
  config: ConfigResponse,
  registry: ActionRegistry
): void {
  for (const [id, actionConfig] of Object.entries(config.actions)) {
    if (!actionConfig.prompt?.trim() || registry.byId.has(id)) {
      continue;
    }
    addAction(actions, {
      id,
      title: id,
      description: `Run the configured ${id} prompt action`,
      inputTypes: ["text"],
    });
  }
}

function addAction(actions: Map<string, McpAction>, action: McpAction): void {
  if (!ACTION_NAME_PATTERN.test(action.id)) {
    console.error(`Warning: MCP skipped action with unsupported name: ${action.id}`);
    return;
  }
  actions.set(action.id, action);
}

function toolDescription(action: McpAction): string {
  const clipboardTypes = action.inputTypes.join(", ");
  return `${action.description}. Accepted clipboard types: ${clipboardTypes}.`;
}

function actionResult(response: ActionResponse): CallToolResult {
  if (!response.success) {
    return toolError(response.error || `Action ${response.action} failed`);
  }
  return {
    content: [{ type: "text", text: response.result ?? "" }],
  };
}

function toolError(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}
