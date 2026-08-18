import { AIClient, type AIConfig } from "./ai.js";
import { resolveAction, getActionRegistry, type ActionRegistry } from "./action-registry.js";
import type { ActionDefinition } from "./action-types.js";
import { copyToClipboard } from "./clipboard.js";
import {
  getConfig,
  getProviderChain,
  type ConfigResponse,
  type ProviderChainResponse,
  type ResolvedProviderProfile,
} from "./client.js";
import { appendHistoryRecord, type HistoryRetentionSettings, type RunSource } from "./history.js";
import { getInput, type InputPayload } from "./input.js";
import { enforceSafeMode } from "./safe-mode.js";
import { scanSensitiveText } from "./sensitive-guard.js";
import { appendProviderUsage, getDailyProviderUsage } from "./usage.js";

// Injectable collaborators. Defaulting to the real implementations keeps
// production callers unchanged while letting tests substitute fakes WITHOUT
// `mock.module`, whose partial, never-reset module shapes leak across files
// and produce false whole-suite failures.
export interface RunActionDeps {
  getActionRegistry: typeof getActionRegistry;
  getConfig: typeof getConfig;
  getProviderChain: typeof getProviderChain;
  getInput: typeof getInput;
  copyToClipboard: typeof copyToClipboard;
  enforceSafeMode: typeof enforceSafeMode;
  appendHistoryRecord: typeof appendHistoryRecord;
  scanSensitiveText: typeof scanSensitiveText;
  getDailyProviderUsage: typeof getDailyProviderUsage;
  appendProviderUsage: typeof appendProviderUsage;
  createAIClient: (config: AIConfig) => AIClient;
}

const defaultRunActionDeps: RunActionDeps = {
  getActionRegistry,
  getConfig,
  getProviderChain,
  getInput,
  copyToClipboard,
  enforceSafeMode,
  appendHistoryRecord,
  scanSensitiveText,
  getDailyProviderUsage,
  appendProviderUsage,
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

// Oversized clipboard content is truncated before it reaches the LLM so a huge
// paste can't blow the context window or run up cost. The marker makes the
// truncation visible in the output rather than silent.
const MAX_INPUT_CHARS = 100_000;

export function capInputSize(text: string): string {
  if (text.length <= MAX_INPUT_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_INPUT_CHARS)}\n…[truncated]`;
}

// promptActionFromConfig builds an action from a config-defined prompt template
// (`actions.<name>.prompt = "..."`), so users can add custom actions without a
// JS plugin. `{{input}}`/`{{args}}` are interpolated; otherwise the clipboard
// text is appended after the prompt.
export function promptActionFromConfig(name: string, config: ConfigResponse): ActionDefinition | null {
  const actionConfig = config.actions[name];
  const template = actionConfig?.prompt?.trim();
  if (!template) {
    return null;
  }
  return {
    id: name,
    description: `Custom action: ${name}`,
    inputTypes: ["text"],
    progressMessage: `Running ${name}...`,
    outputTitle: name,
    run: async ({ ai, text, args }) => {
      const response = await ai.generate(renderPromptTemplate(template, text, args ?? []));
      return response.content;
    },
  };
}

function renderPromptTemplate(template: string, text: string, args: string[]): string {
  if (template.includes("{{input}}") || template.includes("{{args}}")) {
    return template.replaceAll("{{input}}", text).replaceAll("{{args}}", args.join(" "));
  }
  return `${template}\n\n${text}`;
}

export async function runActionCommand(actionName: string, options: RunActionOptions = {}): Promise<void> {
  let resolvedActionName = actionName;
  let inputText = "";
  let providerType = "";
  let providerModel = "";
  let providerProfile = "";
  let trigger = "";
  let source: RunSource = options.source ?? "manual";
  let latencyMs = 0;
  let output: string | undefined;
  let runError: string | undefined;
  let shouldRecord = false;
  let promptTokens = 0;
  let completionTokens = 0;
  let input: InputPayload | null = null;
  let historySettings: HistoryRetentionSettings | undefined;
  let guardHit = process.env.CBAI_SENSITIVE_GUARD_HIT === "true";
  const deps = { ...defaultRunActionDeps, ...options.deps };

  try {
    const registry = options.registry ?? (await deps.getActionRegistry());
    const config = await deps.getConfig();
    historySettings = config.settings;

    // Resolve a built-in/plugin action, or synthesize one from a config-defined
    // prompt template (a custom action with no JS plugin).
    const action = resolveAction(registry, actionName) ?? promptActionFromConfig(actionName, config);

    if (!action) {
      const available = registry.actions.map((a) => a.id).sort().join(", ");
      console.error(`Error: Unknown action \"${actionName}\"`);
      console.error(`Available actions: ${available}`);
      process.exit(1);
    }
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
    const configuredAction = resolveConfiguredAction(config, actionName, action);
    const actionConfig = configuredAction?.config;
    const providerChain = await loadProviderChain(
      config,
      configuredAction?.name ?? action.id,
      actionConfig,
      deps
    );
    if (providerChain.profiles.length === 0) {
      throw new Error("no provider profiles are available for this action");
    }
    providerType = providerChain.profiles[0].type;
    providerModel = providerChain.profiles[0].model;
    providerProfile = providerChain.profiles[0].name;
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

    if (action.progressMessage) {
      console.log(`${action.progressMessage}\n`);
    }

    const hasUsageLimits =
      (providerChain.action_daily_token_limit ?? 0) > 0 ||
      providerChain.profiles.some((profile) => (profile.daily_token_limit ?? 0) > 0);
    const shouldStreamOutput =
      providerChain.profiles.length === 1 &&
      !hasUsageLimits &&
      shouldStreamActionOutput(action, source, options);
    const streamedChunks: string[] = [];
    const startedAt = Date.now();
    const profileErrors: string[] = [];

    for (const profile of providerChain.profiles) {
      providerType = profile.type;
      providerModel = profile.model;
      providerProfile = profile.name;
      const effectiveConfig = withProvider(config, profile);
      let ai: AIClient | undefined;

      try {
        await enforceUsageLimits(
          profile,
          action.id,
          providerChain.action_daily_token_limit,
          deps
        );
        await deps.enforceSafeMode(effectiveConfig, { yes: options.yes });

        ai = deps.createAIClient({
          type: profile.type,
          endpoint: profile.endpoint,
          model: profile.model,
          apiKey: profile.api_key,
          maxTokens: providerChain.max_tokens,
          onToken: shouldStreamOutput
            ? (token) => {
                streamedChunks.push(token);
                process.stdout.write(token);
              }
            : undefined,
        });

        output = await action.run({
          text: capInputSize(text),
          rtf: input.rtf ? capInputSize(input.rtf) : input.rtf,
          imageBase64: input.imageBase64,
          imageMime: input.imageMime,
          contentType: input.type,
          ai,
          config: effectiveConfig,
          args: options.args ?? [],
        });
        break;
      } catch (profileError) {
        profileErrors.push(`${profile.name}: ${(profileError as Error).message}`);
        if (profile !== providerChain.profiles.at(-1)) {
          console.error(`Warning: provider profile "${profile.name}" failed; trying fallback.`);
        }
      } finally {
        if (ai) {
          const used = ai.getUsage?.();
          if (used && (used.promptTokens > 0 || used.completionTokens > 0)) {
            promptTokens += used.promptTokens;
            completionTokens += used.completionTokens;
            if (hasUsageLimits) {
              try {
                await deps.appendProviderUsage({
                  action: action.id,
                  profile: profile.name,
                  prompt_tokens: used.promptTokens,
                  completion_tokens: used.completionTokens,
                });
              } catch (usageError) {
                console.error(`Warning: Failed to record provider usage: ${(usageError as Error).message}`);
              }
            }
          }
        }
      }
    }

    latencyMs = Date.now() - startedAt;
    if (output === undefined) {
      throw new Error(`all provider profiles failed: ${profileErrors.join("; ")}`);
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
          provider_profile: providerProfile || undefined,
          model: providerModel,
          latency_ms: latencyMs,
          status: runError ? "error" : "success",
          copy: options.copy ?? false,
          input: guardHit ? "[sensitive content omitted]" : inputText,
          output: guardHit ? undefined : output,
          error: runError,
          replay_of: options.replayOf,
          prompt_tokens: promptTokens || undefined,
          completion_tokens: completionTokens || undefined,
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
): { name: string; config: ConfigResponse["actions"][string] } | undefined {
  const names = [action.id, requestedName, ...(action.aliases ?? [])];
  for (const name of names) {
    const actionConfig = config.actions[name];
    if (actionConfig) {
      return { name, config: actionConfig };
    }
  }
  return undefined;
}

