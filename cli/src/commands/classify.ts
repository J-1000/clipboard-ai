import { getClipboard, getConfig } from "../lib/client.js";
import { AIClient } from "../lib/ai.js";
import { copyToClipboard } from "../lib/clipboard.js";

export async function classifyCommand(options: { copy?: boolean } = {}): Promise<void> {
  try {
    const [clipboard, config] = await Promise.all([
      getClipboard(),
      getConfig(),
    ]);

    if (!clipboard.text) {
      console.error("Error: Clipboard is empty");
      process.exit(1);
    }

    console.log("Classifying clipboard content...\n");

    const ai = new AIClient({
      type: config.provider.type,
      endpoint: config.provider.endpoint,
      model: config.provider.model,
      apiKey: config.provider.api_key,
    });

    const classification = await ai.classify(clipboard.text);

    console.log("Classification:");
    console.log("───────────────");
    console.log(classification);

    if (options.copy) {
      copyToClipboard(classification);
      console.log("\n(Copied to clipboard)");
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
