import { getClipboard as defaultGetClipboard } from "../lib/client.js";

export interface ClipboardCommandDeps {
  getClipboard: typeof defaultGetClipboard;
}

export async function clipboardCommand(deps: Partial<ClipboardCommandDeps> = {}): Promise<void> {
  const getClipboard = deps.getClipboard ?? defaultGetClipboard;
  try {
    const clipboard = await getClipboard();

    console.log(`Type: ${clipboard.type}`);
    // Character length is meaningless for images (length is 0 / not text).
    if (clipboard.type !== "image") {
      console.log(`Length: ${clipboard.length} chars`);
    }
    console.log(`Timestamp: ${clipboard.timestamp}`);
    console.log();
    console.log("Content:");
    console.log("────────");
    if (clipboard.type === "image") {
      const mime = clipboard.image_mime ?? "unknown";
      const sizeBytes = clipboard.image_base64
        ? Math.floor((clipboard.image_base64.length * 3) / 4)
        : 0;
      console.log(`[image] ${mime} (${sizeBytes} bytes)`);
    } else if (clipboard.type === "rtf") {
      const rtf = clipboard.rtf ?? "";
      if (!rtf) {
        console.log("(empty)");
      } else {
        const preview = rtf.length > 200 ? `${rtf.slice(0, 200)}...` : rtf;
        console.log(preview);
      }
    } else {
      console.log(clipboard.text || "(empty)");
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
