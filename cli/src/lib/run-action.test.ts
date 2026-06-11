import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createActionRegistry } from "./action-registry.js";

const mockGetConfig = mock(() =>
  Promise.resolve({
    provider: { type: "ollama", endpoint: "http://localhost:11434/v1", model: "mistral" },
    actions: {},
    settings: { poll_interval: 150, safe_mode: false, notifications: false, log_level: "info" },
  })
);
const mockGetInput = mock(() => Promise.resolve({ text: "clipboard text" }));
const mockEnforceSafeMode = mock(() => Promise.resolve());
const mockCopyToClipboard = mock(() => undefined);
const mockAppendHistoryRecord = mock(() => Promise.resolve(undefined));

mock.module("./client.js", () => ({
  getConfig: mockGetConfig,
}));
mock.module("./input.js", () => ({
  getInput: mockGetInput,
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
    mockGetInput.mockClear();
    mockEnforceSafeMode.mockClear();
    mockCopyToClipboard.mockClear();
    mockAppendHistoryRecord.mockClear();
    spyOn(console, "log").mockImplementation(() => {});
    spyOn(console, "error").mockImplementation(() => {});
    delete process.env.CBAI_SENSITIVE_GUARD_HIT;
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

  it("blocks sensitive text when guard mode is block", async () => {
    mockGetConfig.mockResolvedValueOnce({
      provider: { type: "ollama", endpoint: "http://localhost:11434/v1", model: "mistral" },
      actions: {},
      settings: {
        poll_interval: 150,
        safe_mode: false,
        notifications: false,
        log_level: "info",
        sensitive_guard: "block",
      },
    });
    mockGetInput.mockResolvedValueOnce({ text: "api_key = secret" });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);

    await expect(runActionCommand("summary", { registry })).rejects.toThrow("exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    expect(mockAppendHistoryRecord).toHaveBeenCalledTimes(1);
    const call = mockAppendHistoryRecord.mock.calls[0][0];
    expect(call.status).toBe("error");
    expect(call.input).toBe("[sensitive content omitted]");
    expect(call.output).toBeUndefined();
  });

  it("runs sensitive text with force while suppressing history content", async () => {
    mockGetConfig.mockResolvedValueOnce({
      provider: { type: "ollama", endpoint: "http://localhost:11434/v1", model: "mistral" },
      actions: {},
      settings: {
        poll_interval: 150,
        safe_mode: false,
        notifications: false,
        log_level: "info",
        sensitive_guard: "block",
      },
    });
    mockGetInput.mockResolvedValueOnce({ text: "api_key = secret" });

    await runActionCommand("summary", { registry, force: true });

    const call = mockAppendHistoryRecord.mock.calls[0][0];
    expect(call.status).toBe("success");
    expect(call.input).toBe("[sensitive content omitted]");
    expect(call.output).toBeUndefined();
  });

  it("warns and suppresses history content in warn mode", async () => {
    mockGetConfig.mockResolvedValueOnce({
      provider: { type: "ollama", endpoint: "http://localhost:11434/v1", model: "mistral" },
      actions: {},
      settings: {
        poll_interval: 150,
        safe_mode: false,
        notifications: false,
        log_level: "info",
        sensitive_guard: "warn",
      },
    });
    mockGetInput.mockResolvedValueOnce({ text: "card 4111 1111 1111 1111" });

    await runActionCommand("summary", { registry });

    expect(console.error).toHaveBeenCalledWith(
      "Warning: clipboard looks like it contains a secret."
    );
    const call = mockAppendHistoryRecord.mock.calls[0][0];
    expect(call.input).toBe("[sensitive content omitted]");
    expect(call.output).toBeUndefined();
  });

  it("suppresses history content when daemon guard already fired", async () => {
    process.env.CBAI_SENSITIVE_GUARD_HIT = "true";

    await runActionCommand("summary", { registry, inputText: "plain text" });

    const call = mockAppendHistoryRecord.mock.calls[0][0];
    expect(call.input).toBe("[sensitive content omitted]");
    expect(call.output).toBeUndefined();
  });
});