function withProvider(
  config: ConfigResponse,
  profile: ResolvedProviderProfile
): ConfigResponse {
  return {
    ...config,
    provider: profile,
  };
}

async function loadProviderChain(
  config: ConfigResponse,
  configuredActionName: string,
  actionConfig: ConfigResponse["actions"][string] | undefined,
  deps: RunActionDeps
): Promise<ProviderChainResponse> {
  const needsPrivateConfig =
    config.provider.api_key === "<redacted>" ||
    (config.provider.fallbacks?.length ?? 0) > 0 ||
    !!actionConfig?.provider_profile ||
    (actionConfig?.fallback_profiles?.length ?? 0) > 0;

  if (needsPrivateConfig) {
    const chain = await deps.getProviderChain(configuredActionName);
    return applyEnvironmentOverrides(chain);
  }

  const profile: ResolvedProviderProfile = {
    ...config.provider,
    name: "default",
    model: actionConfig?.model?.trim() || config.provider.model,
    endpoint: actionConfig?.endpoint?.trim() || config.provider.endpoint,
  };
  return applyEnvironmentOverrides({
    profiles: [profile],
    action_daily_token_limit: actionConfig?.daily_token_limit,
    max_tokens: actionConfig?.max_tokens ?? config.settings.max_tokens ?? 1024,
  });
}

function applyEnvironmentOverrides(chain: ProviderChainResponse): ProviderChainResponse {
  const model = process.env.CBAI_MODEL_OVERRIDE?.trim();
  const endpoint = process.env.CBAI_ENDPOINT_OVERRIDE?.trim();
  if (!model && !endpoint) {
    return chain;
  }
  return {
    ...chain,
    profiles: chain.profiles.map((profile, index) =>
      index === 0
        ? {
            ...profile,
            model: model || profile.model,
            endpoint: endpoint || profile.endpoint,
          }
        : profile
    ),
  };
}

async function enforceUsageLimits(
  profile: ResolvedProviderProfile,
  action: string,
  actionLimit: number | undefined,
  deps: RunActionDeps
): Promise<void> {
  const profileLimit = profile.daily_token_limit ?? 0;
  if (profileLimit <= 0 && (actionLimit ?? 0) <= 0) {
    return;
  }
  const usage = await deps.getDailyProviderUsage(profile.name, action);
  if (profileLimit > 0 && usage.profileTokens >= profileLimit) {
    throw new Error(
      `daily token limit reached for profile "${profile.name}" (${usage.profileTokens}/${profileLimit})`
    );
  }
  if ((actionLimit ?? 0) > 0 && usage.actionTokens >= (actionLimit ?? 0)) {
    throw new Error(
      `daily token limit reached for action "${action}" (${usage.actionTokens}/${actionLimit})`
    );
  }
}
