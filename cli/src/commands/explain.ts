import { runActionCommand } from "../lib/run-action.js";

export async function explainCommand(options: { copy?: boolean; yes?: boolean; force?: boolean } = {}): Promise<void> {
  await runActionCommand("explain", options);
}
