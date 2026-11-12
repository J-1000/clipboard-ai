import { describe, expect, it } from "bun:test";
import { capInputSize } from "./run-action.js";

describe("capInputSize", () => {
  it("leaves content under the cap unchanged", () => {
    expect(capInputSize("short")).toBe("short");
  });

  it("truncates oversized content with a visible marker", () => {
    const huge = "x".repeat(250_000);
    const capped = capInputSize(huge);
    expect(capped.length).toBeLessThan(huge.length);
    expect(capped.startsWith("x".repeat(100_000))).toBe(true);
    expect(capped.endsWith("…[truncated]")).toBe(true);
  });

  it("counts characters, not UTF-16 units, and never splits a surrogate pair", () => {
    // 60,000 emoji are 120,000 UTF-16 units but only 60,000 characters.
    const emoji = "😀".repeat(60_000);
    expect(capInputSize(emoji)).toBe(emoji);

    const capped = capInputSize("😀".repeat(100_001));
    expect(capped).toBe(`${"😀".repeat(100_000)}\n…[truncated]`);
  });
});
