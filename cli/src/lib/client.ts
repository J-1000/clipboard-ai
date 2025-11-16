import { request } from "http";
import { homedir } from "os";
import { join } from "path";

const SOCKET_PATH = join(homedir(), ".clipboard-ai", "agent.sock");

export interface StatusResponse {
  status: string;
  uptime: string;
  version: string;
  clipboard: {
    text: string;
    type: string;
    timestamp: string;
  };
}

export interface ClipboardResponse {
  text: string;
  type: string;
  timestamp: string;
  length: number;
}

export interface ConfigResponse {
  provider: {
    type: string;
    endpoint: string;
    model: string;
    api_key?: string;
  };
  actions: Record<string, { enabled: boolean; trigger: string }>;
  settings: {
    poll_interval: number;
    safe_mode: boolean;
    notifications: boolean;
    log_level: string;
  };
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
  body?: unknown
): Promise<T> {
  return new Promise((resolve, reject) => {
    const options = {
      socketPath: SOCKET_PATH,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    const req = request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data) as T);
        } catch {
          reject(new Error(`Invalid JSON response: ${data}`));
        }
      });
    });

    req.on("error", (err) => {
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

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

export async function getStatus(): Promise<StatusResponse> {
  return makeRequest<StatusResponse>("GET", "/status");
}

export async function getClipboard(): Promise<ClipboardResponse> {
  return makeRequest<ClipboardResponse>("GET", "/clipboard");
}

export async function getConfig(): Promise<ConfigResponse> {
  return makeRequest<ConfigResponse>("GET", "/config");
}

export async function runAction(
  action: string,
  text?: string
): Promise<ActionResponse> {
  return makeRequest<ActionResponse>("POST", "/action", { action, text });
}
