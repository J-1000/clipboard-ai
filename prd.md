# PRD — clipboard-ai

**AI lookups & summaries triggered directly from your clipboard**

## 1. Project Overview

clipboard-ai is a macOS-first lightweight agent that monitors your clipboard and performs real-time transformations using LLMs. It is a hybrid of:

- a macOS menubar app (optional)
- a Go background agent (LaunchAgent)
- a TypeScript CLI
- an optional API server for integrations

The tool runs locally, respects privacy, and triggers AI actions automatically when clipboard changes occur (or when manually invoked via CLI).

## 2. Problem Statement

Users constantly copy text from:

- emails
- PDFs
- documentation
- chat messages
- logs
- code
- URLs

…but then need to manually:

- summarize it
- rewrite it
- extract key points
- classify it
- translate it
- run calculations
- run code explanations
- detect sensitive data

This requires switching contexts, opening a browser or chat AI tool, and pasting manually.

**clipboard-ai removes that friction.**

## 3. Target Users

### Primary

- Developers
- Knowledge workers
- Students/writers/researchers
- macOS power users
- Terminal-focused users

### Secondary

- Support agents
- Analysts
- QA/debugging engineers

These users value automation, speed, and privacy.

## 4. Product Goals

### P0 Goals (must-have for v1)

- Detect clipboard changes in real time
- Run AI tasks automatically or manually via CLI
- No UI required — CLI-only experience must be excellent
- Support local OpenAI-compatible LLM endpoints
- Provide safe-mode that avoids sending clipboard to cloud unless approved
- Configurable actions + patterns
- MacOS only (v1)

### P1 Goals (nice-to-have for v1.1)

- Menubar app with settings + history
- Custom workflows / plugins
- Web dashboard for logs and actions

### P2 Goals (v2)

- Sync profiles across devices
- Integration with Alfred, Raycast, and Vim/VSCode via extensions

## 5. Key Features (v1)

### 1. Clipboard watcher (Go)

- Lightweight daemon using macOS APIs
- Detects text, images, RTF, URLs

### 2. Rule-based triggers

Triggered when clipboard matches patterns:

```yaml
if clipboard.includes("http"):
  run: summarize_url
```

Patterns accepted:

- substring match
- regex
- mime type
- content length

### 3. AI actions (TS or Go plugins)

Predefined built-ins:

- `summarize`
- `tl;dr`
- `explain` (good for code)
- `translate`
- `classify`
- `improve writing`
- `extract data`

### 4. CLI: `cbai`

```bash
cbai status              # agent status
cbai clipboard           # current clipboard content
cbai summary [--copy]    # summarize clipboard
cbai explain [--copy]    # explain (great for code)
cbai translate <lang> [--copy]  # translate to language
cbai improve [--copy]    # improve writing
cbai extract [--copy]    # extract structured data
cbai tldr [--copy]       # ultra-brief summary
cbai classify [--copy]   # classify content type
cbai config              # view configuration

# Global flags
--copy, -c               # copy result to clipboard
--yes, -y                # skip safe mode confirmation prompts
```

### 5. Safe mode

Block outgoing calls to cloud providers without explicit user confirmation.

- **Daemon-triggered**: Blocks cloud calls entirely, sends macOS notification
- **Manual CLI**: Shows interactive confirmation prompt before cloud calls
- **`--yes` flag**: Skips confirmation prompt
- **Local providers**: Always allowed (Ollama, localhost endpoints)

## 6. Non-Goals (v1)

- No Windows/Linux
- No editing the clipboard (only reading)
- No multi-user or sync
- No fine-tuning

## 7. Competitive Landscape

- **Raycast** (requires cloud + manual action)
- **PastePal / Pastebot** (no AI-based logic)
- **Menubar GPT apps** (not clipboard-integrated)

**clipboard-ai's advantage:**

- fully open-source
- local LLM support
- automatic triggers
- CLI-first (senior dev signal)

## 8. Success Metrics

### Quantitative

- GitHub stars: 300+ in 3 months
- < 10MB RAM usage idle
- < 100ms detection time
- < 1s latency for local models

### Qualitative

- Developers report reduced friction in daily workflows
- PRs adding custom actions/plugins

## 9. System Architecture

```
+------------------------------+
|     macOS Clipboard API      |
+------------------------------+
                |
                v
+--------------------------------------+
|   Go Daemon (clipboard-ai-agent)     |
| - monitors clipboard                 |
| - applies rules                      |
| - calls TS/Go actions                |
+--------------------------------------+
                |
                v
+------------------------------+
| AI Action Router (TS/Go)    |
| - OpenAI API                |
| - Local LLMs (Ollama)       |
| - Custom endpoints          |
+------------------------------+
                |
                v
+------------------------------+
|  CLI (TypeScript / bun)     |
|  cbai summary               |
|  cbai config                |
+------------------------------+
```

