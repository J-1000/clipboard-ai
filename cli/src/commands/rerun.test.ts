import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

const mockGetHistoryRecordById = mock(() => Promise.resolve(null));
const mockRunActionCommand = mock(() => Promise.resolve());

mock.module("../lib/history.js", () => ({
  getHistoryRecordById: mockGetHistoryRecordById,
}));
mock.module("../lib/run-action.js", () => ({
  runActionCommand: mockRunActionCommand,
}));

const { rerunCommand } = await import("./rerun.js");

describe("rerunCommand", () => {
  beforeEach(() => {
    mockGetHistoryRecordById.mockClear();
    mockRunActionCommand.mockClear();
  });

  it("loads record by id", async () => {
    mockGetHistoryRecordById.mockResolvedValueOnce({
      id: "run-1",
      timestamp: "2026-02-20T00:00:00.000Z",
      action: "summary",
      args: ["English"],
      source: "manual",
      trigger: "cli",
      provider: "ollama",
      model: "mistral",
      latency_ms: 12,
      status: "success",
      copy: false,
      input: "input text",
    });

    await rerunCommand("run-1", { copy: true, yes: true });

    expect(mockGetHistoryRecordById).toHaveBeenCalledWith("run-1");
    expect(mockRunActionCommand).toHaveBeenCalledWith("summary", {
      args: ["English"],
      copy: true,
      yes: true,
      inputText: "input text",
      source: "rerun",
      trigger: "rerun:run-1",
      replayOf: "run-1",
    });
  });

  it("exits with error when record is missing", async () => {
    const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const errSpy = spyOn(console, "error").mockImplementation(() => {});

    await expect(rerunCommand("missing-id")).rejects.toThrow("exit:1");
    expect(errSpy).toHaveBeenCalled();
    expect(mockRunActionCommand).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });
});
