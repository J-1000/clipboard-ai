import { runActionCommand, type RunActionOptions } from "../lib/run-action.js";

export async function ocrCommand(options: RunActionOptions = {}): Promise<void> {
  await runActionCommand("ocr", options);
}
