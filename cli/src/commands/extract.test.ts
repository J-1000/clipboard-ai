import { describe, it, expect, mock, beforeEach } from "bun:test";

const mockGetClipboard = mock(() =>
  Promise.resolve({ text: "name: John, age: 30", type: "text", timestamp: "", length: 19 })
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
const mockExtractData = mock(() => Promise.resolve('{"name":"John","age":30}'));

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
    extractData = mockExtractData;
  },
}));

const { extractCommand } = await import("./extract.js");

describe("extractCommand", () => {
  beforeEach(() => {
    mockGetClipboard.mockClear();
    mockGetConfig.mockClear();
    mockEnforceSafeMode.mockClear();
    mockCopyToClipboard.mockClear();
    mockExtractData.mockClear();
  });

  it("fetches clipboard and config", async () => {
    await extractCommand();
    expect(mockGetClipboard).toHaveBeenCalledTimes(1);
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("enforces safe mode", async () => {
    await extractCommand({ yes: true });
    expect(mockEnforceSafeMode).toHaveBeenCalledTimes(1);
  });

  it("calls ai.extractData with clipboard text", async () => {
    await extractCommand();
    expect(mockExtractData).toHaveBeenCalledWith("name: John, age: 30");
  });

  it("copies result when --copy is set", async () => {
    await extractCommand({ copy: true });
    expect(mockCopyToClipboard).toHaveBeenCalledWith('{"name":"John","age":30}');
  });

  it("does not copy when --copy is not set", async () => {
    await extractCommand();
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });
});
