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

- CI restored to green: added `bun-types`, fixed type/lint errors, eliminated
  cross-file test-mock leakage (dependency injection), and run the Go job on
  macOS. Added golangci-lint, a Raycast lint/typecheck job, race-enabled Go
  tests, a Go version matrix, `go.sum` caching, `SHA256SUMS` on releases, and
  build-time version stamping (ldflags / `--define`).

### Architecture

- Removed the orphaned `actions/` package; `summarize_url` is now a real CLI
  registry action (fetch + extract + summarize) with an SSRF guard.

### Security

- `/action` arg flag-injection closed (args separated with `--`; CLI parses
  post-`--` tokens as positional); action name validated before spawning.
- HTTP auth token read from live config (rotation applies on reload) and compared
  in constant time; `http_addr` must be loopback unless `http_allow_remote`.
- `/action` concurrency-limited (429 on overflow).
- Sensitive-data guard expanded (GitHub/Slack/Stripe/Google/GitLab/SSH patterns,
  value-required `api_key`, sliding-window Luhn, RTF scanning) with a shared
  Go/TS parity fixture.

### Agent correctness

- Trigger DSL: `regex:`/`contains:` operands are opaque (support quoting); an
  invalid regex is skipped instead of aborting startup; only enabled actions are
  compiled.
- Clipboard dedupe window now suppresses A→B→A re-copies; graceful shutdown waits
  for in-flight actions, removes the socket, and reloads off the signal loop;
  concurrent action subprocesses are capped (`max_concurrent_actions`).
- Rune-boundary notification truncation; stricter code detection (prose with
  arrows is no longer classified as code); hot-reloadable log level.

### CLI

- caption/ocr no longer lose output on a TTY; `cbai doctor` exits non-zero on
  failure; configurable `max_tokens` with a truncation warning; oversized input
  is capped before the LLM call; JSON mode for classify/extract; atomic,
  lock-guarded history writes; `--json` output, color, `cbai init`, and
  top-level `caption`/`ocr` commands.

### Raycast

- Friendly setup-error guidance and request timeouts; fixed the empty-result
  spinner; added Paste / Run Again, history empty-state + detail view, and
  classify/extract/summarize-url commands; README + CHANGELOG.

### Docs / distribution

- Consistent JSON HTTP error bodies and a documented API contract; richer
  uninstall; reconciled README; release checksum + quarantine guidance.
