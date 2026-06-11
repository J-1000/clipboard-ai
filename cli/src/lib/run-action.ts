import { AIClient } from "./ai.js";
import { resolveAction, getActionRegistry, type ActionRegistry } from "./action-registry.js";
import { copyToClipboard } from "./clipboard.js";
import { getConfig } from "./client.js";
import { appendHistoryRecord, type HistoryRetentionSettings, type RunSource } from "./history.js";
import { getInput, type InputPayload } from "./input.js";
import { enforceSafeMode } from "./safe-mode.js";
import { scanSensitiveText } from "./sensitive-guard.js";

export interface RunActionOptions {
  args?: string[];
  copy?: boolean;
  yes?: boolean;
  force?: boolean;
  registry?: ActionRegistry;
  inputText?: string;
  input?: InputPayload;
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
  let input: InputPayload | null = null;
  let historySettings: HistoryRetentionSettings | undefined;
  let guardHit = process.env.CBAI_SENSITIVE_GUARD_HIT === "true";

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
    historySettings = config.settings;
    input = options.input ?? (options.inputText ? { text: options.inputText } : await getInput());
    const text = input.text;
    const acceptedInputs = action.inputTypes ?? ["text"];
    const hasText = text.length > 0;
    const hasRTF = !!input.rtf;
    const hasImage = !!input.imageBase64;

    if (!hasText && !hasRTF && !hasImage) {
      console.error("Error: Clipboard is empty");
      process.exit(1);
    }

    const acceptsText = acceptedInputs.includes("text") && hasText;
    const acceptsRTF = acceptedInputs.includes("rtf") && hasRTF;
    const acceptsImage = acceptedInputs.includes("image") && hasImage;

    if (!acceptsText && !acceptsRTF && !acceptsImage) {
      console.error(`Error: Action "${action.id}" does not support clipboard type "${input.type ?? "unknown"}"`);
      process.exit(1);
    }

    source = options.source ?? (process.env.CBAI_DAEMON_MODE === "true" ? "daemon" : "manual");
    trigger = options.trigger ?? process.env.CBAI_TRIGGER ?? (source === "manual" ? "cli" : "daemon");
    providerType = config.provider.type;
    providerModel = config.provider.model;
    resolvedActionName = action.id;
    inputText = text || input.rtf || (input.imageBase64 ? "[image]" : "");
    shouldRecord = true;

    const guardMode = config.settings.sensitive_guard ?? "warn";
    if (!guardHit && text && guardMode !== "off") {
      const findings = scanSensitiveText(text);
      if (findings.length > 0) {
        guardHit = true;
        if (guardMode === "block" && !options.force) {
          throw new Error("clipboard looks like it contains a secret — action skipped. Use --force to run the action anyway.");
        }
        if (guardMode === "warn" && !options.force) {
          console.error("Warning: clipboard looks like it contains a secret.");
        }
      }
    }

    await enforceSafeMode(config, { yes: options.yes });

    if (action.progressMessage) {
      console.log(`${action.progressMessage}\n`);
    }

    const shouldStreamOutput = shouldStreamActionOutput(action.id, source, options);
    const streamedChunks: string[] = [];
    const ai = new AIClient({
      type: config.provider.type,
      endpoint: config.provider.endpoint,
      model: config.provider.model,
      apiKey: config.provider.api_key,
      onToken: shouldStreamOutput
        ? (token) => {
            streamedChunks.push(token);
            process.stdout.write(token);
          }
        : undefined,
    });

    const startedAt = Date.now();
    try {
      output = await action.run({
        text,
        rtf: input.rtf,
        imageBase64: input.imageBase64,
        imageMime: input.imageMime,
        contentType: input.type,
        ai,
        config,
        args: options.args ?? [],
      });
    } finally {
      latencyMs = Date.now() - startedAt;
    }

    if (shouldStreamOutput) {
      output = streamedChunks.join("");
      process.stdout.write("\n");
    } else {
      console.log(`${action.outputTitle}:`);
      console.log("─".repeat(action.outputTitle.length));
      console.log(output);
    }

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
      await appendHistoryRecord(
        {
          action: resolvedActionName,
          args: options.args ?? [],
          source,
          trigger,
          provider: providerType,
          model: providerModel,
          latency_ms: latencyMs,
          status: runError ? "error" : "success",
          copy: options.copy ?? false,
        input: guardHit ? "[sensitive content omitted]" : inputText,
        output: guardHit ? undefined : output,
        error: runError,
          replay_of: options.replayOf,
        },
        historySettings
      );
    } catch (historyErr) {
      console.error(`Warning: Failed to write history: ${(historyErr as Error).message}`);
    }
  }

  if (runError) {
    process.exit(1);
  }
}

function shouldStreamActionOutput(
  actionId: string,
  source: RunSource,
  options: RunActionOptions
): boolean {
  if (source !== "manual" || options.copy || !process.stdout.isTTY) {
    return false;
  }
  return actionId !== "classify" && actionId !== "extract";
}
