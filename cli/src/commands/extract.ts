import { runActionCommand } from "../lib/run-action.js";

export async function extractCommand(options: { copy?: boolean; yes?: boolean; force?: boolean } = {}): Promise<void> {
  await runActionCommand("extract", options);
}
