import { request } from "http";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const SOCKET_PATH = join(homedir(), ".clipboard-ai", "agent.sock");
const DEFAULT_IPC_TIMEOUT_MS = 10_000;
// POST /action waits for a whole model call. It must outlast the agent's own
// action timeout (30s by default, or actions.<name>.timeout_ms).
const DEFAULT_ACTION_TIMEOUT_MS = 120_000;

export interface StatusResponse {
  status: string;
  uptime: string;
  version: string;
  clipboard: {
    text: string;
    type: string;
    timestamp: string;
  };
  monitoring?: ControlsResponse;
}

export interface ControlsResponse {
  monitoring: boolean;
  paused: boolean;
  snoozed_until?: string;
  default_snooze_minutes: number;
  app_allowlist: string[];
  app_denylist: string[];
}

export interface ClipboardResponse {
  text: string;
  rtf?: string;
  image_base64?: string;
  image_mime?: string;
  type: string;
  timestamp: string;
  length: number;
}

export interface ConfigResponse {
  provider: ProviderProfile;
  providers?: Record<string, ProviderProfile>;
  actions: Record<
    string,
    {
      enabled: boolean;
      trigger: string;
      prompt?: string;
      provider_profile?: string;
      fallback_profiles?: string[];
      daily_token_limit?: number;
      model?: string;
      endpoint?: string;
      timeout_ms?: number;
      retry_count?: number;
      retry_backoff_ms?: number;
      cooldown_ms?: number;
      max_tokens?: number;
    }
  >;
  settings: {
    poll_interval: number;
    safe_mode: boolean;
    notifications: boolean;
    log_level: string;
    clipboard_dedupe_window_ms?: number;
    http_enabled?: boolean;
    http_addr?: string;
    http_auth_token?: string;
    history_enabled?: boolean;
    history_max_entries?: number;
    history_truncate_chars?: number;
    sensitive_guard?: "block" | "warn" | "off";
    max_concurrent_actions?: number;
    max_tokens?: number;
  };
  privacy?: {
    start_paused: boolean;
    default_snooze_minutes: number;
    app_allowlist: string[];
    app_denylist: string[];
    skip_concealed?: boolean;
  };
}

export interface ProviderProfile {
  type: string;
  endpoint: string;
  model: string;
  api_key?: string;
  fallbacks?: string[];
  daily_token_limit?: number;
}

export interface ResolvedProviderProfile extends ProviderProfile {
  name: string;
}

export interface ProviderChainResponse {
  profiles: ResolvedProviderProfile[];
  action_daily_token_limit?: number;
  max_tokens: number;
}

export interface ActionRequest {
  text?: string;
  rtf?: string;
  image_base64?: string;
  image_mime?: string;
  type?: string;
  args?: string[];
  // Ask the agent to read the clipboard now instead of using what automatic
  // monitoring last saw. Only meaningful when no payload is supplied.
  fresh?: boolean;
  // Which client is asking: "menubar", "raycast", or "mcp".
  source?: string;
}

export interface ActionResponse {
  success: boolean;
  action: string;
  result?: string;
  error?: string;
}

async function makeRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  timing: { timeoutMs?: number; describeTimeout?: (timeoutMs: number) => string } = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!existsSync(SOCKET_PATH)) {
      reject(new Error("Agent not running. Start with: clipboard-ai-agent"));
      return;
    }

    const options = {
      socketPath: SOCKET_PATH,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeoutMs = timing.timeoutMs ?? getIPCTimeoutMs();
    const timeoutError = () =>
      new Error(
        timing.describeTimeout?.(timeoutMs) ??
          `daemon did not respond within ${formatTimeoutSeconds(timeoutMs)} — is clipboard-ai-agent running? Try \`cbai logs\``
      );

    const req = request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (timeout) {
          clearTimeout(timeout);
        }
        const statusCode = res.statusCode || 0;
        const isSuccess = statusCode >= 200 && statusCode < 300;

        if (!isSuccess) {
          let message = data;
          try {
            const parsed = JSON.parse(data) as { error?: string; message?: string };
            message = parsed.error || parsed.message || data;
          } catch {
            // ignore parse errors
          }
          reject(
            new Error(
              `Request failed (${statusCode}): ${message || "Unknown error"}`
            )
          );
          return;
        }

        try {
          resolve(JSON.parse(data) as T);
        } catch {
          reject(new Error(`Invalid JSON response: ${data}`));
        }
      });
    });

    req.on("error", (err) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error("Agent not running. Start with: clipboard-ai-agent")
        );
      } else if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
        reject(new Error("Agent not responding. Try restarting."));
      } else {
        reject(err);
      }
    });

    const onTimeout = () => {
      if (timedOut) {
        return;
      }
      timedOut = true;
      const err = timeoutError();
      reject(err);
      req.destroy(err);
    };
    req.setTimeout(timeoutMs, onTimeout);
    timeout = setTimeout(onTimeout, timeoutMs);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

export async function getStatus(): Promise<StatusResponse> {
  return makeRequest<StatusResponse>("GET", "/status");
}

// `fresh` asks the agent to read the clipboard now. Manual commands use it so
// they work while automatic monitoring is paused, snoozed, or blocked for the
// source application.
export async function getClipboard(options: { fresh?: boolean } = {}): Promise<ClipboardResponse> {
  return makeRequest<ClipboardResponse>("GET", options.fresh ? "/clipboard?fresh=true" : "/clipboard");
}

export async function getConfig(): Promise<ConfigResponse> {
  return makeRequest<ConfigResponse>("GET", "/config");
}

export async function getControls(): Promise<ControlsResponse> {
  return makeRequest<ControlsResponse>("GET", "/controls");
}

export async function setMonitoringControl(
  action: "pause" | "resume" | "snooze",
  durationMinutes?: number
): Promise<ControlsResponse> {
  return makeRequest<ControlsResponse>("POST", "/controls", {
    action,
    ...(durationMinutes === undefined ? {} : { duration_minutes: durationMinutes }),
  });
}

export async function getProviderChain(action: string): Promise<ProviderChainResponse> {
  return makeRequest<ProviderChainResponse>(
    "GET",
    `/provider-chain?action=${encodeURIComponent(action)}`
  );
}

export async function runAgentAction(
  action: string,
  input: ActionRequest = {}
): Promise<ActionResponse> {
  return makeRequest<ActionResponse>(
    "POST",
    "/action",
    {
      action,
      ...input,
    },
    {
      timeoutMs: getActionTimeoutMs(),
      describeTimeout: (timeoutMs) =>
        `action "${action}" did not finish within ${formatTimeoutSeconds(timeoutMs)}. ` +
        "Raise CBAI_ACTION_TIMEOUT_MS (and the action's timeout_ms) if the model needs longer.",
    }
  );
}

function getIPCTimeoutMs(): number {
  const configured = Number.parseInt(process.env.CBAI_IPC_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_IPC_TIMEOUT_MS;
}

function getActionTimeoutMs(): number {
  const configured = Number.parseInt(process.env.CBAI_ACTION_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_ACTION_TIMEOUT_MS;
}

function formatTimeoutSeconds(timeoutMs: number): string {
  const seconds = timeoutMs / 1000;
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
}
