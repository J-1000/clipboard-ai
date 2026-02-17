import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test";

const mockGetClipboard = mock(() =>
  Promise.resolve({
    text: "hello world",
    type: "text",
    timestamp: "2024-01-01T00:00:00Z",
    length: 11,
  })
);

mock.module("../lib/client.js", () => ({
  getClipboard: mockGetClipboard,
}));

const { clipboardCommand } = await import("./clipboard.js");

describe("clipboardCommand", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockGetClipboard.mockClear();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  it("fetches clipboard from agent", async () => {
    await clipboardCommand();
    expect(mockGetClipboard).toHaveBeenCalledTimes(1);
  });

  it("displays clipboard type", async () => {
    await clipboardCommand();
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Type: text");
  });

  it("displays clipboard length", async () => {
    await clipboardCommand();
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Length: 11 chars");
  });

  it("displays clipboard content", async () => {
    await clipboardCommand();
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("hello world");
  });

  it("shows (empty) when clipboard text is empty", async () => {
    mockGetClipboard.mockImplementationOnce(() =>
      Promise.resolve({ text: "", type: "unknown", timestamp: "", length: 0 })
    );
    await clipboardCommand();
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("(empty)");
  });
});
