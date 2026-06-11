# clipboard-ai Status

Last updated: 2026-06-11

## Status Quo

- Platform: macOS only
- Runtime components:
  - Go daemon (`clipboard-ai-agent`)
  - TypeScript CLI (`cbai`)
  - Unix socket IPC (`~/.clipboard-ai/agent.sock`)
  - Optional local HTTP API (`http_enabled`)
- Default provider mode: local Ollama (`http://localhost:11434/v1`)
- Supported providers:
  - `ollama`
  - `openai`
  - `anthropic` via Anthropic's OpenAI SDK compatibility endpoint
  - custom OpenAI-compatible endpoint via `provider.endpoint`

## Behavior Notes

- Safe mode:
  - Blocks daemon-triggered cloud calls
  - Prompts for confirmation in manual CLI calls
  - `--yes` bypasses prompt for manual CLI calls
- Trigger rule `length` uses character count (UTF-8 rune-aware), not byte count
- IPC clipboard `length` and status preview truncation are UTF-8 rune-aware
- Clipboard types supported: text, RTF, image
- Image actions available: `caption`, `ocr` (requires vision-capable models)
- Invalid poll interval handling:
  - Config validation rejects `settings.poll_interval <= 0`
  - Clipboard monitor also guards against non-positive intervals with a safe default
- Reliability controls:
  - `settings.clipboard_dedupe_window_ms` suppresses duplicate clipboard events inside a window
  - Per-action controls: `timeout_ms`, `retry_count`, `retry_backoff_ms`, `cooldown_ms`
  - Per-action model routing: `actions.<name>.model` and `actions.<name>.endpoint`
- Local HTTP API:
  - Enabled via `settings.http_enabled`
  - Address via `settings.http_addr`
  - Auth token via `settings.http_auth_token`
- Config hot reload:
  - `~/.clipboard-ai/config.toml` is watched and valid provider/action/rule changes are applied without restart
  - Invalid reloads are rejected while the previous config remains active
  - `SIGHUP` triggers a manual reload
  - `settings.http_enabled`, `settings.http_addr`, and `settings.poll_interval` changes are logged as restart-required
- Action history:
  - Runs are persisted to `~/.clipboard-ai/history.jsonl`
  - Retention controls: `history_enabled`, `history_max_entries`, `history_truncate_chars`
  - CLI supports `cbai history`, `cbai history --clear`, `cbai history --before <ISO date>`, and `cbai rerun <id>`
- Security hardening:
  - macOS notification text is passed to AppleScript via argv
  - `/config` redacts provider API keys and HTTP auth tokens
  - `/action` request bodies are capped at 10 MB
  - Oversized clipboard images are omitted from `/clipboard` with truncation metadata
  - IPC socket directory/socket permissions are enforced at startup
  - Plugin actions are documented as trusted local code
- Robustness hardening:
  - CLI IPC requests time out after 10 seconds by default (`CBAI_IPC_TIMEOUT_MS` override)
  - History reading skips corrupt JSONL lines with a single warning
  - AI provider responses with no completion choices produce a descriptive error
  - The first RTF clipboard read failure is logged once per agent process
- Code quality:
  - Built-in action execution in `actions/` uses a shared `executeAIAction` helper
  - `actions/` and `cli/` action type contracts document their package boundary
  - Regex triggers are compiled when the rules engine is created and invalid regexes fail startup
- Feature work:
  - Sensitive-data guard scans likely secrets/PII before actions and suppresses history content when it fires
  - Manual CLI actions can stream generation output on TTY when output is not being copied
  - `summarize_url` builtin can fetch and summarize a single HTTP(S) URL
  - `cbai actions` lists registered actions and configured trigger state
  - `cbai doctor` runs local diagnostics, including vision-model guidance for caption/OCR
  - `anthropic` provider type routes through Anthropic's OpenAI SDK compatibility endpoint
  - Per-action model/endpoint overrides route selected actions to different OpenAI-compatible models
  - Config hot reload applies valid provider/action/rule changes without restarting the agent

## Test Health

- `agent`: `go test ./...` passing
- `actions`: `bun test` passing
- `cli`: `bun test` currently failing in existing client/AI command test areas and Bun module-mock isolation; focused tests for changed areas pass

## Recent Fixes

- Phase 4 feature work: sensitive-data guard, streaming CLI output, `summarize_url`, `cbai actions`, `cbai doctor`, Anthropic provider support, per-action model routing, and config hot reload
- Phase 3 code quality fixes: shared builtin action execution helper, documented action type boundary, and precompiled trigger regex validation
- Phase 2 robustness fixes: CLI IPC timeout, corrupt history-line tolerance, defensive empty-choice AI response handling, and one-time RTF read failure logging
- Phase 1 security fixes: notification AppleScript injection prevention, `/config` secret redaction, history retention/privacy controls, IPC size limits/socket permissions, and plugin trust-model docs
- Provider docs/runtime consistency: Anthropic provider support now matches user docs/config comments
- Poll interval hardening: validation and runtime fallback for invalid values
- Unicode length correctness: rules and IPC length/truncation updated to rune-based behavior
- Local HTTP API docs: added endpoint/auth reference and cURL examples in `docs/http-api.md`
- Integration examples: added Raycast/Alfred/editor snippets in `docs/integrations/local-http-clients.md`
- HTTP API helper env/script: added `.env.example` and `scripts/examples/http-action.sh`
- IPC auth contract tests: added coverage for Bearer, `X-API-Key`, `X-Clipboard-AI-Token`, and unauthorized cases