### Configuration file

```toml
[provider]
type="ollama"
model="mistral"

[actions.summarize]
trigger="length > 200"

[actions.explain]
trigger="mime=text/code"
```

## 10. Technical Design

### Languages

- **Go** → daemon (macOS LaunchAgent)
- **TypeScript** → CLI + action library
- **Optional Next.js** → settings dashboard (v1.1)

### Clipboard Monitoring (macOS)

Use:

- `NSPasteboard`
- polling or event-based

### Action Handlers

Each action is a standalone function:

```typescript
export async function summarize(text) {
  return aiClient.generate({
    model: config.model,
    prompt: `Summarize this: ${text}`
  });
}
```

### Plugin Interface (future)

Actions can be dropped into a directory and auto-registered:

```typescript
export const metadata = {
  id: "my_custom_action",
  triggers: ["http"],
};
```

## 11. User Experience (v1)

### Typical workflow:

1. User copies a long Slack message.
2. clipboard-ai detects message > 250 chars.
3. `summarize` rule triggers.
4. Result appears as macOS notification or printed by CLI.

## 12. Security Considerations

- Default: local LLM only
- User must enable cloud providers
- Do not log clipboard content unless explicit flag
- Private mode: No content leaves machine

## 13. Risks & Mitigation

| Risk | Mitigation |
|------|------------|
| High CPU usage if polling | Use event-driven APIs when possible |
| Users scared of "clipboard app = spyware" | Open-source + local-first + safe-mode |
| LLM latency too slow | Cache + use small models for quick tasks |
| Clipboard contents are binary | Filter non-text formats |

## 14. Roadmap

### v1.0 (Launch)

- Go daemon with automatic action execution
- TS CLI (`cbai`) with `--copy` flag on all AI commands
- Rules + triggers (length, contains, regex, mime, AND/OR)
- Built-in actions: summarize, explain, translate, improve, extract, tldr, classify
- Local LLM via Ollama
- macOS notifications on action completion
- Config system (TOML)
- Test suites (Go rule engine, Bun AI client)

### v1.1

- Menubar app (Swift/TS bridge or Electron Lite)
- History viewer
- Web dashboard

### v2

- Raycast extension
- VS Code extension
- Plugin ecosystem
- Multi-model routing
- Sync via iCloud

## 14.1 Next Implementation Priorities

1. Custom actions/plugins
   - Add filesystem plugin discovery from `~/.clipboard-ai/actions` so users can add actions without editing core code.
2. Unified action execution path
   - Route built-ins and future plugins through one `cbai run <action>` pipeline to avoid duplicated safe mode/input/output logic.
3. Action history + replay
   - Persist action runs (timestamp, trigger, model, latency, status) and add `cbai history` / `cbai rerun <id>`.
4. Trigger DSL v2
   - Expand parser support to include `NOT`, parentheses, and comparison operators like `>=`, `<=`, `!=`.
5. Reliability controls
   - Add per-action timeout/retry/backoff plus clipboard dedupe/cooldown controls.
6. Observability
   - Add structured logs and `cbai logs --tail`.
7. Clipboard type expansion
   - Extend from text-only handling to images/RTF with optional OCR/caption action.
8. Integration surface
   - Add optional authenticated local HTTP mode for Raycast/Alfred/editor integrations.

## 15. Repository Structure

```
clipboard-ai/
 ├── agent/             # Go daemon
 │   ├── cmd/clipboard-ai-agent/
 │   └── internal/
 │       ├── clipboard/    # Clipboard monitoring
 │       ├── config/       # TOML config loading
 │       ├── executor/     # Action execution (spawns CLI)
 │       ├── ipc/          # Unix socket server
 │       ├── notify/       # macOS notifications
 │       └── rules/        # Trigger engine
 ├── cli/               # TypeScript CLI
 │   └── src/
 │       ├── commands/     # summary, explain, translate, improve, extract, tldr, classify
 │       └── lib/          # AI client, IPC client, clipboard utility, safe mode
 ├── actions/           # Built-in AI actions
 │   ├── builtin/          # summarize, explain, translate, extract, classify
 │   └── lib/              # Action type definitions
 ├── configs/
 ├── docs/
 ├── scripts/
 ├── README.md
 └── LICENSE
```
