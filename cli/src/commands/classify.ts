import { runActionCommand, type RunActionOptions } from "../lib/run-action.js";

export async function classifyCommand(options: RunActionOptions = {}): Promise<void> {
  await runActionCommand("classify", options);
}
