import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { tldrCommand } from "./tldr.js";
import type { RunActionDeps } from "../lib/run-action.js";
import type { AIResponse } from "../lib/ai.js";
import { fakeAIClient, makeConfig, makeAppendHistoryMock } from "../test-helpers.js";

const mockGetInput = mock((): Promise<{ text: string }> =>
  Promise.resolve({ text: "A long article about AI and its impact..." })
);
const mockGetConfig = mock(() => Promise.resolve(makeConfig()));
const mockEnforceSafeMode = mock(() => Promise.resolve());
const mockCopyToClipboard = mock((_text: string) => undefined);
const mockAppendHistoryRecord = makeAppendHistoryMock();
const mockGenerate = mock(
  (_prompt: string, _systemPrompt?: string): Promise<AIResponse> =>
    Promise.resolve({ content: "AI is transforming everything.", model: "mistral" })
);

function deps(): Partial<RunActionDeps> {
  return {
    getInput: mockGetInput,
    getConfig: mockGetConfig,
    enforceSafeMode: mockEnforceSafeMode,
    copyToClipboard: mockCopyToClipboard,
    appendHistoryRecord: mockAppendHistoryRecord,
    createAIClient: () => fakeAIClient({ generate: mockGenerate }),
  };
}

describe("tldrCommand", () => {
  beforeEach(() => {
    mockGetInput.mockClear();
    mockGetConfig.mockClear();
    mockEnforceSafeMode.mockClear();
    mockCopyToClipboard.mockClear();
    mockAppendHistoryRecord.mockClear();
    mockGenerate.mockClear();
  });

  afterEach(() => mock.restore());

  it("fetches input and config", async () => {
    await tldrCommand({ deps: deps() });
    expect(mockGetInput).toHaveBeenCalledTimes(1);
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("enforces safe mode", async () => {
    await tldrCommand({ deps: deps(), yes: true });
    expect(mockEnforceSafeMode).toHaveBeenCalledTimes(1);
  });

  it("calls ai.generate with TL;DR prompt", async () => {
    await tldrCommand({ deps: deps() });
    expect(mockGenerate).toHaveBeenCalledTimes(1);

    const [prompt, systemPrompt] = mockGenerate.mock.calls[0];
    expect(prompt).toContain("TL;DR");
    expect(prompt).toContain("A long article about AI and its impact...");
    expect(systemPrompt).toContain("concise");
  });

  it("copies result when --copy is set", async () => {
    await tldrCommand({ deps: deps(), copy: true });
    expect(mockCopyToClipboard).toHaveBeenCalledWith("AI is transforming everything.");
  });

  it("does not copy when --copy is not set", async () => {
    await tldrCommand({ deps: deps() });
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });
});
