import { describe, it, expect, mock, beforeEach } from "bun:test";

const mockGetClipboard = mock(() =>
  Promise.resolve({ text: "A long article about AI and its impact...", type: "text", timestamp: "", length: 41 })
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
const mockGenerate = mock(() =>
  Promise.resolve({ content: "AI is transforming everything.", model: "mistral" })
);

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
    generate = mockGenerate;
  },
}));

const { tldrCommand } = await import("./tldr.js");

describe("tldrCommand", () => {
  beforeEach(() => {
    mockGetClipboard.mockClear();
    mockGetConfig.mockClear();
    mockEnforceSafeMode.mockClear();
    mockCopyToClipboard.mockClear();
    mockGenerate.mockClear();
  });

  it("fetches clipboard and config", async () => {
    await tldrCommand();
    expect(mockGetClipboard).toHaveBeenCalledTimes(1);
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("enforces safe mode", async () => {
    await tldrCommand({ yes: true });
    expect(mockEnforceSafeMode).toHaveBeenCalledTimes(1);
  });

  it("calls ai.generate with TL;DR prompt", async () => {
    await tldrCommand();
    expect(mockGenerate).toHaveBeenCalledTimes(1);

    const [prompt, systemPrompt] = mockGenerate.mock.calls[0];
    expect(prompt).toContain("TL;DR");
    expect(prompt).toContain("A long article about AI and its impact...");
    expect(systemPrompt).toContain("concise");
  });

  it("copies result when --copy is set", async () => {
    await tldrCommand({ copy: true });
    expect(mockCopyToClipboard).toHaveBeenCalledWith("AI is transforming everything.");
  });

  it("does not copy when --copy is not set", async () => {
    await tldrCommand();
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });
});
