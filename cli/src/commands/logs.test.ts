import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

const mockReadAgentLogs = mock(() => Promise.resolve([]));

mock.module("../lib/logs.js", () => ({
  readAgentLogs: mockReadAgentLogs,
}));

const { logsCommand } = await import("./logs.js");

describe("logsCommand", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockReadAgentLogs.mockClear();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  it("loads logs with default options", async () => {
    await logsCommand();
    expect(mockReadAgentLogs).toHaveBeenCalledWith({});
  });

  it("prints empty message when no logs are present", async () => {
    await logsCommand();
    const output = logSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("No log entries found.");
  });

  it("prints log lines", async () => {
    mockReadAgentLogs.mockResolvedValueOnce([
      '{"level":"INFO","msg":"starting"}',
      '{"level":"INFO","msg":"ready"}',
    ]);

    await logsCommand({ tail: 2 });
    const output = logSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("starting");
    expect(output).toContain("ready");
  });
});
