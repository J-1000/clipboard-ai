# clipboard-ai

**AI lookups & summaries triggered directly from your clipboard**

clipboard-ai is a macOS-first lightweight agent that monitors your clipboard and performs real-time transformations using LLMs. Copy text, get AI-powered summaries, explanations, translations—automatically.

## Current Status

- Project status snapshot: see `STATUS.md`
- Provider support: Ollama, OpenAI, Anthropic, and custom OpenAI-compatible endpoints
- Safe mode: blocks daemon-triggered cloud calls and prompts on manual CLI calls (unless `--yes` is used)
- Trigger/clipboard length behavior: character-based (UTF-8 rune-aware), not byte-based
- Clipboard types: text, RTF, images (image actions require vision-capable models)
- Local HTTP API: optional authenticated localhost server for integrations
- Native menubar client: history, result replay/copy, quick actions, monitoring
  controls, and a read-only settings view on macOS 14+
- MCP: `cbai mcp` exposes registered actions as tools over stdio

## Features

- **Automatic triggers**: Configure rules to run AI actions when clipboard content matches patterns
- **CLI-first**: Full-featured command-line interface (`cbai`)
- **Local LLM support**: Works with Ollama out of the box, no API keys required
- **Privacy-focused**: Safe mode blocks cloud calls without explicit approval
- **Private monitoring controls**: Pause, resume, snooze, or exclude foreground
  applications before their clipboard content is read
- **Provider routing**: Select named provider profiles per action, with ordered
  fallbacks and daily token budgets
- **Native menubar workflow**: Run common actions and inspect recent results
  without leaving the current application
- **Extensible**: Add custom actions as a prompt in `config.toml`, or as
  JavaScript plugin modules (`.js`, `.mjs`, `.cjs`)

## Quick Start

### Prerequisites

