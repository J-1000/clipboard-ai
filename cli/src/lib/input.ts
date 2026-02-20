import { getClipboard } from "./client.js";

export async function getInputText(): Promise<string> {
  const envText = process.env.CBAI_INPUT_TEXT;
  if (envText !== undefined) {
    return envText;
  }

  const clipboard = await getClipboard();
  return clipboard.text;
}
