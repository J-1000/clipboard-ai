import { runActionCommand, type RunActionOptions } from "../lib/run-action.js";

export async function captionCommand(options: RunActionOptions = {}): Promise<void> {
  await runActionCommand("caption", options);
}
