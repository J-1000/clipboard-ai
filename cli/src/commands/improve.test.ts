import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { improveCommand } from "./improve.js";
import type { RunActionDeps } from "../lib/run-action.js";
import { fakeAIClient, makeConfig, makeAppendHistoryMock } from "../test-helpers.js";

const mockGetInput = mock((): Promise<{ text: string }> =>
  Promise.resolve({ text: "rough draft text" })
);
const mockGetConfig = mock(() => Promise.resolve(makeConfig()));
const mockEnforceSafeMode = mock(() => Promise.resolve());
const mockCopyToClipboard = mock((_text: string) => undefined);
const mockAppendHistoryRecord = makeAppendHistoryMock();
const mockImprove = mock((_text: string) => Promise.resolve("Polished draft text."));

function deps(): Partial<RunActionDeps> {
  return {
    getInput: mockGetInput,
    getConfig: mockGetConfig,
    enforceSafeMode: mockEnforceSafeMode,
    copyToClipboard: mockCopyToClipboard,
    appendHistoryRecord: mockAppendHistoryRecord,
    createAIClient: () => fakeAIClient({ improve: mockImprove }),
  };
}

describe("improveCommand", () => {
  beforeEach(() => {
    mockGetInput.mockClear();
    mockGetConfig.mockClear();
    mockEnforceSafeMode.mockClear();
    mockCopyToClipboard.mockClear();
    mockAppendHistoryRecord.mockClear();
    mockImprove.mockClear();
  });

  afterEach(() => mock.restore());

  it("fetches input and config", async () => {
    await improveCommand({ deps: deps() });
    expect(mockGetInput).toHaveBeenCalledTimes(1);
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("enforces safe mode", async () => {
    await improveCommand({ deps: deps(), yes: true });
    expect(mockEnforceSafeMode).toHaveBeenCalledTimes(1);
  });

  it("calls ai.improve with clipboard text", async () => {
    await improveCommand({ deps: deps() });
    expect(mockImprove).toHaveBeenCalledWith("rough draft text");
  });

  it("copies result when --copy is set", async () => {
    await improveCommand({ deps: deps(), copy: true });
    expect(mockCopyToClipboard).toHaveBeenCalledWith("Polished draft text.");
  });

  it("does not copy when --copy is not set", async () => {
    await improveCommand({ deps: deps() });
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });
});
