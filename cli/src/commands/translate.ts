import { runActionCommand, type RunActionOptions } from "../lib/run-action.js";

export async function translateCommand(lang: string, options: RunActionOptions = {}): Promise<void> {
  await runActionCommand("translate", { ...options, args: [lang] });
}
