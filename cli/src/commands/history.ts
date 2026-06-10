import {
  clearHistoryRecords,
  pruneHistoryBefore,
  readHistoryRecords,
} from "../lib/history.js";

export async function historyCommand(
  options: { limit?: number; clear?: boolean; before?: string } = {}
): Promise<void> {
  try {
    if (options.clear) {
      await clearHistoryRecords();
      console.log("History cleared.");
      return;
    }

    if (options.before) {
      const before = new Date(options.before);
      if (Number.isNaN(before.getTime())) {
        throw new Error(`Invalid --before date: ${options.before}`);
      }

      const removed = await pruneHistoryBefore(before);
      console.log(`Pruned ${removed} history entr${removed === 1 ? "y" : "ies"}.`);
      return;
    }

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
