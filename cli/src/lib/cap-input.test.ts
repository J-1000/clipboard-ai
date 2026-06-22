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
});
