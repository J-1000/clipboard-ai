import { createInterface } from "readline";
import type { ConfigResponse } from "./client.js";
import { agentClientSource } from "./history.js";

export function isCloudProvider(providerType: string, endpoint?: string): boolean {
  if (endpoint) {
    return !isLocalEndpoint(endpoint);
  }

  if (providerType === "openai") {
    return true;
  }

  if (providerType === "anthropic") {
    return true;
  }

  if (providerType === "ollama") {
    return false;
  }

  return true;
}

function isLocalEndpoint(endpoint: string): boolean {
  try {
    // URL.hostname keeps the brackets of an IPv6 literal ("[::1]").
    const hostname = new URL(endpoint).hostname.replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export async function enforceSafeMode(
  config: ConfigResponse,
  options: { yes?: boolean } = {}
): Promise<void> {
  if (!config.settings.safe_mode) {
    return;
  }

  if (!isCloudProvider(config.provider.type, config.provider.endpoint)) {
    return;
  }

  const provider = config.provider.type || config.provider.endpoint;

  // Run by the agent — there is no terminal to prompt on, so block entirely.
  if (process.env.CBAI_DAEMON_MODE === "true") {
    const client = agentClientSource();
    const reason = client
      ? `requested via ${client}; set safe_mode = false or route this action to a local provider`
      : "daemon auto-triggered";
    throw new Error(`safe mode: blocked cloud call to ${provider} (${reason})`);
  }

  // --yes flag skips prompt
  if (options.yes) {
    return;
  }

  // Without a terminal the prompt below would never be answered.
  if (!process.stdin.isTTY) {
    throw new Error(
      `safe mode: cannot ask for confirmation to call ${provider} because stdin is not a terminal. Re-run with --yes to allow it.`
    );
  }

  // Interactive confirmation
  const allowed = await confirm(
    `Safe mode: send clipboard to cloud provider "${provider}"?`
  );
  if (!allowed) {
    throw new Error("safe mode: user declined cloud provider call");
  }
}
