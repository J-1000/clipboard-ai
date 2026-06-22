import { runActionCommand, type RunActionOptions } from "../lib/run-action.js";

export async function explainCommand(options: RunActionOptions = {}): Promise<void> {
  await runActionCommand("explain", options);
}
