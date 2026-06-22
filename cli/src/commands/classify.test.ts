import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { classifyCommand } from "./classify.js";
import type { RunActionDeps } from "../lib/run-action.js";
import { fakeAIClient, makeConfig, makeAppendHistoryMock } from "../test-helpers.js";

const mockGetInput = mock((): Promise<{ text: string }> =>
  Promise.resolve({ text: "func main() {}" })
);
const mockGetConfig = mock(() => Promise.resolve(makeConfig()));
const mockEnforceSafeMode = mock(() => Promise.resolve());
const mockCopyToClipboard = mock((_text: string) => undefined);
const mockAppendHistoryRecord = makeAppendHistoryMock();
const mockClassify = mock((_text: string) =>
  Promise.resolve('{"category":"code","confidence":0.9}')
);

function deps(): Partial<RunActionDeps> {
  return {
    getInput: mockGetInput,
    getConfig: mockGetConfig,
    enforceSafeMode: mockEnforceSafeMode,
    copyToClipboard: mockCopyToClipboard,
    appendHistoryRecord: mockAppendHistoryRecord,
    createAIClient: () => fakeAIClient({ classify: mockClassify }),
  };
}

describe("classifyCommand", () => {
  beforeEach(() => {
    mockGetInput.mockClear();
    mockGetConfig.mockClear();
    mockEnforceSafeMode.mockClear();
    mockCopyToClipboard.mockClear();
    mockAppendHistoryRecord.mockClear();
    mockClassify.mockClear();
  });

  afterEach(() => mock.restore());

  it("fetches input and config", async () => {
    await classifyCommand({ deps: deps() });
    expect(mockGetInput).toHaveBeenCalledTimes(1);
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("enforces safe mode with options", async () => {
    await classifyCommand({ deps: deps(), yes: true });
    expect(mockEnforceSafeMode).toHaveBeenCalledTimes(1);
  });

  it("calls ai.classify with clipboard text", async () => {
    await classifyCommand({ deps: deps() });
    expect(mockClassify).toHaveBeenCalledWith("func main() {}");
  });

  it("copies result to clipboard when --copy is set", async () => {
    await classifyCommand({ deps: deps(), copy: true });
    expect(mockCopyToClipboard).toHaveBeenCalledWith('{"category":"code","confidence":0.9}');
  });

  it("does not copy when --copy is not set", async () => {
    await classifyCommand({ deps: deps() });
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });
});
