import { describe, it, expect, mock, beforeEach } from "bun:test";

const mockGetClipboard = mock(() =>
  Promise.resolve({ text: "rough draft text", type: "text", timestamp: "", length: 16 })
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
const mockImprove = mock(() => Promise.resolve("Polished draft text."));

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
    improve = mockImprove;
  },
}));

const { improveCommand } = await import("./improve.js");

describe("improveCommand", () => {
  beforeEach(() => {
    mockGetClipboard.mockClear();
    mockGetConfig.mockClear();
    mockEnforceSafeMode.mockClear();
    mockCopyToClipboard.mockClear();
    mockImprove.mockClear();
  });

  it("fetches clipboard and config", async () => {
    await improveCommand();
    expect(mockGetClipboard).toHaveBeenCalledTimes(1);
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("enforces safe mode", async () => {
    await improveCommand({ yes: true });
    expect(mockEnforceSafeMode).toHaveBeenCalledTimes(1);
  });

  it("calls ai.improve with clipboard text", async () => {
    await improveCommand();
    expect(mockImprove).toHaveBeenCalledWith("rough draft text");
  });

  it("copies result when --copy is set", async () => {
    await improveCommand({ copy: true });
    expect(mockCopyToClipboard).toHaveBeenCalledWith("Polished draft text.");
  });

  it("does not copy when --copy is not set", async () => {
    await improveCommand();
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });
});
