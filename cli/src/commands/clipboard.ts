import { getClipboard } from "../lib/client.js";

export async function clipboardCommand(): Promise<void> {
  try {
    const clipboard = await getClipboard();

    console.log(`Type: ${clipboard.type}`);
    console.log(`Length: ${clipboard.length} chars`);
    console.log(`Timestamp: ${clipboard.timestamp}`);
    console.log();
    console.log("Content:");
    console.log("────────");
    console.log(clipboard.text || "(empty)");
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
