import { existsSync, mkdirSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { homedir } from "os";
import { dirname, join } from "path";

// Embedded default config so a fresh install can scaffold one without the repo.
// Keep in sync with configs/default.toml.
const DEFAULT_CONFIG = `# clipboard-ai configuration

[provider]
# Provider type: ollama, openai, anthropic, or a custom endpoint
type = "ollama"
endpoint = "http://localhost:11434/v1"
model = "mistral"
# api_key = "sk-..."   # required for openai/anthropic

[settings]
poll_interval = 150
safe_mode = true
notifications = true
log_level = "info"
clipboard_dedupe_window_ms = 1000
http_enabled = false
http_addr = "127.0.0.1:9159"
# http_auth_token = "set-a-long-random-token"
history_enabled = true
history_max_entries = 1000
history_truncate_chars = 2000
sensitive_guard = "warn"
max_concurrent_actions = 4
max_tokens = 1024

[actions.summarize]
enabled = true
trigger = "length > 200"

[actions.explain]
enabled = true
trigger = "mime:code"
`;

export interface InitCommandOptions {
  force?: boolean;
  edit?: boolean;
}

export function configPath(): string {
  return process.env.CBAI_CONFIG_FILE ?? join(homedir(), ".clipboard-ai", "config.toml");
}

export function initCommand(options: InitCommandOptions = {}): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  if (existsSync(path) && !options.force) {
    console.log(`Config already exists at ${path}`);
    console.log("Use `cbai init --force` to overwrite, or `cbai init --edit` to open it.");
  } else {
    writeFileSync(path, DEFAULT_CONFIG, { mode: 0o600 });
    console.log(`Wrote default configuration to ${path}`);
    console.log("Next: set your provider/model, then run `cbai doctor`.");
  }

  if (options.edit) {
    openInEditor(path);
  }
}

function openInEditor(path: string): void {
  const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vi";
  const result = spawnSync(editor, [path], { stdio: "inherit" });
  if (result.error) {
    console.error(`Failed to open editor (${editor}): ${result.error.message}`);
    process.exit(1);
  }
  console.log("Tip: run `cbai doctor` to validate your configuration.");
}
