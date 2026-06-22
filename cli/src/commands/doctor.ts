import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  getConfig as defaultGetConfig,
  getStatus as defaultGetStatus,
  type ConfigResponse,
} from "../lib/client.js";
import { DEFAULT_PLUGIN_DIR } from "../lib/plugin-actions.js";
import { VERSION } from "../version.js";

export interface DoctorCommandDeps {
  getStatus: typeof defaultGetStatus;
  getConfig: typeof defaultGetConfig;
  pluginDir: string;
}

export async function doctorCommand(deps: Partial<DoctorCommandDeps> = {}): Promise<void> {
  const getStatus = deps.getStatus ?? defaultGetStatus;
  const getConfig = deps.getConfig ?? defaultGetConfig;
  const pluginDir = deps.pluginDir ?? DEFAULT_PLUGIN_DIR;

  passedChecks = 0;
  failedChecks = 0;

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
    if (status.version === VERSION) {
      pass(`daemon version matches CLI (${VERSION})`);
    } else {
      fail("daemon version matches CLI", `daemon ${status.version}, cli ${VERSION}`);
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
  checkPluginDir(pluginDir);
  checkDaemonInterpreter();

  console.log("──────────────────");
  console.log(`${passedChecks} passed, ${failedChecks} failed`);
  if (failedChecks > 0) {
    // Non-zero exit so launchd/CI health gating can detect a broken setup.
    process.exitCode = 1;
  }
}

// The daemon spawns `cbai` (a `#!/usr/bin/env node` script) using the PATH
// baked into its LaunchAgent plist — NOT the interactive shell PATH. On Apple
// Silicon a plist missing /opt/homebrew/bin means every triggered action fails
// with `env: node: No such file or directory`, invisibly until a trigger fires.
// This check resolves `node` against that exact PATH.
function checkDaemonInterpreter(): void {
  const plistPath = join(homedir(), "Library", "LaunchAgents", "ai.clipboard.agent.plist");
  if (!existsSync(plistPath)) {
    info("daemon interpreter", "LaunchAgent not installed");
    return;
  }

  let plist: string;
  try {
    plist = readFileSync(plistPath, "utf8");
  } catch (err) {
    fail("daemon interpreter", (err as Error).message);
    return;
  }

  const match = plist.match(/<key>PATH<\/key>\s*<string>([^<]*)<\/string>/);
  if (!match) {
    info("daemon interpreter", "LaunchAgent has no PATH override");
    return;
  }

  const dirs = match[1].split(":").filter(Boolean);
  const interpreter = "node";
  const found = dirs.some((dir) => {
    const candidate = join(dir, interpreter);
    try {
      return existsSync(candidate) && (statSync(candidate).mode & 0o111) !== 0;
    } catch {
      return false;
    }
  });

  if (found) {
    pass(`daemon PATH can resolve '${interpreter}'`);
  } else {
    fail(
      `daemon PATH can resolve '${interpreter}'`,
      `not found in LaunchAgent PATH (${match[1]}); re-run scripts/install.sh`
    );
  }
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

// Per-run tallies. Reset at the start of doctorCommand so the exit code and
// summary reflect only the current run (INFO is informational, not a failure).
let passedChecks = 0;
let failedChecks = 0;

function pass(label: string): void {
  passedChecks += 1;
  console.log(`PASS ${label}`);
}

function fail(label: string, detail: string): void {
  failedChecks += 1;
  console.log(`FAIL ${label}: ${detail}`);
}

function info(label: string, detail: string): void {
  console.log(`INFO ${label}: ${detail}`);
}
