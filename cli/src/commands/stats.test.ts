import { describe, expect, it } from "bun:test";
import { summarizeRuns } from "./stats.js";
import type { ActionRunRecord } from "../lib/history.js";

function rec(overrides: Partial<ActionRunRecord>): ActionRunRecord {
  return {
    id: "x",
    timestamp: "2026-02-20T00:00:00.000Z",
    action: "summary",
    args: [],
    source: "manual",
    trigger: "cli",
    provider: "ollama",
    model: "mistral",
    latency_ms: 100,
    status: "success",
    copy: false,
    input: "in",
    ...overrides,
  };
}

describe("summarizeRuns", () => {
  it("aggregates runs, errors, tokens, and latency by action", () => {
    const summary = summarizeRuns([
      rec({ action: "summary", prompt_tokens: 10, completion_tokens: 5, latency_ms: 100 }),
      rec({ action: "summary", prompt_tokens: 20, completion_tokens: 10, latency_ms: 300, status: "error" }),
      rec({ action: "explain", prompt_tokens: 4, completion_tokens: 1, latency_ms: 50 }),
    ]);

    expect(summary.totalRuns).toBe(3);
    expect(summary.totalErrors).toBe(1);
    expect(summary.totalPromptTokens).toBe(34);
    expect(summary.totalCompletionTokens).toBe(16);

    const summaryAction = summary.byAction.find((a) => a.action === "summary")!;
    expect(summaryAction.runs).toBe(2);
    expect(summaryAction.errors).toBe(1);
    expect(summaryAction.avgLatencyMs).toBe(200);
  });

  it("handles empty history", () => {
    const summary = summarizeRuns([]);
    expect(summary.totalRuns).toBe(0);
    expect(summary.byAction).toEqual([]);
  });
});
