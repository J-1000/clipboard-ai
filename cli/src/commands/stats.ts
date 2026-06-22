import {
  readHistoryRecords as defaultReadHistoryRecords,
  type ActionRunRecord,
} from "../lib/history.js";

export interface StatsCommandDeps {
  readHistoryRecords: typeof defaultReadHistoryRecords;
}

export interface ActionStats {
  action: string;
  runs: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  avgLatencyMs: number;
}

export interface StatsSummary {
  totalRuns: number;
  totalErrors: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  byAction: ActionStats[];
}

export function summarizeRuns(records: ActionRunRecord[]): StatsSummary {
  const byAction = new Map<string, { runs: number; errors: number; prompt: number; completion: number; latency: number }>();

  for (const record of records) {
    const entry = byAction.get(record.action) ?? { runs: 0, errors: 0, prompt: 0, completion: 0, latency: 0 };
    entry.runs += 1;
    if (record.status === "error") entry.errors += 1;
    entry.prompt += record.prompt_tokens ?? 0;
    entry.completion += record.completion_tokens ?? 0;
    entry.latency += record.latency_ms ?? 0;
    byAction.set(record.action, entry);
  }

  const actions: ActionStats[] = [...byAction.entries()]
    .map(([action, e]) => ({
      action,
      runs: e.runs,
      errors: e.errors,
      promptTokens: e.prompt,
      completionTokens: e.completion,
      avgLatencyMs: e.runs > 0 ? Math.round(e.latency / e.runs) : 0,
    }))
    .sort((a, b) => b.runs - a.runs);

  return {
    totalRuns: records.length,
    totalErrors: actions.reduce((sum, a) => sum + a.errors, 0),
    totalPromptTokens: actions.reduce((sum, a) => sum + a.promptTokens, 0),
    totalCompletionTokens: actions.reduce((sum, a) => sum + a.completionTokens, 0),
    byAction: actions,
  };
}

export async function statsCommand(
  options: { json?: boolean } & Partial<StatsCommandDeps> = {}
): Promise<void> {
  const readHistoryRecords = options.readHistoryRecords ?? defaultReadHistoryRecords;
  try {
    const records = await readHistoryRecords();
    const summary = summarizeRuns(records);

    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    if (summary.totalRuns === 0) {
      console.log("No action history yet.");
      return;
    }

    console.log("clipboard-ai stats");
    console.log("──────────────────");
    console.log(`Total runs:        ${summary.totalRuns} (${summary.totalErrors} errors)`);
    console.log(`Prompt tokens:     ${summary.totalPromptTokens}`);
    console.log(`Completion tokens: ${summary.totalCompletionTokens}`);
    console.log();
    console.log("By action:");
    for (const a of summary.byAction) {
      console.log(
        `  ${a.action.padEnd(16)} runs=${a.runs} errors=${a.errors} ` +
          `tokens=${a.promptTokens + a.completionTokens} avg_latency=${a.avgLatencyMs}ms`
      );
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
