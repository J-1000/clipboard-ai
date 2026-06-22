import { AIClient, type AIConfig } from "./ai.js";
import { resolveAction, getActionRegistry, type ActionRegistry } from "./action-registry.js";
import type { ActionDefinition } from "./action-types.js";
import { copyToClipboard } from "./clipboard.js";
import { getConfig, type ConfigResponse } from "./client.js";
import { appendHistoryRecord, type HistoryRetentionSettings, type RunSource } from "./history.js";
import { getInput, type InputPayload } from "./input.js";
import { enforceSafeMode } from "./safe-mode.js";
import { scanSensitiveText } from "./sensitive-guard.js";

// Injectable collaborators. Defaulting to the real implementations keeps
// production callers unchanged while letting tests substitute fakes WITHOUT
// `mock.module`, whose partial, never-reset module shapes leak across files
// and produce false whole-suite failures.
export interface RunActionDeps {
  getActionRegistry: typeof getActionRegistry;
  getConfig: typeof getConfig;
  getInput: typeof getInput;
  copyToClipboard: typeof copyToClipboard;
  enforceSafeMode: typeof enforceSafeMode;
  appendHistoryRecord: typeof appendHistoryRecord;
  scanSensitiveText: typeof scanSensitiveText;
  createAIClient: (config: AIConfig) => AIClient;
}

const defaultRunActionDeps: RunActionDeps = {
  getActionRegistry,
  getConfig,
  getInput,
  copyToClipboard,
  enforceSafeMode,
  appendHistoryRecord,
  scanSensitiveText,
  createAIClient: (config) => new AIClient(config),
};

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
  deps?: Partial<RunActionDeps>;
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
  const deps = { ...defaultRunActionDeps, ...options.deps };

  try {
    const registry = options.registry ?? (await deps.getActionRegistry());
    const action = resolveAction(registry, actionName);

    if (!action) {
      const available = registry.actions.map((a) => a.id).sort().join(", ");
      console.error(`Error: Unknown action \"${actionName}\"`);
      console.error(`Available actions: ${available}`);
      process.exit(1);
    }

    const config = await deps.getConfig();
    historySettings = config.settings;
    input = options.input ?? (options.inputText ? { text: options.inputText } : await deps.getInput());
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
    const actionConfig = resolveConfiguredAction(config, actionName, action);
    const effectiveConfig = withProviderOverrides(config, {
      model: process.env.CBAI_MODEL_OVERRIDE || actionConfig?.model,
      endpoint: process.env.CBAI_ENDPOINT_OVERRIDE || actionConfig?.endpoint,
    });
    providerType = effectiveConfig.provider.type;
    providerModel = effectiveConfig.provider.model;
    resolvedActionName = action.id;
    inputText = text || input.rtf || (input.imageBase64 ? "[image]" : "");
    shouldRecord = true;

    const guardMode = config.settings.sensitive_guard ?? "warn";
    // Scan the RTF payload too: a styled paste can carry a secret that isn't in
    // the plain-text representation.
    const guardInput = input.rtf ? `${text}\n${input.rtf}` : text;
    if (!guardHit && guardInput && guardMode !== "off") {
      const findings = deps.scanSensitiveText(guardInput);
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

    await deps.enforceSafeMode(effectiveConfig, { yes: options.yes });

    if (action.progressMessage) {
      console.log(`${action.progressMessage}\n`);
    }

    const shouldStreamOutput = shouldStreamActionOutput(action, source, options);
    const streamedChunks: string[] = [];
    const maxTokens = actionConfig?.max_tokens ?? config.settings.max_tokens;
    const ai = deps.createAIClient({
      type: effectiveConfig.provider.type,
      endpoint: effectiveConfig.provider.endpoint,
      model: effectiveConfig.provider.model,
      apiKey: effectiveConfig.provider.api_key,
      maxTokens,
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
        config: effectiveConfig,
        args: options.args ?? [],
      });
    } finally {
      latencyMs = Date.now() - startedAt;
    }

    if (shouldStreamOutput && streamedChunks.length > 0) {
      // Tokens were streamed to stdout live; the accumulated buffer is the result.
      output = streamedChunks.join("");
      process.stdout.write("\n");
    } else if (shouldStreamOutput) {
      // Streaming was enabled but run() returned without emitting tokens (e.g. an
      // image action that doesn't stream, or a plugin returning a plain string).
      // Treat run()'s return as authoritative instead of discarding it.
      process.stdout.write(`${output ?? ""}\n`);
    } else {
      console.log(`${action.outputTitle}:`);
      console.log("─".repeat(action.outputTitle.length));
      console.log(output);
    }

    if (options.copy) {
      deps.copyToClipboard(output);
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
      await deps.appendHistoryRecord(
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
  action: ActionDefinition,
  source: RunSource,
  options: RunActionOptions
): boolean {
  if (source !== "manual" || options.copy || !process.stdout.isTTY) {
    return false;
  }
  if (action.id === "classify" || action.id === "extract") {
    return false;
  }
  // Image-only actions (caption/ocr) don't stream — generateWithImage buffers —
  // so don't enable streaming or their real result would be lost as a blank line.
  const inputs = action.inputTypes ?? ["text"];
  return inputs.includes("text");
}

function resolveConfiguredAction(
  config: ConfigResponse,
  requestedName: string,
  action: ActionDefinition
): ConfigResponse["actions"][string] | undefined {
  const names = [action.id, requestedName, ...(action.aliases ?? [])];
  for (const name of names) {
    const actionConfig = config.actions[name];
    if (actionConfig) {
      return actionConfig;
    }
  }
  return undefined;
}

function withProviderOverrides(
  config: ConfigResponse,
  overrides: { model?: string; endpoint?: string }
): ConfigResponse {
  const model = overrides.model?.trim();
  const endpoint = overrides.endpoint?.trim();

  return {
    ...config,
    provider: {
      ...config.provider,
      model: model || config.provider.model,
      endpoint: endpoint || config.provider.endpoint,
    },
  };
}
