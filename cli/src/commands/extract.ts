import { runActionCommand, type RunActionOptions } from "../lib/run-action.js";

export async function extractCommand(options: RunActionOptions = {}): Promise<void> {
  await runActionCommand("extract", options);
}
