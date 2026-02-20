import { runActionCommand } from "../lib/run-action.js";

export async function classifyCommand(options: { copy?: boolean; yes?: boolean } = {}): Promise<void> {
  await runActionCommand("classify", options);
}
