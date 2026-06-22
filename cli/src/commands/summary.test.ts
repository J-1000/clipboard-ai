import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { summaryCommand } from "./summary.js";
import type { RunActionDeps } from "../lib/run-action.js";
import { fakeAIClient, makeConfig, makeAppendHistoryMock } from "../test-helpers.js";

const mockGetInput = mock((): Promise<{ text: string }> =>
  Promise.resolve({ text: "A very long article about technology..." })
);
const mockGetConfig = mock(() => Promise.resolve(makeConfig()));
const mockEnforceSafeMode = mock(() => Promise.resolve());
const mockCopyToClipboard = mock((_text: string) => undefined);
const mockAppendHistoryRecord = makeAppendHistoryMock();
const mockSummarize = mock((_text: string) => Promise.resolve("Brief summary of article."));

function deps(): Partial<RunActionDeps> {
  return {
    getInput: mockGetInput,
    getConfig: mockGetConfig,
    enforceSafeMode: mockEnforceSafeMode,
    copyToClipboard: mockCopyToClipboard,
    appendHistoryRecord: mockAppendHistoryRecord,
    createAIClient: () => fakeAIClient({ summarize: mockSummarize }),
  };
}

describe("summaryCommand", () => {
  beforeEach(() => {
    mockGetInput.mockClear();
    mockGetConfig.mockClear();
    mockEnforceSafeMode.mockClear();
    mockCopyToClipboard.mockClear();
    mockAppendHistoryRecord.mockClear();
    mockSummarize.mockClear();
  });

  afterEach(() => mock.restore());

  it("fetches input and config", async () => {
    await summaryCommand({ deps: deps() });
    expect(mockGetInput).toHaveBeenCalledTimes(1);
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("enforces safe mode", async () => {
    await summaryCommand({ deps: deps(), yes: true });
    expect(mockEnforceSafeMode).toHaveBeenCalledTimes(1);
  });

  it("calls ai.summarize with clipboard text", async () => {
    await summaryCommand({ deps: deps() });
    expect(mockSummarize).toHaveBeenCalledWith("A very long article about technology...");
  });

  it("copies result when --copy is set", async () => {
    await summaryCommand({ deps: deps(), copy: true });
    expect(mockCopyToClipboard).toHaveBeenCalledWith("Brief summary of article.");
  });

  it("does not copy when --copy is not set", async () => {
    await summaryCommand({ deps: deps() });
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });

  it("uses provided inputText when set", async () => {
    await summaryCommand({ deps: deps(), inputText: "from option" });

    expect(mockGetInput).not.toHaveBeenCalled();
    expect(mockSummarize).toHaveBeenCalledWith("from option");
  });
});
