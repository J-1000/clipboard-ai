import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test";

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
const mockClassify = mock(() => Promise.resolve('{"category":"code","confidence":0.9}'));

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
    classify = mockClassify;
  },
}));

const { classifyCommand } = await import("./classify.js");

describe("classifyCommand", () => {
  beforeEach(() => {
    mockGetClipboard.mockClear();
    mockGetConfig.mockClear();
    mockEnforceSafeMode.mockClear();
    mockCopyToClipboard.mockClear();
    mockClassify.mockClear();
  });

  it("fetches clipboard and config in parallel", async () => {
    await classifyCommand();
    expect(mockGetClipboard).toHaveBeenCalledTimes(1);
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("enforces safe mode with options", async () => {
    await classifyCommand({ yes: true });
    expect(mockEnforceSafeMode).toHaveBeenCalledTimes(1);
  });

  it("calls ai.classify with clipboard text", async () => {
    await classifyCommand();
    expect(mockClassify).toHaveBeenCalledWith("func main() {}");
  });

  it("copies result to clipboard when --copy is set", async () => {
    await classifyCommand({ copy: true });
    expect(mockCopyToClipboard).toHaveBeenCalledWith('{"category":"code","confidence":0.9}');
  });

  it("does not copy when --copy is not set", async () => {
    await classifyCommand();
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });
});
