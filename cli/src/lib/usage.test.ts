import { beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { appendProviderUsage, getDailyProviderUsage } from "./usage.js";

describe("provider usage ledger", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "cbai-usage-test-"));
    process.env.CBAI_USAGE_FILE = join(dir, "usage.jsonl");
  });

  it("aggregates UTC-day usage by profile and action", async () => {
    await appendProviderUsage({
      timestamp: "2026-08-18T01:00:00.000Z",
      action: "summary",
      profile: "cloud",
      prompt_tokens: 100,
      completion_tokens: 20,
    });
    await appendProviderUsage({
      timestamp: "2026-08-18T02:00:00.000Z",
      action: "explain",
      profile: "cloud",
      prompt_tokens: 30,
      completion_tokens: 10,
    });
    await appendProviderUsage({
      timestamp: "2026-08-17T23:00:00.000Z",
      action: "summary",
      profile: "cloud",
      prompt_tokens: 999,
      completion_tokens: 999,
    });

    const usage = await getDailyProviderUsage(
      "cloud",
      "summary",
      new Date("2026-08-18T12:00:00.000Z")
    );
    expect(usage).toEqual({ profileTokens: 160, actionTokens: 120 });
    expect(statSync(process.env.CBAI_USAGE_FILE!).mode & 0o777).toBe(0o600);
  });

  it("does not create records for zero-token attempts", async () => {
    await appendProviderUsage({
      action: "summary",
      profile: "local",
      prompt_tokens: 0,
      completion_tokens: 0,
    });
    expect(await getDailyProviderUsage("local", "summary")).toEqual({
      profileTokens: 0,
      actionTokens: 0,
    });
  });
});
