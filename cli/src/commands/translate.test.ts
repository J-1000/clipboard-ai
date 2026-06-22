import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { translateCommand } from "./translate.js";
import type { RunActionDeps } from "../lib/run-action.js";
import { fakeAIClient, makeConfig, makeAppendHistoryMock } from "../test-helpers.js";

const mockGetInput = mock((): Promise<{ text: string }> =>
  Promise.resolve({ text: "hello world" })
);
const mockGetConfig = mock(() => Promise.resolve(makeConfig()));
const mockEnforceSafeMode = mock(() => Promise.resolve());
const mockCopyToClipboard = mock((_text: string) => undefined);
const mockAppendHistoryRecord = makeAppendHistoryMock();
const mockTranslate = mock((_text: string, _lang: string) =>
  Promise.resolve("hola mundo")
);

function deps(): Partial<RunActionDeps> {
  return {
    getInput: mockGetInput,
    getConfig: mockGetConfig,
    enforceSafeMode: mockEnforceSafeMode,
    copyToClipboard: mockCopyToClipboard,
    appendHistoryRecord: mockAppendHistoryRecord,
    createAIClient: () => fakeAIClient({ translate: mockTranslate }),
  };
}

describe("translateCommand", () => {
  beforeEach(() => {
    mockGetInput.mockClear();
    mockGetConfig.mockClear();
    mockEnforceSafeMode.mockClear();
    mockCopyToClipboard.mockClear();
    mockAppendHistoryRecord.mockClear();
    mockTranslate.mockClear();
  });

  afterEach(() => mock.restore());

  it("fetches input and config", async () => {
    await translateCommand("Spanish", { deps: deps() });
    expect(mockGetInput).toHaveBeenCalledTimes(1);
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("enforces safe mode", async () => {
    await translateCommand("Spanish", { deps: deps(), yes: true });
    expect(mockEnforceSafeMode).toHaveBeenCalledTimes(1);
  });

  it("calls ai.translate with clipboard text and target language", async () => {
    await translateCommand("Spanish", { deps: deps() });
    expect(mockTranslate).toHaveBeenCalledWith("hello world", "Spanish");
  });

  it("copies result when --copy is set", async () => {
    await translateCommand("Spanish", { deps: deps(), copy: true });
    expect(mockCopyToClipboard).toHaveBeenCalledWith("hola mundo");
  });

  it("does not copy when --copy is not set", async () => {
    await translateCommand("French", { deps: deps() });
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });
});
