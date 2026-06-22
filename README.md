# clipboard-ai

[![CI](https://github.com/J-1000/clipboard-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/J-1000/clipboard-ai/actions/workflows/ci.yml)

**AI lookups & summaries triggered directly from your clipboard**

clipboard-ai is a macOS-first lightweight agent that monitors your clipboard and performs real-time transformations using LLMs. Copy text, get AI-powered summaries, explanations, translations—automatically.

## Current Status

- Project status snapshot: see `STATUS.md`
- Provider support: Ollama, OpenAI, Anthropic, and custom OpenAI-compatible endpoints
- Safe mode: blocks daemon-triggered cloud calls and prompts on manual CLI calls (unless `--yes` is used)
- Trigger/clipboard length behavior: character-based (UTF-8 rune-aware), not byte-based
- Clipboard types: text, RTF, images (image actions require vision-capable models)
- Local HTTP API: optional authenticated localhost server for integrations

## Features

- **Automatic triggers**: Configure rules to run AI actions when clipboard content matches patterns
- **CLI-first**: Full-featured command-line interface (`cbai`)
- **Local LLM support**: Works with Ollama out of the box, no API keys required
- **Privacy-focused**: Safe mode blocks cloud calls without explicit approval
- **Extensible**: Add custom actions as TypeScript modules

## Quick Start

### Prerequisites

- macOS 12+
- [Go 1.21+](https://golang.org/dl/) (for building the agent)
- [Bun](https://bun.sh/) or Node.js (for the CLI)
- [Ollama](https://ollama.ai/) (recommended for local LLM)

### Installation

```bash
# Clone the repository
git clone https://github.com/J-1000/clipboard-ai.git
cd clipboard-ai

# Run the installer
./scripts/install.sh
```

The installer will:
1. Build and install the Go daemon
2. Build and install the CLI
3. Set up the LaunchAgent for auto-start
4. Create default configuration

### Manual Installation

```bash
# Build the agent
cd agent
go build -o clipboard-ai-agent ./cmd/clipboard-ai-agent/
sudo cp clipboard-ai-agent /usr/local/bin/

# Build the CLI
cd ../cli
bun install
bun run build
sudo cp dist/index.js /usr/local/bin/cbai
chmod +x /usr/local/bin/cbai
```

## Usage

### CLI Commands

```bash
# Check agent status
cbai status

# View current clipboard
cbai clipboard

# Summarize clipboard content
cbai summary

# Explain clipboard (great for code)
cbai explain

# Caption clipboard image
cbai caption

# Extract text from clipboard image
cbai ocr

# Translate clipboard
cbai translate Spanish

# Improve writing
cbai improve

# Extract structured data
cbai extract

# Ultra-brief summary
cbai tldr

# Classify content type
cbai classify

# Run any registered action (built-in or plugin)
cbai run summary
cbai run translate Spanish
cbai run my_plugin_action arg1 arg2

# Show recent action history
cbai history

# Replay a previous run
cbai rerun <run-id>

# Show recent agent logs (tail)
cbai logs --tail 100

# View configuration
cbai config

# List registered actions
cbai actions

# Run diagnostics
cbai doctor
```

### --copy Flag

All AI commands support `--copy` (or `-c`) to copy the result to your clipboard:

```bash
cbai summary --copy
cbai explain -c
cbai translate Spanish --copy
```

### --yes Flag

All AI commands support `--yes` (or `-y`) to skip safe mode confirmation prompts:

```bash
cbai summary --yes
cbai explain -y
```

### Safe Mode

When `safe_mode = true` in config, clipboard content won't be sent to cloud providers (OpenAI, Anthropic, or remote custom endpoints) without consent:

- **Manual CLI usage**: Shows an interactive confirmation prompt before cloud calls
- **Daemon-triggered (automatic)**: Blocks cloud calls entirely and sends a macOS notification
- **Local providers** (Ollama, localhost endpoints): Always allowed regardless of safe mode
- **`--yes` flag**: Skips the confirmation prompt

### Configuration

Configuration file: `~/.clipboard-ai/config.toml`

```toml
[provider]
type = "ollama"
endpoint = "http://localhost:11434/v1"
model = "mistral"

[settings]
poll_interval = 150
safe_mode = true
notifications = true
clipboard_dedupe_window_ms = 1000
http_enabled = false
http_addr = "127.0.0.1:9159"
# http_auth_token = "set-a-long-random-token"
sensitive_guard = "warn"

[actions.summarize]
enabled = true
trigger = "length > 200"
timeout_ms = 15000
retry_count = 1
retry_backoff_ms = 300
cooldown_ms = 1000

[actions.explain]
enabled = true
trigger = "mime:code"

# Image actions (disabled by default)
# [actions.caption]
# enabled = false
# trigger = "mime:image"

# [actions.ocr]
# enabled = false
# trigger = "mime:image"

# URL summarization (disabled by default)
# [actions.summarize_url]
# enabled = false
# trigger = "regex:^https?://\\S+$"
```

### Config Hot Reload

The agent watches `~/.clipboard-ai/config.toml` and reloads valid changes without restart. Provider settings, action definitions, trigger rules, safe mode, notifications, logging level, sensitive guard, history settings, and per-action routing are applied to new clipboard events and manual CLI calls after reload.

Invalid TOML, invalid settings, or invalid trigger regexes are rejected; the agent keeps the last valid config and sends a notification when notifications are enabled. Send `SIGHUP` to `clipboard-ai-agent` to force a reload manually.

Changes to `settings.http_enabled`, `settings.http_addr`, and `settings.poll_interval` are logged as restart-required because the HTTP server and clipboard poller are created at startup.

### Local HTTP API

When `settings.http_enabled = true`, the agent also exposes a localhost HTTP API.

- Full endpoint reference: `docs/http-api.md`
- Integration snippets (Raycast, Alfred, editor shell): `docs/integrations/local-http-clients.md`
- Example script: `scripts/examples/http-action.sh`
- Raycast extension: `integrations/raycast/` includes setup, summary, explain, translate, and history commands.

### Diagnostics

- `cbai actions` lists built-in and plugin actions with aliases, descriptions, enabled state, and configured triggers.
- `cbai doctor` checks daemon reachability, daemon/CLI version match, provider reachability, Ollama model availability, image-action model guidance, history file size, and plugin directory state.
- If image actions are enabled and model vision support cannot be recognized, doctor reports `unknown — caption/ocr may fail`.

### Trigger Expressions

- `length > 200` - Content longer than 200 characters
- `length >= 200`, `length <= 200`, `length != 0` - Extended comparisons
- `contains:http` - Contains "http"
- `regex:^ERROR:` - Matches regex pattern
- `mime:code` - Detected as code
- `mime:image` - Detected as image
- `mime:rtf` - Detected as RTF
- `A OR B` - Either condition
- `A AND B` - Both conditions
- `NOT A` - Negate a condition/expression
- `(A OR B) AND C` - Grouped expressions with parentheses

### URL Summarization

`summarize_url` fetches a single HTTP(S) URL from clipboard text, extracts readable text from `text/html` or `text/plain` responses, and summarizes it. The fetch has a 10 second timeout and 2 MB response limit.

Fetching a URL makes a network request to that site even when safe mode is enabled. Safe mode controls LLM provider calls; it does not block URL fetching. Keep `actions.summarize_url` disabled unless that network behavior is acceptable.

### Reliability Controls

- `settings.clipboard_dedupe_window_ms`: suppresses duplicate clipboard text reprocessing within a time window
- `actions.<name>.model`: per-action model override
- `actions.<name>.endpoint`: per-action OpenAI-compatible endpoint override
- `actions.<name>.timeout_ms`: per-action execution timeout override
- `actions.<name>.retry_count`: retry attempts after first failure
- `actions.<name>.retry_backoff_ms`: wait time between retries
- `actions.<name>.cooldown_ms`: minimum interval between action invocations

### Per-Action Model Routing

Actions can use a different model, and optionally a different OpenAI-compatible endpoint, without changing the default provider:

```toml
[actions.classify]
enabled = true
trigger = "length > 0"
model = "llama3.2:1b"

[actions.explain]
enabled = true
trigger = "mime:code"
model = "qwen2.5-coder:14b"
endpoint = "http://localhost:11435/v1"
```

Manual CLI runs use the matching action config when available. Daemon-triggered runs pass the configured override to the CLI for the triggered action. Safe mode evaluates the effective endpoint after overrides, so a remote per-action endpoint is treated as a cloud call.

### Sensitive-Data Guard

`settings.sensitive_guard` detects likely secrets and PII before actions run:

- `warn` (default): notify/warn and continue
- `block`: skip the action unless manual CLI usage includes `--force`
- `off`: disable the guard

Detected inputs are not written to history; history records keep metadata and replace content with a placeholder. Initial detectors cover AWS access keys, API-key assignments, JWTs, private-key headers, and Luhn-valid credit-card numbers.

### Action History

- History is stored locally at `~/.clipboard-ai/history.jsonl`
- `cbai history` shows recent runs (newest first)
- `cbai rerun <id>` replays a previous run with the recorded input and arguments

### Observability

- Agent logs are written by LaunchAgent to:
  - `~/.clipboard-ai/agent.log` (stdout)
  - `~/.clipboard-ai/agent.err` (stderr)
- Use `cbai logs --tail <n>` to view recent entries
- Use `cbai logs --file err --tail <n>` to inspect error logs
- Agent log lines are JSON-structured for easier filtering/parsing

### Custom Plugin Actions

Plugin directory: `~/.clipboard-ai/actions`

Security model: plugin actions run as local code with your full user privileges. Only install plugins from trusted sources, review code before adding it, and keep `~/.clipboard-ai/actions` writable only by your user account.

Supported plugin file extensions:
- `.js`
- `.mjs`
- `.cjs`

Example plugin (`~/.clipboard-ai/actions/reverse.mjs`):

```js
export default {
  id: "reverse",
  aliases: ["rev"],
  description: "Reverse clipboard text",
  inputTypes: ["text"],
  outputTitle: "Reversed",
  run: async ({ text }) => text.split("").reverse().join(""),
};
```

Then run:

```bash
cbai run reverse
cbai run rev
```

### Supported Providers

| Provider | Config | Notes |
|----------|--------|-------|
| Ollama | `type = "ollama"` | Local, no API key needed |
| OpenAI | `type = "openai"` | Requires `api_key` |
| Anthropic | `type = "anthropic"` | Requires `api_key`; uses Anthropic's OpenAI SDK compatibility endpoint |
| Custom | Set `endpoint` | Any OpenAI-compatible API |

Anthropic uses `https://api.anthropic.com/v1/` by default. Configure a Claude model name and API key:

```toml
[provider]
type = "anthropic"
model = "claude-haiku-4-5-20251001"
api_key = "sk-ant-..."
```

Anthropic documents this route as an OpenAI SDK compatibility layer for the Claude API. Some OpenAI SDK fields are ignored or behave differently; use the native Claude API for Anthropic-only features. See Anthropic's compatibility docs: https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk.

## Architecture

```
┌─────────────────────────────────┐
│     macOS Clipboard API         │
└─────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│   Go Daemon (LaunchAgent)       │
│   - Monitors clipboard          │
│   - Evaluates trigger rules     │
│   - Executes actions via CLI    │
│   - Unix socket IPC server      │
│   - Optional local HTTP server  │
└─────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│   TypeScript CLI (cbai)         │
│   - AI action execution         │
│   - User interface              │
│   - OpenAI-compatible client    │
└─────────────────────────────────┘
```

## Project Structure

```
clipboard-ai/
├── agent/                    # Go daemon
│   ├── cmd/clipboard-ai-agent/
│   └── internal/
│       ├── clipboard/        # Clipboard monitoring
│       ├── config/           # TOML config loading
│       ├── executor/         # Action execution (spawns CLI)
│       ├── ipc/              # Unix socket server
│       ├── notify/           # macOS notifications
│       └── rules/            # Trigger engine
├── cli/                      # TypeScript CLI (the only action runtime)
│   └── src/
│       ├── commands/         # CLI commands
│       └── lib/              # IPC client, AI client, safe mode, built-in actions
├── integrations/raycast/     # Raycast extension (HTTP API client)
├── configs/                  # Default configuration
└── scripts/                  # Install/uninstall scripts
```

## Development

### Building

```bash
# Agent (Go)
cd agent
go build ./cmd/clipboard-ai-agent/

# CLI (TypeScript)
cd cli
bun install
bun run build
```

### Running Tests

```bash
# Go rule engine tests
cd agent && go test ./internal/rules/

# TypeScript AI client tests
cd cli && bun test
```

### Running locally

```bash
# Start the agent
./agent/clipboard-ai-agent

# In another terminal, use the CLI
bun run cli/src/index.ts status
```

## CI/CD

GitHub Actions runs on every push and PR to `main`:

- **TypeScript**: install, typecheck, test, build (CLI + Actions)
- **Go**: vet, test, build (agent)

Releases are created automatically when a `v*` tag is pushed, producing macOS agent binaries (amd64 + arm64) and the CLI bundle.

## Uninstalling

```bash
./scripts/uninstall.sh
```

## License

MIT
