import { describe, it, expect, mock, beforeEach } from "bun:test";

const mockExecSync = mock(() => undefined);

mock.module("child_process", () => ({
  execSync: mockExecSync,
}));

const { copyToClipboard } = await import("./clipboard.js");

describe("copyToClipboard", () => {
  beforeEach(() => {
    mockExecSync.mockClear();
  });

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
