import { getHistoryRecordById as defaultGetHistoryRecordById } from "../lib/history.js";
import { runActionCommand as defaultRunActionCommand } from "../lib/run-action.js";

export interface RerunCommandDeps {
  getHistoryRecordById: typeof defaultGetHistoryRecordById;
  runActionCommand: typeof defaultRunActionCommand;
}

export async function rerunCommand(
  id: string,
  options: { copy?: boolean; yes?: boolean; force?: boolean } = {},
  deps: Partial<RerunCommandDeps> = {}
): Promise<void> {
  const getHistoryRecordById = deps.getHistoryRecordById ?? defaultGetHistoryRecordById;
  const runActionCommand = deps.runActionCommand ?? defaultRunActionCommand;
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
      force: options.force,
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
