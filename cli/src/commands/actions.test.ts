import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

const mockGetConfig = mock(() =>
  Promise.resolve({
    provider: { type: "ollama", endpoint: "http://localhost:11434/v1", model: "mistral" },
    actions: {
      summary: { enabled: true, trigger: "length > 200" },
      plugin_action: { enabled: false, trigger: "" },
    },
    settings: {
      poll_interval: 150,
      safe_mode: false,
      notifications: false,
      log_level: "info",
    },
  })
);

const mockGetActionRegistry = mock(() =>
  Promise.resolve({
    actions: [
      {
        id: "summary",
        aliases: ["summarize", "sum"],
        description: "Summarize clipboard content",
        outputTitle: "Summary",
        run: async () => "",
      },
      {
        id: "plugin_action",
        description: "Plugin action",
        outputTitle: "Plugin",
        run: async () => "",
      },
    ],
    byId: new Map(),
    byAlias: new Map(),
  })
);

mock.module("../lib/client.js", () => ({
  getConfig: mockGetConfig,
}));
mock.module("../lib/action-registry.js", () => ({
  getActionRegistry: mockGetActionRegistry,
}));

const { actionsCommand } = await import("./actions.js");

describe("actionsCommand", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockGetConfig.mockClear();
    mockGetActionRegistry.mockClear();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  it("lists registered actions with config state", async () => {
    await actionsCommand();

    expect(mockGetConfig).toHaveBeenCalledTimes(1);
    expect(mockGetActionRegistry).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("✓ summary");
    expect(output).toContain("Aliases:     summarize, sum");
    expect(output).toContain("Trigger:     length > 200");
    expect(output).toContain("✗ plugin_action");
    expect(output).toContain("Description: Plugin action");
  });
});
