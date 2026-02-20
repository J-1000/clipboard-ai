import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

const mockReadHistoryRecords = mock(() => Promise.resolve([]));

mock.module("../lib/history.js", () => ({
  readHistoryRecords: mockReadHistoryRecords,
}));

const { historyCommand } = await import("./history.js");

describe("historyCommand", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockReadHistoryRecords.mockClear();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  it("loads history with default limit", async () => {
    await historyCommand();
    expect(mockReadHistoryRecords).toHaveBeenCalledWith(20);
  });

  it("prints empty message when no records are present", async () => {
    await historyCommand();
    const output = logSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("No history records found.");
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

    await historyCommand({ limit: 5 });
    const output = logSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("Recent action runs");
    expect(output).toContain("run-1");
    expect(output).toContain("summary");
    expect(output).toContain("25ms");
  });
});
