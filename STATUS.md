# clipboard-ai Status

Last updated: 2026-02-20

## Status Quo

- Platform: macOS only
- Runtime components:
  - Go daemon (`clipboard-ai-agent`)
  - TypeScript CLI (`cbai`)
  - Unix socket IPC (`~/.clipboard-ai/agent.sock`)
- Default provider mode: local Ollama (`http://localhost:11434/v1`)
- Supported providers:
  - `ollama`
  - `openai`
  - custom OpenAI-compatible endpoint via `provider.endpoint`
- Not supported directly: `anthropic` provider type in CLI AI client

## Behavior Notes

- Safe mode:
  - Blocks daemon-triggered cloud calls
  - Prompts for confirmation in manual CLI calls
  - `--yes` bypasses prompt for manual CLI calls
- Trigger rule `length` uses character count (UTF-8 rune-aware), not byte count
- IPC clipboard `length` and status preview truncation are UTF-8 rune-aware
- Invalid poll interval handling:
  - Config validation rejects `settings.poll_interval <= 0`
  - Clipboard monitor also guards against non-positive intervals with a safe default

## Test Health

- `agent`: `go test ./...` passing
- `actions`: `bun test` passing
- `cli`: `bun test` passing

## Recent Fixes

- Provider docs/runtime consistency: removed Anthropic support claims from user docs/config comments
- Poll interval hardening: validation and runtime fallback for invalid values
- Unicode length correctness: rules and IPC length/truncation updated to rune-based behavior
