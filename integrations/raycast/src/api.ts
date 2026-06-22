import { getPreferenceValues } from "@raycast/api";

export interface Preferences {
  baseUrl: string;
  token: string;
}

export interface ActionResponse {
  success: boolean;
  action: string;
  result?: string;
  error?: string;
}

export interface HistoryRecord {
  id: string;
  timestamp: string;
  action: string;
  args: string[];
  source: string;
  trigger: string;
  provider: string;
  model: string;
  status: "success" | "error";
  latency_ms?: number;
  input?: string;
  output?: string;
  error?: string;
}

export interface HistoryResponse {
  records: HistoryRecord[];
  skipped_corrupt?: number;
}

export function preferences(): Preferences {
  const prefs = getPreferenceValues<Preferences>();
  return {
    baseUrl: prefs.baseUrl.replace(/\/+$/, ""),
    token: prefs.token,
  };
}

export async function runAction(
  action: string,
  body: Record<string, unknown> = {},
): Promise<ActionResponse> {
  return request<ActionResponse>("/action", {
    method: "POST",
    body: JSON.stringify({ action, ...body }),
  });
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const prefs = preferences();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${prefs.baseUrl}${path}`, {
      ...init,
      signal: init.signal ?? controller.signal,
      headers: {
        Authorization: `Bearer ${prefs.token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(
        `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s — is the agent reachable at ${prefs.baseUrl}?`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (response.status === 401) {
    throw new Error(`Unauthorized (401): ${text || "invalid token"}`);
  }
  if (!response.ok) {
    throw new Error(
      text || `clipboard-ai HTTP API returned ${response.status}`,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("clipboard-ai HTTP API returned invalid JSON");
  }
}

// friendlyError turns low-level failures into actionable setup guidance.
export function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (
    lower.includes("econnrefused") ||
    lower.includes("fetch failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("connect") ||
    lower.includes("timed out")
  ) {
    return (
      "Can't reach the clipboard-ai HTTP API.\n\n" +
      "1. In `~/.clipboard-ai/config.toml` set `http_enabled = true` and an `http_auth_token`.\n" +
      "2. Restart the agent.\n" +
      "3. Run the **Setup Clipboard AI** command and paste the token.\n\n" +
      `Details: ${message}`
    );
  }
  if (lower.includes("401") || lower.includes("unauthorized")) {
    return (
      "Unauthorized — the HTTP Auth Token in this extension's preferences doesn't match " +
      "`settings.http_auth_token`. Update it in the extension preferences (or via **Setup Clipboard AI**).\n\n" +
      `Details: ${message}`
    );
  }
  return message;
}

const REQUEST_TIMEOUT_MS = 60_000;

export function actionResult(response: ActionResponse): string {
  if (response.success && response.result !== undefined) {
    return response.result;
  }
  throw new Error(response.error || `${response.action} failed`);
}
