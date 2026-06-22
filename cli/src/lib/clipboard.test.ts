import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

const mockExecSync = mock((_cmd: string, _opts?: { input?: string }) => undefined);

// Spread the real `child_process` so the mock is a COMPLETE shape and only
// execSync is overridden; a partial mock would leak into other test files.
const realChildProcess = await import("child_process");
mock.module("child_process", () => ({
  ...realChildProcess,
  execSync: mockExecSync,
}));

const { copyToClipboard } = await import("./clipboard.js");

describe("copyToClipboard", () => {
  beforeEach(() => {
    mockExecSync.mockClear();
  });

  afterEach(() => mock.restore());

  it("calls execSync with pbcopy and input text", () => {
    copyToClipboard("hello world");

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith("pbcopy", {
      input: "hello world",
    });
  });

  it("passes empty string to pbcopy", () => {
    copyToClipboard("");

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith("pbcopy", { input: "" });
  });

  it("passes multiline text to pbcopy", () => {
    const text = "line 1\nline 2\nline 3";
    copyToClipboard(text);

    expect(mockExecSync).toHaveBeenCalledWith("pbcopy", { input: text });
  });

  it("passes text with special characters to pbcopy", () => {
    const text = 'hello "world" & <foo>';
    copyToClipboard(text);

    expect(mockExecSync).toHaveBeenCalledWith("pbcopy", { input: text });
  });
});
