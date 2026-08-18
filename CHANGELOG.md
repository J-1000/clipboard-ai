# Changelog

All notable changes to clipboard-ai. README and STATUS are the canonical docs;
PLAN/PRD are historical design notes.

## [Unreleased]

A comprehensive remediation pass (folding in the former `IMPROVEMENT_PLAN.md` and
the agent handoff `FIX_PLAN.md`).

### Showstoppers

- Release binaries no longer crash-loop: the Darwin agent is built on a macOS
  runner with cgo enabled (the clipboard backend requires it), plus a boot smoke
  test guards the startup-panic class.
- Daemon-triggered actions resolve `node`: `install.sh` injects the node dir and
  Homebrew bin into the LaunchAgent PATH, verifies the runtime interpreter, and
  `cbai doctor` checks the daemon PATH can resolve it.

### CI / build

- Restored push/pull-request CI with macOS Go race tests and a pinned
  `govulncheck`, frozen CLI tests/typecheck/build, Raycast lint/build and
  high-threshold dependency audits, plus Swift menubar tests and release build.
- Release installs are frozen, agent binaries are built natively for arm64 and
  x86_64, and tagged builds now package architecture-specific menubar `.app`
  archives with valid Info.plists and shared `SHA256SUMS`.
- Updated Go to 1.26.6 and `golang.org/x/image` to 0.45.0. Updated the CLI to
  OpenAI 6.49 and yargs 18.1 without taking the separate OpenAI 7/Node 22
  migration.
- Updated Raycast API/utilities, React types, and Prettier; locked patched
  brace-expansion and js-yaml dependency paths. The remaining low-severity
  esbuild advisory is upstream in the current Raycast API range.

### Architecture

- Removed the orphaned `actions/` package; `summarize_url` is now a real CLI
  registry action (fetch + extract + summarize) with an SSRF guard.
- Added named provider profiles with per-action selection, ordered fallbacks,
  per-profile/action daily token limits, a local usage ledger, and a
  Unix-socket-only credential handoff.
- Added an MCP v2 stdio server (`cbai mcp`) that discovers registered and
  prompt-template actions and executes tools through the existing local agent.
- Added a native macOS menubar app with quick actions, monitoring controls,
  recent-history detail, replay/copy actions, and an effective settings viewer.

### Security

- `/action` arg flag-injection closed (args separated with `--`; CLI parses
  post-`--` tokens as positional); action name validated before spawning.
- HTTP auth token read from live config (rotation applies on reload) and compared
  in constant time; `http_addr` must be loopback unless `http_allow_remote`.
- `/action` concurrency-limited (429 on overflow).
- Sensitive-data guard expanded (GitHub/Slack/Stripe/Google/GitLab/SSH patterns,
  value-required `api_key`, sliding-window Luhn, RTF scanning) with a shared
  Go/TS parity fixture.
- Added pause/resume/snooze monitoring and frontmost-application allow/deny
  policies. Policy checks run before `NSPasteboard` reads; pause/snooze also
  clear retained clipboard content.
- Automatic text and RTF payloads now use a private, rune-capped stdin envelope
  rather than child process environment variables.

### Agent correctness

- Trigger DSL: `regex:`/`contains:` operands are opaque (support quoting); an
  invalid regex is skipped instead of aborting startup; only enabled actions are
  compiled.
- Clipboard dedupe window now suppresses A→B→A re-copies; graceful shutdown waits
  for in-flight actions, removes the socket, and reloads off the signal loop;
  concurrent action subprocesses are capped (`max_concurrent_actions`).
- Clipboard polling checks `NSPasteboard.changeCount` before decoding content,
  and an empty pasteboard clears the agent's current payload.
- Action errors retain CLI stderr diagnostics, and configured retries now stop
  after deterministic failures while retrying only transient network/service
  conditions.
- Clipboard dedupe, maximum action concurrency, and application policies update
  live on config reload; restart-required settings are reported explicitly.
- Rune-boundary notification truncation; stricter code detection (prose with
  arrows is no longer classified as code); hot-reloadable log level.

### CLI

- caption/ocr no longer lose output on a TTY; `cbai doctor` exits non-zero on
  failure; configurable `max_tokens` with a truncation warning; oversized input
  is capped before the LLM call; JSON mode for classify/extract; atomic,
  lock-guarded history writes; `--json` output, color, `cbai init`, and
  top-level `caption`/`ocr` commands.
- Added `cbai pause`, `cbai resume`, `cbai snooze [minutes]`, and `cbai mcp`.

### Raycast

- Friendly setup-error guidance and request timeouts; fixed the empty-result
  spinner; added Paste / Run Again, history empty-state + detail view, and
  classify/extract/summarize-url commands; README + CHANGELOG.

### Docs / distribution

- Consistent JSON HTTP error bodies and a documented API contract; richer
  uninstall; reconciled README; release checksum + quarantine guidance.
- Corrected the Go prerequisite, invalid-regex and CI status descriptions;
  documented privacy controls, named provider routing, MCP, and the native
  menubar client.
- Marked release installation unavailable until the first public tag/release is
  actually published.
