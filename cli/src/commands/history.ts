import { readHistoryRecords } from "../lib/history.js";

export async function historyCommand(options: { limit?: number } = {}): Promise<void> {
  try {
    const limit = options.limit ?? 20;
    const records = await readHistoryRecords(limit);

    if (records.length === 0) {
      console.log("No history records found.");
      return;
    }

    console.log("Recent action runs");
    console.log("──────────────────");

    for (const record of records) {
      const status = record.status === "success" ? "ok" : "error";
      const latency = `${record.latency_ms}ms`;
      const replay = record.replay_of ? ` replay:${record.replay_of}` : "";
      console.log(
        `${record.id} | ${record.timestamp} | ${status} | ${record.source} | ${record.action} | ${latency}${replay}`
      );
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
