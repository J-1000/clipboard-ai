import { runActionCommand } from "../lib/run-action.js";

export async function runCommand(
  action: string,
  options: { args?: string[]; copy?: boolean; yes?: boolean; force?: boolean } = {}
): Promise<void> {
  await runActionCommand(action, options);
}
