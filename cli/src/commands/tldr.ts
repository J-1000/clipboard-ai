import { runActionCommand, type RunActionOptions } from "../lib/run-action.js";

export async function tldrCommand(options: RunActionOptions = {}): Promise<void> {
  await runActionCommand("tldr", options);
}
