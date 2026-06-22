import { beforeEach, describe, expect, it, mock, afterEach, spyOn } from "bun:test";
import { rerunCommand, type RerunCommandDeps } from "./rerun.js";
import type { ActionRunRecord } from "../lib/history.js";

const mockGetHistoryRecordById = mock(
  (_id: string): Promise<ActionRunRecord | null> => Promise.resolve(null)
);
const mockRunActionCommand = mock(() => Promise.resolve());

function deps(): Partial<RerunCommandDeps> {
  return {
    getHistoryRecordById: mockGetHistoryRecordById,
    runActionCommand: mockRunActionCommand,
  };
}

describe("rerunCommand", () => {
  beforeEach(() => {
    mockGetHistoryRecordById.mockClear();
    mockRunActionCommand.mockClear();
  });

  afterEach(() => mock.restore());

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

    await rerunCommand("run-1", { copy: true, yes: true }, deps());

    expect(mockGetHistoryRecordById).toHaveBeenCalledWith("run-1");
    expect(mockRunActionCommand).toHaveBeenCalledWith("summary", {
      args: ["English"],
      copy: true,
      yes: true,
      force: undefined,
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

    await expect(rerunCommand("missing-id", {}, deps())).rejects.toThrow("exit:1");
    expect(errSpy).toHaveBeenCalled();
    expect(mockRunActionCommand).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });
});
