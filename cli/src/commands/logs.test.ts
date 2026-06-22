import { beforeEach, describe, expect, it, mock, afterEach, spyOn } from "bun:test";
import { logsCommand, type LogsCommandDeps } from "./logs.js";
import type { AgentLogOptions } from "../lib/logs.js";

const mockReadAgentLogs = mock(
  (_options?: AgentLogOptions): Promise<string[]> => Promise.resolve([])
);

function deps(): Partial<LogsCommandDeps> {
  return { readAgentLogs: mockReadAgentLogs };
}

describe("logsCommand", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockReadAgentLogs.mockClear();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => mock.restore());

  function output(): string {
    return logSpy.mock.calls.map((call: unknown[]) => call[0]).join("\n");
  }

  it("loads logs with default options", async () => {
    await logsCommand({}, deps());
    expect(mockReadAgentLogs).toHaveBeenCalledWith({ file: "out" });
  });

  it("prints empty message when no logs are present", async () => {
    await logsCommand({}, deps());
    expect(output()).toContain("No log entries found.");
  });

  it("prints log lines", async () => {
    mockReadAgentLogs.mockResolvedValueOnce([
      '{"level":"INFO","msg":"starting"}',
      '{"level":"INFO","msg":"ready"}',
    ]);

    await logsCommand({ tail: 2 }, deps());
    expect(output()).toContain("starting");
    expect(output()).toContain("ready");
  });
});
