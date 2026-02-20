import { runActionCommand } from "../lib/run-action.js";

export async function tldrCommand(options: { copy?: boolean; yes?: boolean } = {}): Promise<void> {
  await runActionCommand("tldr", options);
}
