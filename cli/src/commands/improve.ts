import { getConfig } from "../lib/client.js";
import { AIClient } from "../lib/ai.js";
import { copyToClipboard } from "../lib/clipboard.js";
import { enforceSafeMode } from "../lib/safe-mode.js";
import { getInputText } from "../lib/input.js";

export async function improveCommand(options: { copy?: boolean; yes?: boolean } = {}): Promise<void> {
  try {
    const [text, config] = await Promise.all([getInputText(), getConfig()]);

    if (!text) {
      console.error("Error: Clipboard is empty");
      process.exit(1);
    }

    await enforceSafeMode(config, { yes: options.yes });

    console.log("Improving writing...\n");

    const ai = new AIClient({
      type: config.provider.type,
      endpoint: config.provider.endpoint,
      model: config.provider.model,
      apiKey: config.provider.api_key,
    });

    const improved = await ai.improve(text);

    console.log("Improved:");
    console.log("─────────");
    console.log(improved);

    if (options.copy) {
      copyToClipboard(improved);
      console.log("\n(Copied to clipboard)");
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
