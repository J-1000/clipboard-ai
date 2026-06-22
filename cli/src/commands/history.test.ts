import { beforeEach, describe, expect, it, mock, afterEach, spyOn } from "bun:test";
import { historyCommand, type HistoryCommandDeps } from "./history.js";
import type { ActionRunRecord } from "../lib/history.js";

const mockReadHistoryRecords = mock(
  (_limit?: number): Promise<ActionRunRecord[]> => Promise.resolve([])
);
const mockClearHistoryRecords = mock(() => Promise.resolve());
const mockPruneHistoryBefore = mock((_before: Date) => Promise.resolve(0));

function deps(): Partial<HistoryCommandDeps> {
  return {
    readHistoryRecords: mockReadHistoryRecords,
    clearHistoryRecords: mockClearHistoryRecords,
    pruneHistoryBefore: mockPruneHistoryBefore,
  };
}

describe("historyCommand", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockReadHistoryRecords.mockClear();
    mockClearHistoryRecords.mockClear();
    mockPruneHistoryBefore.mockClear();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => mock.restore());

  function output(): string {
    return logSpy.mock.calls.map((call: unknown[]) => call[0]).join("\n");
  }

  it("loads history with default limit", async () => {
    await historyCommand({}, deps());
    expect(mockReadHistoryRecords).toHaveBeenCalledWith(20);
  });

  it("prints empty message when no records are present", async () => {
    await historyCommand({}, deps());
    expect(output()).toContain("No history records found.");
  });

  it("prints record rows", async () => {
    mockReadHistoryRecords.mockResolvedValueOnce([
      {
        id: "run-1",
        timestamp: "2026-02-20T18:30:00.000Z",
        action: "summary",
        args: [],
        source: "manual",
        trigger: "cli",
        provider: "ollama",
        model: "mistral",
        latency_ms: 25,
        status: "success",
        copy: false,
        input: "hello",
      },
    ]);

    await historyCommand({ limit: 5 }, deps());
    expect(output()).toContain("Recent action runs");
    expect(output()).toContain("run-1");
    expect(output()).toContain("summary");
    expect(output()).toContain("25ms");
  });

  it("clears history when requested", async () => {
    await historyCommand({ clear: true }, deps());

    expect(mockClearHistoryRecords).toHaveBeenCalledTimes(1);
    expect(mockReadHistoryRecords).not.toHaveBeenCalled();
    expect(output()).toContain("History cleared.");
  });

  it("prunes history before a date", async () => {
    mockPruneHistoryBefore.mockResolvedValueOnce(2);

    await historyCommand({ before: "2026-01-15T00:00:00.000Z" }, deps());

    expect(mockPruneHistoryBefore).toHaveBeenCalledTimes(1);
    const cutoff = mockPruneHistoryBefore.mock.calls[0][0];
    expect(cutoff.toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(output()).toContain("Pruned 2 history entries.");
  });
});
