# clipboard-ai Implementation Plan

## Overview

Build a macOS clipboard monitoring agent with AI-powered transformations. The system consists of:
- **Go Daemon**: Monitors clipboard, applies rules, triggers actions
- **TypeScript CLI** (`cbai`): User interface, executes AI actions
- **Actions**: Modular AI transformations (summarize, explain, translate, etc.)

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Clipboard monitoring | Polling with `changeCount` | macOS has no clipboard events; changeCount is lightweight |
| IPC | HTTP over Unix socket | Fast (no TCP overhead), familiar API semantics, easy debugging |
| Action execution | CLI spawned by daemon | Keeps Go simple, TS handles AI/LLM complexity |
| LLM client | OpenAI-compatible SDK | Works with Ollama, OpenAI, Anthropic via same interface |

## Repository Structure

```
clipboard-ai/
├── agent/                    # Go daemon
│   ├── cmd/clipboard-ai-agent/main.go
│   └── internal/
│       ├── clipboard/monitor.go
│       ├── config/config.go
│       ├── executor/executor.go  # Action execution (spawns CLI)
│       ├── ipc/server.go
│       ├── notify/notify.go
│       └── rules/engine.go
├── cli/                      # TypeScript CLI (Bun)
│   ├── src/
│   │   ├── index.ts
│   │   ├── commands/         # summary, explain, translate, improve, extract, tldr, classify
│   │   └── lib/
│   │       ├── ai.ts         # LLM API abstraction
│   │       ├── client.ts     # Unix socket IPC client
│   │       ├── clipboard.ts  # Clipboard copy utility (pbcopy)
│   │       └── safe-mode.ts  # Cloud provider detection & safe mode enforcement
│   └── package.json
├── actions/                  # Built-in AI actions
│   ├── builtin/
│   │   ├── summarize.ts
│   │   ├── explain.ts
│   │   ├── translate.ts
│   │   ├── extract.ts
│   │   └── classify.ts
│   └── lib/types.ts
├── configs/
│   └── default.toml
├── scripts/
│   ├── install.sh
│   ├── uninstall.sh
│   └── ai.clipboard.agent.plist
└── README.md
```

## Build Phases

### Phase 1: Go Daemon Foundation
1. Initialize Go module in `agent/`
2. Implement clipboard monitoring with `golang-design/clipboard`
3. Polling loop using changeCount (150ms interval)
4. Basic TOML config loading
5. Unix socket HTTP server with `/status`, `/clipboard` endpoints

### Phase 2: TypeScript CLI
1. Initialize Bun project in `cli/`
2. Set up yargs command structure
3. Implement IPC client (HTTP over Unix socket)
4. Commands: `cbai status`, `cbai clipboard`, `cbai config`

### Phase 3: AI Integration [DONE]
1. ~~OpenAI-compatible client in `actions/lib/ai.ts`~~
2. ~~Built-in actions: `summarize`, `explain`~~
3. ~~Action registry and execution~~
4. ~~CLI commands: `cbai summary`, `cbai explain`, `cbai run <action>`~~
5. ~~Daemon `/action` endpoint to trigger CLI~~

### Phase 4: Triggers & Automation [DONE]
1. ~~Trigger DSL parser (length, regex, contains, mime)~~
2. ~~Content type detection (text, URL, code)~~
3. ~~Auto-execute actions on clipboard change~~ (daemon spawns `cbai <action>` via executor)
4. ~~macOS notifications via `osascript`~~
5. ~~Safe mode (block cloud calls without confirmation)~~

### Phase 5: Polish & Distribution [IN PROGRESS]
1. ~~Installation scripts with LaunchAgent setup~~
2. ~~Additional actions: `translate`, `tldr`, `improve`, `extract`, `classify`~~
3. ~~Error handling and logging~~
4. ~~README and documentation~~
5. ~~`--copy` flag on all AI commands~~
6. ~~Test suites for rule engine (Go) and AI client (Bun)~~

## Key Implementation Details

### Clipboard Monitoring (Go)
```go
ticker := time.NewTicker(150 * time.Millisecond)
var lastChangeCount int
for {
    changeCount := clipboard.GetChangeCount()
    if changeCount != lastChangeCount {
        lastChangeCount = changeCount
        content := clipboard.Read()
        handleClipboardChange(content)
    }
}
```

### Unix Socket IPC
- Socket path: `~/.clipboard-ai/agent.sock`
- Endpoints: `GET /status`, `GET /clipboard`, `POST /action`, `GET /config`

### Config Format (TOML)
```toml
[provider]
type = "ollama"
endpoint = "http://localhost:11434/v1"
model = "mistral"

[actions.summarize]
enabled = true
trigger = "length > 200"
```

### Trigger DSL
- `length > 200` - content length check
- `contains:http` - substring match
- `regex:^ERROR:` - regex match
- `mime:code` - detected content type
- `A OR B`, `A AND B` - combinators

## Verification

1. **Daemon running**: `cbai status` returns uptime and stats
2. **Clipboard detection**: Copy text, check daemon logs show change
3. **Manual action**: `cbai summary` summarizes clipboard content
4. **Auto-trigger**: Copy 300+ char text, notification appears with summary
5. **LaunchAgent**: Restart Mac, verify daemon auto-starts
6. **Classify**: `cbai classify` returns JSON with category, confidence, reasoning
7. **Copy flag**: `cbai summary --copy` prints summary AND pastes it (verify with `pbpaste`)
8. **Tests**: `cd agent && go test ./internal/rules/` passes; `cd cli && bun test` passes

## Dependencies

**Go:**
- `golang.design/x/clipboard` - clipboard access
- `BurntSushi/toml` - config parsing
- `gorilla/mux` - HTTP router (optional)

**TypeScript (Bun):**
- `yargs` - CLI framework
- `openai` - LLM API client
- `@iarna/toml` - TOML parsing
