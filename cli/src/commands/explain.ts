import { getClipboard, getConfig } from "../lib/client.js";
import { AIClient } from "../lib/ai.js";

export async function explainCommand(): Promise<void> {
  try {
    const [clipboard, config] = await Promise.all([
      getClipboard(),
      getConfig(),
    ]);

    if (!clipboard.text) {
      console.error("Error: Clipboard is empty");
      process.exit(1);
    }

    console.log("Explaining clipboard content...\n");

    const ai = new AIClient({
      type: config.provider.type,
      endpoint: config.provider.endpoint,
      model: config.provider.model,
      apiKey: config.provider.api_key,
    });

    const explanation = await ai.explain(clipboard.text);

    console.log("Explanation:");
    console.log("────────────");
    console.log(explanation);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
