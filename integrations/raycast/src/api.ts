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

export async function runAction(action: string, body: Record<string, unknown> = {}): Promise<ActionResponse> {
  return request<ActionResponse>("/action", {
    method: "POST",
    body: JSON.stringify({ action, ...body }),
  });
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const prefs = preferences();
  const response = await fetch(`${prefs.baseUrl}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${prefs.token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `clipboard-ai HTTP API returned ${response.status}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("clipboard-ai HTTP API returned invalid JSON");
  }
}

export function actionResult(response: ActionResponse): string {
  if (response.success && response.result !== undefined) {
    return response.result;
  }
  throw new Error(response.error || `${response.action} failed`);
}
