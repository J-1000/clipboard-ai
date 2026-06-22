import { runActionCommand, type RunActionOptions } from "../lib/run-action.js";

export async function improveCommand(options: RunActionOptions = {}): Promise<void> {
  await runActionCommand("improve", options);
}
