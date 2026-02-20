import { runActionCommand } from "../lib/run-action.js";

export async function summaryCommand(options: { copy?: boolean; yes?: boolean } = {}): Promise<void> {
  await runActionCommand("summary", options);
}
