import { describe, it, expect, mock, beforeEach } from "bun:test";

const mockGetClipboard = mock(() =>
  Promise.resolve({ text: "A very long article about technology...", type: "text", timestamp: "", length: 39 })
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
const mockSummarize = mock(() => Promise.resolve("Brief summary of article."));

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
    summarize = mockSummarize;
  },
}));

const { summaryCommand } = await import("./summary.js");

describe("summaryCommand", () => {
  beforeEach(() => {
    mockGetClipboard.mockClear();
    mockGetConfig.mockClear();
    mockEnforceSafeMode.mockClear();
    mockCopyToClipboard.mockClear();
    mockSummarize.mockClear();
  });

  it("fetches clipboard and config", async () => {
    await summaryCommand();
    expect(mockGetClipboard).toHaveBeenCalledTimes(1);
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("enforces safe mode", async () => {
    await summaryCommand({ yes: true });
    expect(mockEnforceSafeMode).toHaveBeenCalledTimes(1);
  });

  it("calls ai.summarize with clipboard text", async () => {
    await summaryCommand();
    expect(mockSummarize).toHaveBeenCalledWith("A very long article about technology...");
  });

  it("copies result when --copy is set", async () => {
    await summaryCommand({ copy: true });
    expect(mockCopyToClipboard).toHaveBeenCalledWith("Brief summary of article.");
  });

  it("does not copy when --copy is not set", async () => {
    await summaryCommand();
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });
});
