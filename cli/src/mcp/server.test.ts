import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createActionRegistry } from "../lib/action-registry.js";
import type { ActionRequest, ActionResponse } from "../lib/client.js";
import { makeConfig } from "../test-helpers.js";
import { createMcpServer, discoverMcpActions, type McpAction } from "./server.js";

describe("MCP server", () => {
  afterEach(() => mock.restore());

  it("discovers built-in, plugin, and configured prompt actions", async () => {
    const registry = createActionRegistry([
      action("summary", "Summary"),
      action("plugin_action", "Plugin result"),
      action("unsupported action", "Unsupported"),
    ]);
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    const actions = await discoverMcpActions({
      getConfig: async () =>
        makeConfig({
          actions: {
            summary: { enabled: true, trigger: "" },
            custom_prompt: {
              enabled: false,
              trigger: "",
              prompt: "Rewrite: {{input}}",
            },
            configured_only: { enabled: true, trigger: "" },
          },
        }),
      getActionRegistry: async () => registry,
    });

    expect(actions.map((item) => item.id)).toEqual([
      "custom_prompt",
      "plugin_action",
      "summary",
    ]);
    expect(errorSpy).toHaveBeenCalledWith(
      "Warning: MCP skipped action with unsupported name: unsupported action"
    );
  });

  it("lists and calls action tools through MCP", async () => {
    const calls: Array<{ action: string; input: unknown }> = [];
    const runner = mock(async (actionId: string, input = {}): Promise<ActionResponse> => {
      calls.push({ action: actionId, input });
      return { success: true, action: actionId, result: "Hallo" };
    });
    const { client, close } = await connectedClient(
      [
        {
          id: "translate",
          title: "Translation",
          description: "Translate clipboard content",
          inputTypes: ["text"],
        },
      ],
      runner
    );

    try {
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(1);
      expect(listed.tools[0].name).toBe("translate");
      expect(listed.tools[0].description).toContain("Accepted clipboard types: text");

      const result = await client.callTool({
        name: "translate",
        arguments: { text: "Hello", arguments: ["German"] },
      });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([{ type: "text", text: "Hallo" }]);
      expect(calls).toEqual([
        {
          action: "translate",
          input: { text: "Hello", args: ["German"], source: "mcp" },
        },
      ]);
    } finally {
      await close();
    }
  });

  it("uses the clipboard when text is omitted and returns agent failures as tool errors", async () => {
    const runner = mock(async (actionId: string, input = {}): Promise<ActionResponse> => {
      expect(actionId).toBe("summary");
      expect(input).toEqual({ source: "mcp" });
      return {
        success: false,
        action: actionId,
        error: "safe mode blocks daemon-triggered cloud calls",
      };
    });
    const { client, close } = await connectedClient(
      [
        {
          id: "summary",
          title: "Summary",
          description: "Summarize clipboard content",
          inputTypes: ["text"],
        },
      ],
      runner
    );

    try {
      const result = await client.callTool({ name: "summary", arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        {
          type: "text",
          text: "Error: safe mode blocks daemon-triggered cloud calls",
        },
      ]);
    } finally {
      await close();
    }
  });
});

function action(id: string, outputTitle: string) {
  return {
    id,
    description: `${id} description`,
    outputTitle,
    run: async () => "",
  };
}

async function connectedClient(
  actions: McpAction[],
  runner: (action: string, input?: ActionRequest) => Promise<ActionResponse>
) {
  const server = createMcpServer(actions, runner);
  const client = new Client({ name: "clipboard-ai-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
