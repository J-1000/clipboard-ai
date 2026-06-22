import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { explainCommand } from "./explain.js";
import type { RunActionDeps } from "../lib/run-action.js";
import { fakeAIClient, makeConfig, makeAppendHistoryMock } from "../test-helpers.js";

const mockGetInput = mock((): Promise<{ text: string }> =>
  Promise.resolve({ text: "func main() {}" })
);
const mockGetConfig = mock(() => Promise.resolve(makeConfig()));
const mockEnforceSafeMode = mock(() => Promise.resolve());
const mockCopyToClipboard = mock((_text: string) => undefined);
const mockAppendHistoryRecord = makeAppendHistoryMock();
const mockExplain = mock((_text: string) => Promise.resolve("This is a Go main function."));

function deps(): Partial<RunActionDeps> {
  return {
    getInput: mockGetInput,
    getConfig: mockGetConfig,
    enforceSafeMode: mockEnforceSafeMode,
    copyToClipboard: mockCopyToClipboard,
    appendHistoryRecord: mockAppendHistoryRecord,
    createAIClient: () => fakeAIClient({ explain: mockExplain }),
  };
}

describe("explainCommand", () => {
  beforeEach(() => {
    mockGetInput.mockClear();
    mockGetConfig.mockClear();
    mockEnforceSafeMode.mockClear();
    mockCopyToClipboard.mockClear();
    mockAppendHistoryRecord.mockClear();
    mockExplain.mockClear();
  });

  afterEach(() => mock.restore());

  it("fetches input and config", async () => {
    await explainCommand({ deps: deps() });
    expect(mockGetInput).toHaveBeenCalledTimes(1);
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("enforces safe mode", async () => {
    await explainCommand({ deps: deps(), yes: true });
    expect(mockEnforceSafeMode).toHaveBeenCalledTimes(1);
  });

  it("calls ai.explain with clipboard text", async () => {
    await explainCommand({ deps: deps() });
    expect(mockExplain).toHaveBeenCalledWith("func main() {}");
  });

  it("copies result when --copy is set", async () => {
    await explainCommand({ deps: deps(), copy: true });
    expect(mockCopyToClipboard).toHaveBeenCalledWith("This is a Go main function.");
  });

  it("does not copy when --copy is not set", async () => {
    await explainCommand({ deps: deps() });
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });
});
