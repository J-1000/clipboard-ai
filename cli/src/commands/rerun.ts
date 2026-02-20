import { getHistoryRecordById } from "../lib/history.js";
import { runActionCommand } from "../lib/run-action.js";

export async function rerunCommand(
  id: string,
  options: { copy?: boolean; yes?: boolean } = {}
): Promise<void> {
  try {
    const record = await getHistoryRecordById(id);
    if (!record) {
      console.error(`Error: History record not found: ${id}`);
      process.exit(1);
    }

    await runActionCommand(record.action, {
      args: record.args,
      copy: options.copy,
      yes: options.yes,
      inputText: record.input,
      source: "rerun",
      trigger: `rerun:${record.id}`,
      replayOf: record.id,
    });
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
