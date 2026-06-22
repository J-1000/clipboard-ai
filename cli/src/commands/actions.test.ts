import { beforeEach, describe, expect, it, mock, afterEach, spyOn } from "bun:test";
import { actionsCommand } from "./actions.js";
import { createActionRegistry } from "../lib/action-registry.js";
import { makeConfig } from "../test-helpers.js";

const mockGetConfig = mock(() =>
  Promise.resolve(
    makeConfig({
      actions: {
        summary: { enabled: true, trigger: "length > 200" },
        plugin_action: { enabled: false, trigger: "" },
      },
    })
  )
);

const registry = createActionRegistry([
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
]);

const mockGetActionRegistry = mock(() => Promise.resolve(registry));

describe("actionsCommand", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockGetConfig.mockClear();
    mockGetActionRegistry.mockClear();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => mock.restore());

  it("lists registered actions with config state", async () => {
    await actionsCommand({ getConfig: mockGetConfig, getActionRegistry: mockGetActionRegistry });

    expect(mockGetConfig).toHaveBeenCalledTimes(1);
    expect(mockGetActionRegistry).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls.map((call: unknown[]) => call[0]).join("\n");
    expect(output).toContain("✓ summary");
    expect(output).toContain("Aliases:     summarize, sum");
    expect(output).toContain("Trigger:     length > 200");
    expect(output).toContain("✗ plugin_action");
    expect(output).toContain("Description: Plugin action");
  });
});
