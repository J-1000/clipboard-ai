import { describe, expect, it } from "bun:test";
import { parseStdinInput } from "./input.js";

describe("parseStdinInput", () => {
  it("decodes the agent text and RTF envelope", () => {
    expect(parseStdinInput('{"text":"plain","rtf":"{\\\\rtf1 styled}"}')).toEqual({
      text: "plain",
      rtf: "{\\rtf1 styled}",
    });
  });

  it("accepts a text-only envelope", () => {
    expect(parseStdinInput('{"text":"plain"}')).toEqual({ text: "plain", rtf: undefined });
  });

  it("rejects malformed or incorrectly typed envelopes", () => {
    expect(() => parseStdinInput("not json")).toThrow("Invalid clipboard input");
    expect(() => parseStdinInput("[]")).toThrow("Invalid clipboard input");
    expect(() => parseStdinInput('{"text":42}')).toThrow("Invalid clipboard input");
    expect(() => parseStdinInput('{"text":"ok","rtf":42}')).toThrow("Invalid clipboard input");
  });
});
