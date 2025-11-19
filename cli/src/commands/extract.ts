import { getClipboard, getConfig } from "../lib/client.js";
import { AIClient } from "../lib/ai.js";

export async function extractCommand(): Promise<void> {
  try {
    const [clipboard, config] = await Promise.all([
      getClipboard(),
      getConfig(),
    ]);

    if (!clipboard.text) {
      console.error("Error: Clipboard is empty");
      process.exit(1);
    }

    console.log("Extracting structured data...\n");

    const ai = new AIClient({
      type: config.provider.type,
      endpoint: config.provider.endpoint,
      model: config.provider.model,
      apiKey: config.provider.api_key,
    });

    const extracted = await ai.extractData(clipboard.text);

    console.log("Extracted Data:");
    console.log("───────────────");
    console.log(extracted);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
