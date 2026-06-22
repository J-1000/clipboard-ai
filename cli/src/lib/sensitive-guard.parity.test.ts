import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { scanSensitiveText } from "./sensitive-guard.js";

// Shared with agent/internal/guard/parity_test.go. Both suites consume
// testdata/sensitive-guard-cases.json so Go/TS guard drift fails CI.
interface ParityCase {
  name: string;
  input: string;
  expected: string[];
}

const fixturePath = join(import.meta.dir, "..", "..", "..", "testdata", "sensitive-guard-cases.json");
const cases = JSON.parse(readFileSync(fixturePath, "utf8")) as ParityCase[];

describe("sensitive-guard parity fixture", () => {
  it("loads cases", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)("$name", (tc) => {
    const got = Array.from(new Set(scanSensitiveText(tc.input).map((f) => f.type))).sort();
    expect(got).toEqual([...tc.expected].sort());
  });
});
