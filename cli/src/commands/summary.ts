import { runActionCommand, type RunActionOptions } from "../lib/run-action.js";

export async function summaryCommand(options: RunActionOptions = {}): Promise<void> {
  await runActionCommand("summary", options);
}
