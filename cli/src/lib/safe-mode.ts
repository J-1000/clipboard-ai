import { createInterface } from "readline";
import type { ConfigResponse } from "./client.js";

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
    const url = new URL(endpoint);
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1"
    );
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

  // Daemon-triggered — cannot prompt, block entirely
  if (process.env.CBAI_DAEMON_MODE === "true") {
    throw new Error(
      `safe mode: blocked cloud call to ${provider} (daemon auto-triggered)`
    );
  }

  // --yes flag skips prompt
  if (options.yes) {
    return;
  }

  // Interactive confirmation
  const allowed = await confirm(
    `Safe mode: send clipboard to cloud provider "${provider}"?`
  );
  if (!allowed) {
    throw new Error("safe mode: user declined cloud provider call");
  }
}
