import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test";

const mockGetStatus = mock(() =>
  Promise.resolve({
    status: "running",
    uptime: "5m30s",
    version: "0.1.0",
    clipboard: {
      text: "preview text",
      type: "text",
      timestamp: "2024-01-01T00:00:00Z",
    },
  })
);

mock.module("../lib/client.js", () => ({
  getStatus: mockGetStatus,
}));

const { statusCommand } = await import("./status.js");

describe("statusCommand", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockGetStatus.mockClear();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  it("fetches status from agent", async () => {
    await statusCommand();
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
  });

  it("displays agent status", async () => {
    await statusCommand();
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Status:  running");
  });

  it("displays version and uptime", async () => {
    await statusCommand();
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Version: 0.1.0");
    expect(output).toContain("Uptime:  5m30s");
  });

  it("displays clipboard preview", async () => {
    await statusCommand();
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Preview:   preview text");
    expect(output).toContain("Type:      text");
  });

  it("shows (empty) when clipboard text is empty", async () => {
    mockGetStatus.mockImplementationOnce(() =>
      Promise.resolve({
        status: "running",
        uptime: "1s",
        version: "0.1.0",
        clipboard: { text: "", type: "unknown", timestamp: "" },
      })
    );
    await statusCommand();
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("(empty)");
  });

  it("shows N/A when timestamp is empty", async () => {
    mockGetStatus.mockImplementationOnce(() =>
      Promise.resolve({
        status: "running",
        uptime: "1s",
        version: "0.1.0",
        clipboard: { text: "test", type: "text", timestamp: "" },
      })
    );
    await statusCommand();
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("N/A");
  });
});
