# clipboard-ai Status

Last updated: 2026-08-18

## Status Quo

- Platform: macOS; agent/CLI support macOS 12+, native menubar app requires
  macOS 14+
- Runtime components:
  - Go 1.26.6 daemon (`clipboard-ai-agent`)
  - TypeScript/Node.js CLI (`cbai`)
  - Private Unix socket IPC (`~/.clipboard-ai/agent.sock`)
  - Optional authenticated local HTTP API (`http_enabled`)
  - Native SwiftUI menubar app
  - MCP stdio server (`cbai mcp`)
  - Raycast extension (`integrations/raycast/`)
- Default provider: local Ollama (`http://localhost:11434/v1`)
- Supported providers: Ollama, OpenAI, Anthropic through its OpenAI SDK
  compatibility endpoint, and custom OpenAI-compatible endpoints

## Implemented Behavior

### Clipboard and execution

- `NSPasteboard.changeCount` gates clipboard decoding, so unchanged text, RTF,
  and images are not reread and rehashed every poll. Empty clipboard changes
  clear the retained value.
- Trigger length, IPC length, truncation, and the 100,000-character subprocess
  input cap are Unicode-rune-aware.
- Automatic text and RTF inputs use a capped private stdin envelope rather than
  child environment variables. Image execution uses a temporary file.
- CLI diagnostics are preserved through the agent and `/action`, including
  safe-mode, provider, authentication, and configuration failures.
- Automatic retries are limited to transient timeouts, connection failures,
  rate limits, and temporary HTTP failures. Deterministic failures are not
  retried.
- Dedupe window, action concurrency, application policies, provider/action
  routing, log level, safe mode, sensitive guard, and history settings apply on
  hot reload. HTTP enable/address and polling interval remain restart-required.
- Invalid reloads keep the last valid configuration. Invalid trigger regexes
  are logged and their action is skipped rather than preventing startup.

### Privacy and routing

- Safe mode blocks daemon-triggered cloud calls, prompts for manual CLI calls,
  and treats local providers as allowed.
- Monitoring can be paused, resumed, or snoozed through `cbai`, the menubar app,
  or `/controls`. Pause and snooze clear the retained clipboard value.
- Frontmost-application allow/deny lists are evaluated before the clipboard is
  read. Entries accept display names or bundle identifiers; deny rules win.
- Named provider profiles support independent type, endpoint, model, API key,
  ordered fallbacks, and daily token limits. Actions can select and override
  fallback profiles and set their own daily limit.
- Usage-limit accounting is stored locally in `~/.clipboard-ai/usage.jsonl`.
  The private `/provider-chain` endpoint is available only over the mode-0600
  Unix socket; public `/config` responses redact every credential.

### Clients and integrations

- The native menubar app shows live monitoring state, quick actions, the newest
  50 history records, replay/copy controls, and a read-only effective settings
  view. It talks directly to the Unix socket and honors Reduce Motion and
  VoiceOver semantics.
- `cbai mcp` discovers built-in, plugin, and configured prompt actions and
  exposes them as MCP v2 tools over stdio. Tool calls use the agent, so existing
  safe-mode, guard, routing, limits, and history behavior remains authoritative.
- The Raycast extension includes setup, summary, explain, translate, history,
  classify, extract, and URL-summary commands.
- The authenticated HTTP API exposes status, clipboard, redacted config,
  actions, history, and monitoring controls. Every response carries
  `X-API-Version: 1`.

## CI and Test Health

Pushes and pull requests run all of the following:

- Agent: `go test -race ./...` and pinned `govulncheck`; the current scan reports
  zero reachable vulnerabilities.
- CLI: frozen Bun install, full tests, type-check, and production build.
- Raycast: frozen npm install, lint, build, production audit, and full audit at
  high-severity threshold. A low-severity esbuild development-server advisory
  remains in the current upstream Raycast dependency range.
- Menubar: Swift tests, including a real Unix-socket round trip and HTTP parser
  cases, plus a release build.

Tagged release automation uses frozen installs, builds native arm64 and x86_64
agent and menubar artifacts, packages valid `.app` bundles, smoke-tests the
native agent, and publishes SHA-256 checksums.

## Distribution Status

No Git tag or public GitHub Release exists as of this status update. Source
installation is therefore the supported installation path. The release
workflow is ready for a first `v*` tag, but its artifacts are not yet signed or
notarized.

## Remaining Optional Work

- Replace the per-trigger Node.js process with a persistent worker or move LLM
  calls into the daemon for lower automatic-action latency.
- Generate shared configuration types from one schema instead of maintaining
  Go and TypeScript representations manually.
- Introduce cross-platform notification and rich-clipboard seams before any
  Linux or Windows port.
- Codesign and notarize release artifacts before treating release installation
  as the default path.
