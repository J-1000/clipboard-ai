import { runActionCommand } from "../lib/run-action.js";

export async function translateCommand(lang: string, options: { copy?: boolean; yes?: boolean } = {}): Promise<void> {
  await runActionCommand("translate", { ...options, args: [lang] });
}