- macOS 12+ for the agent and CLI; macOS 14+ for the native menubar app
- [Go 1.26.11](https://go.dev/dl/) (for building the agent)
- Swift 6 / Xcode 16 (only when building the native menubar app)
- [Bun](https://bun.sh/) — required to **build** the CLI (the build uses
  `bun build`). [Node.js](https://nodejs.org/) 22 or newer is required at
  **runtime** (the installed `cbai` is a `#!/usr/bin/env node` script).
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

1. Stop before changing anything if Go or Bun is missing
2. Create `~/.clipboard-ai` and a default configuration, both readable only by
   your user
3. Build and install the Go daemon (creating the install directory if needed)
4. Build the CLI from the lockfile and install it
5. Set up the LaunchAgent for auto-start, with a `PATH` that can find `node`

Binaries go to `/usr/local/bin` by default, using `sudo`. Set `INSTALL_DIR` to
install somewhere else.

The native menubar app is built separately; see [Native menubar app](docs/menubar.md).

### Manual Installation

```bash
# Build the agent
cd agent
go build -o clipboard-ai-agent ./cmd/clipboard-ai-agent/
sudo cp clipboard-ai-agent /usr/local/bin/

# Build the CLI
cd ../cli
bun install --frozen-lockfile
bun run build
sudo cp dist/index.js /usr/local/bin/cbai
chmod +x /usr/local/bin/cbai
```

### Release installation (not yet available)

This repository does not currently have a published GitHub Release, so the
source installation above is the supported path today. Do not run
`install-from-release.sh` until a release appears on the
[releases page](https://github.com/J-1000/clipboard-ai/releases).

When the first `v*` tag is published, the release workflow is configured to
produce host-architecture agent binaries, the Node.js CLI bundle, native
menubar `.app` archives for Apple Silicon and Intel Macs, and `SHA256SUMS`.
At that point, the agent and CLI can be installed with:

```bash
./scripts/install-from-release.sh           # latest release
./scripts/install-from-release.sh v1.2.3    # a specific tag
```

Node.js must be installed for triggered actions to run.

### Release binaries and Gatekeeper

The configured release artifacts are **not codesigned or notarized**, so macOS
Gatekeeper will quarantine them. After a release is published and an agent
binary is downloaded:

```bash
# Verify the download against the published checksums
shasum -a 256 -c SHA256SUMS

# Clear the quarantine attribute so it can run
xattr -d com.apple.quarantine ./clipboard-ai-agent-darwin-arm64
```

Building from source (the installer above) avoids quarantine entirely.

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

# Show usage statistics (runs, errors, token totals per action)
cbai stats

# Scaffold a config file on first run (optionally open it in $EDITOR)
cbai init
cbai init --edit

# Replay a previous run
cbai rerun <run-id>

# Show recent agent logs (tail)
cbai logs --tail 100

# View configuration
cbai config

# Pause, resume, or temporarily snooze automatic monitoring
cbai pause
cbai resume
cbai snooze            # configured default duration
cbai snooze 30         # minutes

# List registered actions
cbai actions

# Run diagnostics
cbai doctor

# Expose registered actions as MCP tools over stdio
cbai mcp
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

# Optional named profiles have independent endpoints, credentials, models,
# fallback chains, and token budgets. The [provider] table is named "default".
[providers.cloud]
type = "openai"
endpoint = "https://api.openai.com/v1"
model = "gpt-5-mini"
api_key = "sk-..."
fallbacks = ["default"]
daily_token_limit = 50000

[settings]
poll_interval = 150
safe_mode = true
notifications = true
clipboard_dedupe_window_ms = 1000
http_enabled = false
http_addr = "127.0.0.1:9159"
# http_auth_token = "set-a-long-random-token"
sensitive_guard = "warn"
history_enabled = true
history_max_entries = 1000
history_truncate_chars = 2000
max_concurrent_actions = 4
max_tokens = 1024

[privacy]
start_paused = false
default_snooze_minutes = 15
# Bundle identifiers or display names; the denylist always wins.
app_allowlist = []
app_denylist = ["1Password", "com.example.BankingApp"]
# Skip entries that password managers mark as concealed or transient.
skip_concealed = true

[actions.summarize]
enabled = true
trigger = "length > 200"
provider_profile = "cloud"
fallback_profiles = ["default"]
daily_token_limit = 10000
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

The agent watches `~/.clipboard-ai/config.toml` and reloads valid changes without
restart. Provider settings, action definitions, trigger rules, safe mode,
notifications, logging level, sensitive guard, history settings, per-action
routing, clipboard dedupe, action concurrency, the default snooze duration, and
application allow/deny lists are applied after reload.

Invalid TOML, invalid settings, or invalid trigger regexes are rejected; the agent keeps the last valid config and sends a notification when notifications are enabled. Send `SIGHUP` to `clipboard-ai-agent` to force a reload manually.

Keys that no setting uses (usually typos such as `safemode`) do not make the config invalid; the agent logs `unknown config key ignored` for each one at startup and on reload. Check `cbai logs` after editing.

Changes to `settings.http_enabled`, `settings.http_addr`, and
`settings.poll_interval` are logged as restart-required because the HTTP server
and clipboard poller are created at startup. `privacy.start_paused` is also a
startup default; use `cbai pause` or `cbai resume` to change the live state.

### Monitoring Privacy Controls

- `cbai pause` stops automatic monitoring until it is resumed.
- `cbai snooze [minutes]` stops monitoring temporarily. Omitting the duration
  uses `privacy.default_snooze_minutes`.
- A non-empty `privacy.app_allowlist` permits clipboard reads only while one of
  those applications is frontmost. `privacy.app_denylist` always wins.
- Applications may be identified by display name or bundle identifier. A
  blocked clipboard payload is never read into the agent, and pausing or
  snoozing clears the agent's retained clipboard value.
- Entries that the source application marks as concealed, transient, or
  auto-generated (the [nspasteboard.org](https://nspasteboard.org) convention
  used by password managers) are skipped without reading their content. Set
  `privacy.skip_concealed = false` to turn that off.
- These controls apply to automatic monitoring. A manual action (`cbai
  <action>`, a menubar quick action, a Raycast command) reads the clipboard at
  the moment you run it, also while monitoring is paused or snoozed.
- Content that is already on the clipboard when the agent starts is not
  treated as a new copy and does not trigger actions.

### Local HTTP API

When `settings.http_enabled = true`, the agent also exposes a localhost HTTP API.

- Full endpoint reference: `docs/http-api.md`
- Integration snippets (Raycast, Alfred, editor shell): `docs/integrations/local-http-clients.md`
- Example script: `scripts/examples/http-action.sh`
- Raycast extension: `integrations/raycast/` includes setup, summary, explain,
  translate, history, classify, extract, and URL-summary commands.
- Native menubar app: see `docs/menubar.md` for source builds and behavior.
- MCP server: see `docs/mcp.md` for client configuration and tool semantics.

### Diagnostics

- `cbai actions` lists built-in and plugin actions with aliases, descriptions, enabled state, and configured triggers.
- `cbai doctor` checks daemon reachability, daemon/CLI version match, provider reachability, Ollama model availability, image-action model guidance, history file size, and plugin directory state.
- If image actions are enabled and model vision support cannot be recognized, doctor reports `unknown — caption/ocr may fail`.

### Trigger Expressions

- `length > 200` - Content longer than 200 characters
- `length >= 200`, `length <= 200`, `length != 0` - Extended comparisons
- `length == 200` (or `length = 200`) - Exactly 200 characters
- `contains:http` - Contains "http"
- `regex:^ERROR:` - Matches regex pattern
- `mime:code` - Detected as code
- `mime:image` - Detected as image
- `mime:rtf` - Detected as RTF
- `mime:url` - A single URL
- `mime:text` - Plain prose (not code, not a URL)
- `A OR B` - Either condition
- `A AND B` - Both conditions
- `NOT A` - Negate a condition/expression
- `(A OR B) AND C` - Grouped expressions with parentheses

Styled text is reported as `rtf`, and its plain text is classified as well, so
`mime:code`, `mime:url`, and `mime:text` also match content copied from
applications that put rich text on the clipboard.

**Quoting `regex:`/`contains:` operands.** Their operands are opaque, but an
unquoted operand still stops at a `)` or an `AND`/`OR` keyword. If your pattern
or substring contains those characters, **quote it** so it isn't split as DSL
structure:

- `regex:"(https?)://\S+"` - capture groups / alternation work when quoted
- `contains:"foo AND bar"` - matches the literal phrase, not `foo` AND `bar`
- `regex:")"` - a literal close-paren

An invalid `regex:` pattern is logged and that action is skipped — it no longer
prevents the daemon from starting.

### URL Summarization

`summarize_url` fetches a single HTTP(S) URL from clipboard text, extracts readable text from `text/html` or `text/plain` responses, and summarizes it. The fetch has a 10 second timeout and 2 MB response limit.

Fetching a URL makes a network request to that site even when safe mode is enabled. Safe mode controls LLM provider calls; it does not block URL fetching. Keep `actions.summarize_url` disabled unless that network behavior is acceptable.

### Reliability Controls

- `settings.clipboard_dedupe_window_ms`: suppresses duplicate clipboard text reprocessing within a time window
- `actions.<name>.model`: per-action model override
- `actions.<name>.endpoint`: per-action OpenAI-compatible endpoint override
- `actions.<name>.timeout_ms`: per-action execution timeout override, for
  automatic triggers and for runs requested through the agent
- `actions.<name>.retry_count`: retry attempts after first failure
- `actions.<name>.retry_backoff_ms`: wait time between retries
- `actions.<name>.cooldown_ms`: minimum interval between action invocations
- `settings.max_concurrent_actions`: live limit for automatic action subprocesses

Retries are attempted only for transient failures such as timeouts, connection
failures, rate limits, and temporary 5xx responses. Authentication,
configuration, sensitive-data, and safe-mode failures are not retried.

### Provider Profiles and Per-Action Routing

Named profiles can keep separate provider types, models, endpoints, API keys,
fallback chains, and daily token limits. Select a profile for an action with
`provider_profile`; `fallback_profiles` overrides that profile's own fallback
chain for the action:

```toml
[providers.fast]
type = "openai"
endpoint = "https://api.openai.com/v1"
model = "gpt-5-mini"
api_key = "sk-..."
fallbacks = ["local"]
daily_token_limit = 50000

[providers.local]
type = "ollama"
endpoint = "http://localhost:11434/v1"
model = "mistral"

[actions.classify]
enabled = true
trigger = "length > 0"
provider_profile = "fast"
fallback_profiles = ["local"]
daily_token_limit = 10000
```

The reserved profile name `default` refers to `[provider]`. Fallbacks are tried
in order, and failures report diagnostics for each attempted profile. Usage is
recorded in `~/.clipboard-ai/usage.jsonl` by UTC day when any limit is enabled;
profile and action limits are checked before each call. Limits depend on token
usage reported by the provider.

The older per-action `model` and `endpoint` settings remain supported. Safe mode
evaluates the effective profile endpoint, so remote profiles are cloud calls.

### Sensitive-Data Guard

`settings.sensitive_guard` detects likely secrets and PII before actions run:

- `warn` (default): notify/warn and continue
- `block`: skip the action unless manual CLI usage includes `--force`
- `off`: disable the guard

Detected inputs are not written to history; history records keep metadata and replace content with a placeholder. Warnings name what was found, for example `(password, url_credentials)`.

Detectors cover AWS access and secret keys, OpenAI and Anthropic keys, GitHub, GitLab, Slack, Stripe, Google, and npm tokens, generic `api_key` and `password` assignments, bearer tokens, JWTs, URLs with embedded credentials, private-key headers, and credit-card numbers (card layout, issuer prefix, and Luhn checksum).

### Action History

- History is stored locally at `~/.clipboard-ai/history.jsonl`
- `cbai history` shows recent runs (newest first)
- `cbai rerun <id>` replays a previous run with the recorded input and arguments
- Records persist token usage (`prompt_tokens`/`completion_tokens`) and latency when the provider reports them

### Usage Statistics

`cbai stats` aggregates the action history into per-action totals — runs, errors,
prompt/completion token usage, and average latency:

```bash
cbai stats          # human-readable summary
cbai stats --json   # machine-readable totals and per-action breakdown
```

### Observability

- Agent logs are written by LaunchAgent to:
  - `~/.clipboard-ai/agent.log` (stdout)
  - `~/.clipboard-ai/agent.err` (stderr)
- Use `cbai logs --tail <n>` to view recent entries
- Use `cbai logs --file err --tail <n>` to inspect error logs
- Agent log lines are JSON-structured for easier filtering/parsing

### Custom Prompt Actions (no code)

Define a custom action right in `config.toml` with a `prompt` string — no JS
plugin required:

```toml
[actions.shout]
enabled = false
trigger = ""
prompt = "Rewrite the following in ALL CAPS:\n\n{{input}}"
```

`{{input}}` is the clipboard text and `{{args}}` are CLI arguments; if neither
placeholder appears, the clipboard text is appended after the prompt. Run it
with `cbai run shout` (or give it a `trigger` to fire automatically).

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

Plugin actions are also available by their id through the HTTP API and MCP;
no `[actions.*]` config entry is needed.

### Supported Providers

| Provider | Config | Notes |
|----------|--------|-------|
| Ollama | `type = "ollama"` | Local, no API key needed |
| OpenAI | `type = "openai"` | Requires `api_key`; requests send `max_completion_tokens` and the default temperature |
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
macOS Clipboard API
        │
        ▼
Go daemon / LaunchAgent
  ├── private Unix socket ──► CLI ──► LLM providers
  │                          └──────► MCP stdio host
  ├── private Unix socket ──► native menubar app
  └── optional auth HTTP ───► Raycast / local integrations
```

## Project Structure

```
clipboard-ai/
├── agent/                    # Go daemon
│   ├── cmd/clipboard-ai-agent/
│   └── internal/
│       ├── automation/       # Dedupe, cooldowns, concurrency
│       ├── clipboard/        # Clipboard monitoring
│       ├── config/           # TOML config loading
│       ├── executor/         # Action execution (spawns CLI)
│       ├── guard/            # Sensitive-data detection
│       ├── ipc/              # Unix socket and HTTP servers
│       ├── notify/           # macOS notifications
│       ├── privacy/          # Pause, snooze, application policy
│       └── rules/            # Trigger engine
├── cli/                      # TypeScript CLI (the only action runtime)
│   └── src/
│       ├── commands/         # CLI commands
│       ├── lib/              # IPC client, AI client, safe mode, built-in actions
│       └── mcp/              # MCP stdio server
├── menubar/                  # Native SwiftUI status-item client
├── integrations/raycast/     # Raycast extension (HTTP API client)
├── configs/                  # Default configuration
├── docs/                     # HTTP, MCP, menubar, integration, and security docs
└── scripts/                  # Install/uninstall scripts, end-to-end contract check
```

## Development

### Building

```bash
# Agent (Go)
cd agent
go build ./cmd/clipboard-ai-agent/

# CLI (TypeScript)
cd cli
bun install --frozen-lockfile
bun run build

# Native menubar app (macOS 14+)
cd ../menubar
swift build -c release
```

### Running Tests

```bash
# Go agent: formatting, vet, race test, and reachable-vulnerability scan
cd agent
test -z "$(gofmt -l .)"
go vet ./...
go test -race ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...

# CLI: frozen install, full test suite, typecheck, and build
cd ../cli
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build

# Raycast extension: lint/build and high-severity audit gates
cd ../integrations/raycast
npm ci
npm run lint
npm run build
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high

# Native menubar app
cd ../../menubar
swift test
swift build -c release

# Agent and CLI together (builds both, uses an isolated HOME and a stub provider)
cd ..
./scripts/e2e-contract.sh
```

### Running locally

```bash
# Start the agent
./agent/clipboard-ai-agent

# In another terminal, use the CLI
bun run cli/src/index.ts status
```

## CI/CD

`.github/workflows/ci.yml` runs on every push and pull request. It executes the
Go race/vulnerability checks, CLI tests/typecheck/build, Raycast lint/build and
audit gates, and native menubar tests/release build.

A GitHub Actions **release** workflow (`.github/workflows/release.yml`) runs when
a `v*` tag is pushed, producing macOS agent binaries (amd64 + arm64, built with
cgo on a macOS runner, guarded by a boot smoke test), the CLI bundle, native
menubar `.app` archives for both architectures, and `SHA256SUMS`. No tag or
release is currently published.

## Uninstalling

```bash
./scripts/uninstall.sh
```

## License

MIT
