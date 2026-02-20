# clipboard-ai

[![CI](https://github.com/J-1000/clipboard-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/J-1000/clipboard-ai/actions/workflows/ci.yml)

**AI lookups & summaries triggered directly from your clipboard**

clipboard-ai is a macOS-first lightweight agent that monitors your clipboard and performs real-time transformations using LLMs. Copy text, get AI-powered summaries, explanations, translations—automatically.

## Current Status

- Project status snapshot: see `STATUS.md`
- Provider support: Ollama, OpenAI, and custom OpenAI-compatible endpoints
- Safe mode: blocks daemon-triggered cloud calls and prompts on manual CLI calls (unless `--yes` is used)
- Trigger/clipboard length behavior: character-based (UTF-8 rune-aware), not byte-based

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

# View configuration
cbai config
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

When `safe_mode = true` in config, clipboard content won't be sent to cloud providers (OpenAI or remote custom endpoints) without consent:

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
```

### Trigger Expressions

- `length > 200` - Content longer than 200 characters
- `contains:http` - Contains "http"
- `regex:^ERROR:` - Matches regex pattern
- `mime:code` - Detected as code
- `A OR B` - Either condition
- `A AND B` - Both conditions

### Reliability Controls

- `settings.clipboard_dedupe_window_ms`: suppresses duplicate clipboard text reprocessing within a time window
- `actions.<name>.timeout_ms`: per-action execution timeout override
- `actions.<name>.retry_count`: retry attempts after first failure
- `actions.<name>.retry_backoff_ms`: wait time between retries
- `actions.<name>.cooldown_ms`: minimum interval between action invocations

### Action History

- History is stored locally at `~/.clipboard-ai/history.jsonl`
- `cbai history` shows recent runs (newest first)
- `cbai rerun <id>` replays a previous run with the recorded input and arguments

### Custom Plugin Actions

Plugin directory: `~/.clipboard-ai/actions`

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
| Custom | Set `endpoint` | Any OpenAI-compatible API |

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
├── cli/                      # TypeScript CLI
│   └── src/
│       ├── commands/         # CLI commands
│       └── lib/              # IPC client, AI client, safe mode
├── actions/                  # Built-in AI actions
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
