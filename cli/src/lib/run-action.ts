import { AIClient } from "./ai.js";
import { resolveAction, defaultActionRegistry, type ActionRegistry } from "./action-registry.js";
import { copyToClipboard } from "./clipboard.js";
import { getConfig } from "./client.js";
import { getInputText } from "./input.js";
import { enforceSafeMode } from "./safe-mode.js";

export interface RunActionOptions {
  args?: string[];
  copy?: boolean;
  yes?: boolean;
  registry?: ActionRegistry;
}

export async function runActionCommand(actionName: string, options: RunActionOptions = {}): Promise<void> {
  try {
    const registry = options.registry ?? defaultActionRegistry;
    const action = resolveAction(registry, actionName);

    if (!action) {
      const available = registry.actions.map((a) => a.id).sort().join(", ");
      console.error(`Error: Unknown action \"${actionName}\"`);
      console.error(`Available actions: ${available}`);
      process.exit(1);
    }

    const [text, config] = await Promise.all([getInputText(), getConfig()]);

    if (!text) {
      console.error("Error: Clipboard is empty");
      process.exit(1);
    }

    await enforceSafeMode(config, { yes: options.yes });

    if (action.progressMessage) {
      console.log(`${action.progressMessage}\n`);
    }

    const ai = new AIClient({
      type: config.provider.type,
      endpoint: config.provider.endpoint,
      model: config.provider.model,
      apiKey: config.provider.api_key,
    });

    const output = await action.run({
      text,
      ai,
      config,
      args: options.args ?? [],
    });

    console.log(`${action.outputTitle}:`);
    console.log("─".repeat(action.outputTitle.length));
    console.log(output);

    if (options.copy) {
      copyToClipboard(output);
      console.log("\n(Copied to clipboard)");
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
