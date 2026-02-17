import { describe, it, expect, mock, beforeEach } from "bun:test";

const mockGetClipboard = mock(() =>
  Promise.resolve({ text: "func main() {}", type: "code", timestamp: "", length: 15 })
);
const mockGetConfig = mock(() =>
  Promise.resolve({
    provider: { type: "ollama", endpoint: "http://localhost:11434/v1", model: "mistral" },
    actions: {},
    settings: { poll_interval: 150, safe_mode: false, notifications: false, log_level: "info" },
  })
);
const mockEnforceSafeMode = mock(() => Promise.resolve());
const mockCopyToClipboard = mock(() => undefined);
const mockExplain = mock(() => Promise.resolve("This is a Go main function."));

mock.module("../lib/client.js", () => ({
  getClipboard: mockGetClipboard,
  getConfig: mockGetConfig,
}));
mock.module("../lib/safe-mode.js", () => ({
  enforceSafeMode: mockEnforceSafeMode,
}));
mock.module("../lib/clipboard.js", () => ({
  copyToClipboard: mockCopyToClipboard,
}));
mock.module("../lib/ai.js", () => ({
  AIClient: class {
    explain = mockExplain;
  },
}));

const { explainCommand } = await import("./explain.js");

describe("explainCommand", () => {
  beforeEach(() => {
    mockGetClipboard.mockClear();
    mockGetConfig.mockClear();
    mockEnforceSafeMode.mockClear();
    mockCopyToClipboard.mockClear();
    mockExplain.mockClear();
  });

  it("fetches clipboard and config", async () => {
    await explainCommand();
    expect(mockGetClipboard).toHaveBeenCalledTimes(1);
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("enforces safe mode", async () => {
    await explainCommand({ yes: true });
    expect(mockEnforceSafeMode).toHaveBeenCalledTimes(1);
  });

  it("calls ai.explain with clipboard text", async () => {
    await explainCommand();
    expect(mockExplain).toHaveBeenCalledWith("func main() {}");
  });

  it("copies result when --copy is set", async () => {
    await explainCommand({ copy: true });
    expect(mockCopyToClipboard).toHaveBeenCalledWith("This is a Go main function.");
  });

  it("does not copy when --copy is not set", async () => {
    await explainCommand();
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });
});
