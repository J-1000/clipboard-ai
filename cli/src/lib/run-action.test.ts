import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createActionRegistry } from "./action-registry.js";

const mockGetConfig = mock(() =>
  Promise.resolve({
    provider: { type: "ollama", endpoint: "http://localhost:11434/v1", model: "mistral" },
    actions: {},
    settings: { poll_interval: 150, safe_mode: false, notifications: false, log_level: "info" },
  })
);
const mockGetInputText = mock(() => Promise.resolve("clipboard text"));
const mockEnforceSafeMode = mock(() => Promise.resolve());
const mockCopyToClipboard = mock(() => undefined);
const mockAppendHistoryRecord = mock(() => Promise.resolve(undefined));

mock.module("./client.js", () => ({
  getConfig: mockGetConfig,
}));
mock.module("./input.js", () => ({
  getInputText: mockGetInputText,
}));
mock.module("./safe-mode.js", () => ({
  enforceSafeMode: mockEnforceSafeMode,
}));
mock.module("./clipboard.js", () => ({
  copyToClipboard: mockCopyToClipboard,
}));
mock.module("./history.js", () => ({
  appendHistoryRecord: mockAppendHistoryRecord,
}));
mock.module("./ai.js", () => ({
  AIClient: class {},
}));

const { runActionCommand } = await import("./run-action.js");

describe("runActionCommand history", () => {
  const registry = createActionRegistry([
    {
      id: "summary",
      description: "Summary",
      outputTitle: "Summary",
      run: async ({ text }) => `out: ${text}`,
    },
  ]);

  beforeEach(() => {
    mockGetConfig.mockClear();
    mockGetInputText.mockClear();
    mockEnforceSafeMode.mockClear();
    mockCopyToClipboard.mockClear();
    mockAppendHistoryRecord.mockClear();
    spyOn(console, "log").mockImplementation(() => {});
  });

  it("records successful runs", async () => {
    await runActionCommand("summary", { registry });

    expect(mockAppendHistoryRecord).toHaveBeenCalledTimes(1);
    const call = mockAppendHistoryRecord.mock.calls[0][0];
    expect(call.action).toBe("summary");
    expect(call.source).toBe("manual");
    expect(call.trigger).toBe("cli");
    expect(call.status).toBe("success");
    expect(call.input).toBe("clipboard text");
    expect(call.model).toBe("mistral");
  });

  it("records rerun metadata when provided", async () => {
    await runActionCommand("summary", {
      registry,
      inputText: "stored input",
      source: "rerun",
      trigger: "rerun:abc123",
      replayOf: "abc123",
      args: ["Spanish"],
    });

    const call = mockAppendHistoryRecord.mock.calls[0][0];
    expect(call.source).toBe("rerun");
    expect(call.trigger).toBe("rerun:abc123");
    expect(call.replay_of).toBe("abc123");
    expect(call.args).toEqual(["Spanish"]);
    expect(call.input).toBe("stored input");
  });
});
