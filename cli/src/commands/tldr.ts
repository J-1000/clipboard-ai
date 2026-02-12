import { getClipboard, getConfig } from "../lib/client.js";
import { AIClient } from "../lib/ai.js";
import { copyToClipboard } from "../lib/clipboard.js";
import { enforceSafeMode } from "../lib/safe-mode.js";

export async function tldrCommand(options: { copy?: boolean; yes?: boolean } = {}): Promise<void> {
  try {
    const [clipboard, config] = await Promise.all([
      getClipboard(),
      getConfig(),
    ]);

    if (!clipboard.text) {
      console.error("Error: Clipboard is empty");
      process.exit(1);
    }

    await enforceSafeMode(config, { yes: options.yes });

    const ai = new AIClient({
      type: config.provider.type,
      endpoint: config.provider.endpoint,
      model: config.provider.model,
      apiKey: config.provider.api_key,
    });

    const response = await ai.generate(
      `Give a very brief TL;DR (1-2 sentences max) of this:\n\n${clipboard.text}`,
      "You provide extremely brief summaries. Be concise."
    );

    console.log("TL;DR:");
    console.log(response.content);

    if (options.copy) {
      copyToClipboard(response.content);
      console.log("\n(Copied to clipboard)");
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
