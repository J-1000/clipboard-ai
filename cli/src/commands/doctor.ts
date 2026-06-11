import { existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getConfig, getStatus, type ConfigResponse } from "../lib/client.js";
import { DEFAULT_PLUGIN_DIR } from "../lib/plugin-actions.js";
import pkg from "../../package.json" assert { type: "json" };

export async function doctorCommand(): Promise<void> {
  console.log("clipboard-ai doctor");
  console.log("──────────────────");

  let status: Awaited<ReturnType<typeof getStatus>> | null = null;
  let config: ConfigResponse | null = null;

  try {
    status = await getStatus();
    pass("daemon socket reachable");
  } catch (err) {
    fail("daemon socket reachable", (err as Error).message);
  }

  if (status) {
    if (status.version === pkg.version) {
      pass(`daemon version matches CLI (${pkg.version})`);
    } else {
      fail("daemon version matches CLI", `daemon ${status.version}, cli ${pkg.version}`);
    }
  }

  try {
    config = await getConfig();
    pass("config readable");
  } catch (err) {
    fail("config readable", (err as Error).message);
  }

  if (config) {
    await checkProvider(config);
    checkVisionCapability(config);
  }

  checkHistoryFile();
  checkPluginDir(DEFAULT_PLUGIN_DIR);
}

async function checkProvider(config: ConfigResponse): Promise<void> {
  const endpoint = effectiveEndpoint(config);

  try {
    if (config.provider.type === "ollama") {
      const tagsURL = new URL("/api/tags", endpoint).toString();
      const response = await fetch(tagsURL);
      if (!response.ok) {
        fail("provider endpoint reachable", `HTTP ${response.status}`);
        return;
      }

      pass("provider endpoint reachable");
      const body = (await response.json()) as { models?: Array<{ name?: string }> };
      const models = body.models?.map((model) => model.name).filter(Boolean) ?? [];
      if (models.includes(config.provider.model)) {
        pass(`configured model available (${config.provider.model})`);
      } else {
        fail(
          `configured model available (${config.provider.model})`,
          models.length > 0 ? `available: ${models.join(", ")}` : "no models returned"
        );
      }
      return;
    }

    const response = await fetch(endpoint, { method: "HEAD" });
    if (response.ok || response.status < 500) {
      pass("provider endpoint reachable");
    } else {
      fail("provider endpoint reachable", `HTTP ${response.status}`);
    }
  } catch (err) {
    fail("provider endpoint reachable", (err as Error).message);
  }
}

function checkVisionCapability(config: ConfigResponse): void {
  const imageActionsEnabled = Object.entries(config.actions).some(
    ([name, action]) => action.enabled && (name === "caption" || name === "ocr")
  );
  if (!imageActionsEnabled) {
    info("vision capability", "caption/ocr disabled");
    return;
  }

  const model = config.provider.model.toLowerCase();
  if (/(vision|llava|bakllava|moondream|gpt-4o|gpt-4\.1|qwen.*vl)/.test(model)) {
    pass(`vision capability likely available (${config.provider.model})`);
    return;
  }

  info("vision capability", "unknown — caption/ocr may fail");
}

function checkHistoryFile(): void {
  const historyFile = process.env.CBAI_HISTORY_FILE ?? join(homedir(), ".clipboard-ai", "history.jsonl");
  if (!existsSync(historyFile)) {
    info("history file", "not present");
    return;
  }

  const size = statSync(historyFile).size;
  pass(`history file size ${formatBytes(size)}`);
}

function checkPluginDir(dir: string): void {
  if (!existsSync(dir)) {
    info("plugin directory", "not present");
    return;
  }

  const count = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).length;
  pass(`plugin directory scan (${count} file${count === 1 ? "" : "s"})`);
}

function effectiveEndpoint(config: ConfigResponse): string {
  if (config.provider.endpoint) {
    return config.provider.endpoint;
  }
  if (config.provider.type === "openai") {
    return "https://api.openai.com/v1";
  }
  if (config.provider.type === "anthropic") {
    return "https://api.anthropic.com/v1";
  }
  return "http://localhost:11434/v1";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pass(label: string): void {
  console.log(`PASS ${label}`);
}

function fail(label: string, detail: string): void {
  console.log(`FAIL ${label}: ${detail}`);
}

function info(label: string, detail: string): void {
  console.log(`INFO ${label}: ${detail}`);
}
