import { describe, it, expect, mock, beforeEach } from "bun:test";

const mockGetClipboard = mock(() =>
  Promise.resolve({ text: "hello world", type: "text", timestamp: "", length: 11 })
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
const mockTranslate = mock(() => Promise.resolve("hola mundo"));

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
    translate = mockTranslate;
  },
}));

const { translateCommand } = await import("./translate.js");

describe("translateCommand", () => {
  beforeEach(() => {
    mockGetClipboard.mockClear();
    mockGetConfig.mockClear();
    mockEnforceSafeMode.mockClear();
    mockCopyToClipboard.mockClear();
    mockTranslate.mockClear();
  });

  it("fetches clipboard and config", async () => {
    await translateCommand("Spanish");
    expect(mockGetClipboard).toHaveBeenCalledTimes(1);
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("enforces safe mode", async () => {
    await translateCommand("Spanish", { yes: true });
    expect(mockEnforceSafeMode).toHaveBeenCalledTimes(1);
  });

  it("calls ai.translate with clipboard text and target language", async () => {
    await translateCommand("Spanish");
    expect(mockTranslate).toHaveBeenCalledWith("hello world", "Spanish");
  });

  it("copies result when --copy is set", async () => {
    await translateCommand("Spanish", { copy: true });
    expect(mockCopyToClipboard).toHaveBeenCalledWith("hola mundo");
  });

  it("does not copy when --copy is not set", async () => {
    await translateCommand("French");
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });
});
