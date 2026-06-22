import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { extractCommand } from "./extract.js";
import type { RunActionDeps } from "../lib/run-action.js";
import { fakeAIClient, makeConfig, makeAppendHistoryMock } from "../test-helpers.js";

const mockGetInput = mock((): Promise<{ text: string }> =>
  Promise.resolve({ text: "name: John, age: 30" })
);
const mockGetConfig = mock(() => Promise.resolve(makeConfig()));
const mockEnforceSafeMode = mock(() => Promise.resolve());
const mockCopyToClipboard = mock((_text: string) => undefined);
const mockAppendHistoryRecord = makeAppendHistoryMock();
const mockExtractData = mock((_text: string) =>
  Promise.resolve('{"name":"John","age":30}')
);

function deps(): Partial<RunActionDeps> {
  return {
    getInput: mockGetInput,
    getConfig: mockGetConfig,
    enforceSafeMode: mockEnforceSafeMode,
    copyToClipboard: mockCopyToClipboard,
    appendHistoryRecord: mockAppendHistoryRecord,
    createAIClient: () => fakeAIClient({ extractData: mockExtractData }),
  };
}

describe("extractCommand", () => {
  beforeEach(() => {
    mockGetInput.mockClear();
    mockGetConfig.mockClear();
    mockEnforceSafeMode.mockClear();
    mockCopyToClipboard.mockClear();
    mockAppendHistoryRecord.mockClear();
    mockExtractData.mockClear();
  });

  afterEach(() => mock.restore());

  it("fetches input and config", async () => {
    await extractCommand({ deps: deps() });
    expect(mockGetInput).toHaveBeenCalledTimes(1);
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("enforces safe mode", async () => {
    await extractCommand({ deps: deps(), yes: true });
    expect(mockEnforceSafeMode).toHaveBeenCalledTimes(1);
  });

  it("calls ai.extractData with clipboard text", async () => {
    await extractCommand({ deps: deps() });
    expect(mockExtractData).toHaveBeenCalledWith("name: John, age: 30");
  });

  it("copies result when --copy is set", async () => {
    await extractCommand({ deps: deps(), copy: true });
    expect(mockCopyToClipboard).toHaveBeenCalledWith('{"name":"John","age":30}');
  });

  it("does not copy when --copy is not set", async () => {
    await extractCommand({ deps: deps() });
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });
});
