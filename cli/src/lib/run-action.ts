import { AIClient } from "./ai.js";
import { resolveAction, getActionRegistry, type ActionRegistry } from "./action-registry.js";
import { copyToClipboard } from "./clipboard.js";
import { getConfig } from "./client.js";
import { appendHistoryRecord, type RunSource } from "./history.js";
import { getInputText } from "./input.js";
import { enforceSafeMode } from "./safe-mode.js";

export interface RunActionOptions {
  args?: string[];
  copy?: boolean;
  yes?: boolean;
  registry?: ActionRegistry;
  inputText?: string;
  source?: RunSource;
  trigger?: string;
  replayOf?: string;
}

export async function runActionCommand(actionName: string, options: RunActionOptions = {}): Promise<void> {
  let resolvedActionName = actionName;
  let inputText = "";
  let providerType = "";
  let providerModel = "";
  let trigger = "";
  let source: RunSource = options.source ?? "manual";
  let latencyMs = 0;
  let output: string | undefined;
  let runError: string | undefined;
  let shouldRecord = false;

  try {
    const registry = options.registry ?? (await getActionRegistry());
    const action = resolveAction(registry, actionName);

    if (!action) {
      const available = registry.actions.map((a) => a.id).sort().join(", ");
      console.error(`Error: Unknown action \"${actionName}\"`);
      console.error(`Available actions: ${available}`);
      process.exit(1);
    }

    const config = await getConfig();
    const text = options.inputText ?? (await getInputText());

    if (!text) {
      console.error("Error: Clipboard is empty");
      process.exit(1);
    }

    source = options.source ?? (process.env.CBAI_DAEMON_MODE === "true" ? "daemon" : "manual");
    trigger = options.trigger ?? process.env.CBAI_TRIGGER ?? (source === "manual" ? "cli" : "daemon");
    providerType = config.provider.type;
    providerModel = config.provider.model;
    resolvedActionName = action.id;
    inputText = text;
    shouldRecord = true;

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

    const startedAt = Date.now();
    try {
      output = await action.run({
        text,
        ai,
        config,
        args: options.args ?? [],
      });
    } finally {
      latencyMs = Date.now() - startedAt;
    }

    console.log(`${action.outputTitle}:`);
    console.log("─".repeat(action.outputTitle.length));
    console.log(output);

    if (options.copy) {
      copyToClipboard(output);
      console.log("\n(Copied to clipboard)");
    }
  } catch (err) {
    runError = (err as Error).message;
    console.error(`Error: ${runError}`);
  } finally {
    if (!shouldRecord) {
      return;
    }

    try {
      await appendHistoryRecord({
        action: resolvedActionName,
        args: options.args ?? [],
        source,
        trigger,
        provider: providerType,
        model: providerModel,
        latency_ms: latencyMs,
        status: runError ? "error" : "success",
        copy: options.copy ?? false,
        input: inputText,
        output,
        error: runError,
        replay_of: options.replayOf,
      });
    } catch (historyErr) {
      console.error(`Warning: Failed to write history: ${(historyErr as Error).message}`);
    }
  }

  if (runError) {
    process.exit(1);
  }
}
