import { runActionCommand, type RunActionOptions } from "../lib/run-action.js";

export async function runCommand(
  action: string,
  options: RunActionOptions = {}
): Promise<void> {
  await runActionCommand(action, options);
}
