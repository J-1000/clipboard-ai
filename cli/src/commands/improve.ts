import { runActionCommand } from "../lib/run-action.js";

export async function improveCommand(options: { copy?: boolean; yes?: boolean } = {}): Promise<void> {
  await runActionCommand("improve", options);
}
