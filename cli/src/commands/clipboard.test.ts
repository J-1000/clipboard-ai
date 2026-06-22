import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { clipboardCommand } from "./clipboard.js";
import type { ClipboardResponse } from "../lib/client.js";

const mockGetClipboard = mock(
  (): Promise<ClipboardResponse> =>
    Promise.resolve({
      text: "hello world",
      type: "text",
      timestamp: "2024-01-01T00:00:00Z",
      length: 11,
    })
);

describe("clipboardCommand", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockGetClipboard.mockClear();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => mock.restore());

  function output(): string {
    return logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
  }

  it("fetches clipboard from agent", async () => {
    await clipboardCommand({ getClipboard: mockGetClipboard });
    expect(mockGetClipboard).toHaveBeenCalledTimes(1);
  });

  it("displays clipboard type", async () => {
    await clipboardCommand({ getClipboard: mockGetClipboard });
    expect(output()).toContain("Type: text");
  });

  it("displays clipboard length", async () => {
    await clipboardCommand({ getClipboard: mockGetClipboard });
    expect(output()).toContain("Length: 11 chars");
  });

  it("displays clipboard content", async () => {
    await clipboardCommand({ getClipboard: mockGetClipboard });
    expect(output()).toContain("hello world");
  });

  it("shows (empty) when clipboard text is empty", async () => {
    mockGetClipboard.mockImplementationOnce(() =>
      Promise.resolve({ text: "", type: "unknown", timestamp: "", length: 0 })
    );
    await clipboardCommand({ getClipboard: mockGetClipboard });
    expect(output()).toContain("(empty)");
  });
});
